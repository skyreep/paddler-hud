-- ============================================================================
-- TIDEVISOR — Daily briefing email opt-in fields
-- ============================================================================
-- Adds two columns to user_preferences so each user can independently:
--   - opt in to receiving a daily briefing email (default: off)
--   - pick the hour they want it (0-23, default 6 = 6am Eastern)
--
-- The hour is interpreted in America/New_York timezone (matches STATION_TZ
-- in lib/time.ts and the timezone the location data is already anchored
-- to). If we ever support locations in other timezones we'll need to
-- decide whether to keep this single-tz or extend per-user.
--
-- The cron job at /api/daily-briefing fires hourly. On each invocation it
-- computes the current ET hour and queries user_preferences for rows
-- where daily_briefing_enabled = true AND daily_briefing_hour = <that hour>.
-- Adding an index on (daily_briefing_enabled, daily_briefing_hour) keeps
-- that query cheap even at thousands of users.
-- ============================================================================

alter table public.user_preferences
  add column daily_briefing_enabled boolean not null default false;

alter table public.user_preferences
  add column daily_briefing_hour smallint not null default 6
  check (daily_briefing_hour >= 0 and daily_briefing_hour <= 23);

-- Index for the hourly cron's "who wants email at this hour?" query.
-- Partial: only opted-in rows. Most users will have the flag off, so
-- this stays tiny even as the table grows.
create index user_preferences_daily_briefing_idx
  on public.user_preferences (daily_briefing_hour)
  where daily_briefing_enabled = true;

-- ============================================================================
-- End of 003_daily_briefing.sql
-- ============================================================================
