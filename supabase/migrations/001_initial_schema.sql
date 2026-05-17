-- ============================================================================
-- LoCo WX — initial schema (auth + user-scoped settings)
-- ============================================================================
-- Run this once in Supabase Dashboard → SQL Editor for a fresh project.
-- Subsequent schema changes should be added as new files (002_*, 003_*, etc.).
--
-- All user-data tables are protected by Row Level Security so any authenticated
-- user can only read/write their own rows. Guests (no session) get no access
-- to these tables at all — guest mode in the app falls back to the hardcoded
-- STATIONS list and localStorage, no DB call needed.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. profiles — one row per signed-up user
-- ---------------------------------------------------------------------------
-- Mirrors auth.users.id 1:1. We never write to auth.users directly; this is
-- the table to add custom profile fields to (display name, avatar URL,
-- subscription status when we get there, etc.).

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select using (auth.uid() = id);
create policy "Users can update their own profile"
  on public.profiles for update using (auth.uid() = id);
create policy "Users can insert their own profile"
  on public.profiles for insert with check (auth.uid() = id);

-- When Supabase creates a new auth.users row (after signup / OAuth callback),
-- automatically create a matching profiles row so the rest of the app can
-- assume one exists.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------------
-- 2. user_locations — saved paddling spots (max 6 per user)
-- ---------------------------------------------------------------------------
-- Replaces the hard-coded STATIONS list (lib/stations.ts) for signed-in
-- users. Each row bundles every NOAA / NDBC / NWS identifier the HUD uses
-- for a location, exactly as Station does in lib/types.ts.

create table public.user_locations (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  display_name           text not null,
  lat                    double precision not null,
  lon                    double precision not null,
  tide_station_id        text not null,
  tide_station_note      text,
  observation_station_id text,
  -- Ordered list of wind sources: [{ "kind": "coops" | "ndbc", "id": "8670870" }, ...]
  wind_stations          jsonb not null default '[]'::jsonb,
  buoy_id                text,
  nws_zone               text,
  marine_zone            text,
  sort_order             int  not null default 0,
  is_primary             boolean not null default false,
  created_at             timestamptz not null default now()
);

create index user_locations_user_id_idx on public.user_locations(user_id, sort_order);

-- App-level limit: 6 saved spots (1 primary + 5 secondary). Enforced in code
-- but this trigger is a safety net against bypasses.
create or replace function public.enforce_user_locations_limit()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.user_locations where user_id = new.user_id) >= 6 then
    raise exception 'Maximum 6 locations per user';
  end if;
  return new;
end;
$$;

create trigger user_locations_limit
  before insert on public.user_locations
  for each row execute function public.enforce_user_locations_limit();

alter table public.user_locations enable row level security;

create policy "Users can view their own locations"
  on public.user_locations for select using (auth.uid() = user_id);
create policy "Users can insert their own locations"
  on public.user_locations for insert with check (auth.uid() = user_id);
create policy "Users can update their own locations"
  on public.user_locations for update using (auth.uid() = user_id);
create policy "Users can delete their own locations"
  on public.user_locations for delete using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 3. user_gauges — saved USGS river gauges (max 10 per user)
-- ---------------------------------------------------------------------------
create table public.user_gauges (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  usgs_site_id         text not null,
  display_name         text,
  flood_stage_override numeric,
  sort_order           int  not null default 0,
  created_at           timestamptz not null default now(),
  unique (user_id, usgs_site_id)
);

create index user_gauges_user_id_idx on public.user_gauges(user_id, sort_order);

create or replace function public.enforce_user_gauges_limit()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.user_gauges where user_id = new.user_id) >= 10 then
    raise exception 'Maximum 10 river gauges per user';
  end if;
  return new;
end;
$$;

create trigger user_gauges_limit
  before insert on public.user_gauges
  for each row execute function public.enforce_user_gauges_limit();

alter table public.user_gauges enable row level security;

create policy "Users can view their own gauges"
  on public.user_gauges for select using (auth.uid() = user_id);
create policy "Users can insert their own gauges"
  on public.user_gauges for insert with check (auth.uid() = user_id);
create policy "Users can update their own gauges"
  on public.user_gauges for update using (auth.uid() = user_id);
create policy "Users can delete their own gauges"
  on public.user_gauges for delete using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 4. user_preferences — one row per user
-- ---------------------------------------------------------------------------
-- Theme, unit choices, time format, and tile visibility/ordering. The
-- tile_config JSON shape is e.g.:
--   { "rightnow": { "visible": true,  "order": 0 },
--     "windnow":  { "visible": true,  "order": 1 },
--     "tropical": { "visible": false, "order": 9 }, ... }
-- An empty object means "use defaults for everything."

create table public.user_preferences (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  theme        text not null default 'auto' check (theme in ('light', 'dark', 'auto')),
  units_wind   text not null default 'kt'   check (units_wind in ('kt', 'mph', 'all')),
  units_temp   text not null default 'F'    check (units_temp in ('F', 'C')),
  units_height text not null default 'ft'   check (units_height in ('ft', 'm')),
  time_format  text not null default '12h'  check (time_format in ('12h', '24h')),
  tile_config  jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

create policy "Users can view their own preferences"
  on public.user_preferences for select using (auth.uid() = user_id);
create policy "Users can insert their own preferences"
  on public.user_preferences for insert with check (auth.uid() = user_id);
create policy "Users can update their own preferences"
  on public.user_preferences for update using (auth.uid() = user_id);

-- Mirror the profile trigger: when a profile is created, ensure a default
-- preferences row exists so the app never has to handle "missing prefs."
create or replace function public.handle_new_profile_preferences()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_profile_created_create_preferences
  after insert on public.profiles
  for each row execute function public.handle_new_profile_preferences();


-- ---------------------------------------------------------------------------
-- 5. (Optional but recommended) Seed-the-defaults helper
-- ---------------------------------------------------------------------------
-- When a new user signs up, give them the canonical Lowcountry locations
-- pre-saved so they don't have to set up from scratch. Comment this out if
-- you'd rather start every new user with an empty list.

create or replace function public.seed_default_locations()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.user_locations
    (user_id, display_name, lat, lon, tide_station_id, tide_station_note,
     observation_station_id, wind_stations, buoy_id, nws_zone, marine_zone,
     sort_order, is_primary)
  values
    (new.id, 'Tybee Island, GA', 31.9912, -80.847, '8670870', null,
     'KSAV', '[{"kind":"coops","id":"8670870"}]'::jsonb, '41008',
     'GAZ139', 'AMZ350', 0, true),
    (new.id, 'Hilton Head, SC', 32.2163, -80.7526, '8670870',
     'Reference: Fort Pulaski. Hilton Head tides run ~5 min later.',
     'KHXD', '[{"kind":"coops","id":"8666867"},{"kind":"ndbc","id":"41033"},{"kind":"coops","id":"8670870"}]'::jsonb,
     '41033', 'SCZ050', 'AMZ330', 1, false),
    (new.id, 'Beaufort, SC', 32.4316, -80.6698, '8670870',
     'Reference: Fort Pulaski. Beaufort tides run ~10 min later.',
     'KARW', '[{"kind":"coops","id":"8667060"},{"kind":"ndbc","id":"41033"},{"kind":"coops","id":"8670870"}]'::jsonb,
     '41033', 'SCZ049', 'AMZ330', 2, false),
    (new.id, 'Charleston, SC', 32.7833, -79.9333, '8665530', null,
     'KCHS', '[{"kind":"coops","id":"8665530"}]'::jsonb, '41004',
     'SCZ048', 'AMZ330', 3, false);
  return new;
end;
$$;

create trigger on_profile_created_seed_locations
  after insert on public.profiles
  for each row execute function public.seed_default_locations();

-- ============================================================================
-- End of 001_initial_schema.sql
-- ============================================================================
