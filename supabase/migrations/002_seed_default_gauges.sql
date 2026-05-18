-- ============================================================================
-- TIDEVISOR — Seed default Lowcountry gauges on new profile creation
-- ============================================================================
-- Migration 001 already seeds the four default locations (Tybee, HHI,
-- Beaufort, Charleston) when a profile is created. This adds the matching
-- trigger for the five default Lowcountry USGS river gauges.
--
-- Without this trigger, new signups land on a dashboard showing the
-- hardcoded DEFAULT_GAUGES fallback list but with an empty user_gauges
-- table — which means as soon as they save their first gauge, the
-- defaults vanish (the loader only falls back when user_gauges is empty).
-- The mismatch was confusing. Pre-seeding removes the surprise: signed-in
-- users start with the same defaults as guests, but they're real saved
-- rows they can edit, reorder, or remove from the gauge editor.
--
-- For accounts that existed before this migration, the gauge editor's
-- empty-state has a "Save these to my list" button that calls the
-- seedDefaultGauges() server action — equivalent backfill, manual trigger.
-- ============================================================================

create or replace function public.seed_default_gauges()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.user_gauges (user_id, usgs_site_id, display_name, sort_order)
  values
    (new.id, '02198690', 'Ebenezer Creek nr Springfield, GA',  0),
    (new.id, '02202500', 'Ogeechee River at Eden, GA',         1),
    (new.id, '02226160', 'Altamaha River nr Everett City, GA', 2),
    (new.id, '02316000', 'Suwannee River at White Springs, FL', 3),
    (new.id, '02315500', 'Suwannee River at Fargo, GA',        4);
  return new;
end;
$$;

create trigger on_profile_created_seed_gauges
  after insert on public.profiles
  for each row execute function public.seed_default_gauges();

-- ============================================================================
-- End of 002_seed_default_gauges.sql
-- ============================================================================
