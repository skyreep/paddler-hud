-- ============================================================================
-- TIDEVISOR — Trim default seed for new signups
-- ============================================================================
-- Replaces the seed_default_locations() and seed_default_gauges() functions
-- from migrations 001 / 002 with leaner defaults that better match the
-- launch plan:
--
--   - One default location instead of four. The free tier allows 3 saved
--     locations; pre-populating with 4 made the cap look "already hit"
--     to new users, who'd see an upgrade prompt the first time they
--     tried to save anything new. One default leaves room.
--
--   - Three default river gauges instead of five. Same logic — the
--     gauge editor exposes a 10-gauge cap, but a smaller starting set
--     reads as "here's a quick taste" rather than "this is the full thing".
--
-- IMPORTANT: This migration only changes what NEW signups get. Existing
-- accounts keep whatever rows the old triggers seeded for them; they can
-- prune via the location/gauge editors as they like.
-- ============================================================================

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
     'GAZ139', 'AMZ350', 0, true);
  return new;
end;
$$;

-- The trigger itself (on_profile_created_seed_locations) was created in
-- migration 001 and still points at this function name, so replacing the
-- function definition is sufficient — no need to drop/recreate the trigger.

create or replace function public.seed_default_gauges()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.user_gauges (user_id, usgs_site_id, display_name, sort_order)
  values
    (new.id, '02198690', 'Ebenezer Creek nr Springfield, GA', 0),
    (new.id, '02202500', 'Ogeechee River at Eden, GA',        1),
    (new.id, '02315500', 'Suwannee River at Fargo, GA',       2);
  return new;
end;
$$;

-- ============================================================================
-- End of 005_default_seed_overhaul.sql
-- ============================================================================
