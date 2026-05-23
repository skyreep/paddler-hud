-- ============================================================================
-- TIDEVISOR — User feedback (bug reports + feature requests)
-- ============================================================================
-- A single table backing /feedback. Signed-in users submit bug reports and
-- feature requests through the in-app form; admins review them via the
-- Supabase dashboard (or a future /admin/feedback page).
--
-- Design choices:
--
--   * Signed-in only. Submissions always carry a user_id (FK to auth.users)
--     so we can follow up by email without asking the submitter to type
--     theirs. RLS enforces auth.uid() = user_id on insert.
--
--   * Users can SELECT their own submissions (so a future "your past
--     feedback" view on /feedback can show what they've sent). They
--     cannot UPDATE or DELETE — feedback is append-only from their side.
--     Admins handle status changes via the service-role client.
--
--   * No public read. comp_codes-style strict gate: only the service role
--     reads everyone's feedback. Don't want one user enumerating another
--     user's bug reports (which may contain account-specific details).
--
--   * `kind` is constrained to 'bug' | 'feature' | 'other'. Keeps the
--     review queue triageable. 'other' is the escape hatch so we don't
--     reject a legitimate submission that doesn't fit the first two.
--
--   * `status` defaults to 'new' and is admin-managed. Same pattern as
--     a support ticket queue — new → triaged → resolved/declined.
--
--   * page_url and user_agent are captured client-side and passed through
--     so the admin reviewing a bug knows which page it happened on and
--     in which browser. Both are nullable in case the client omits them.
--
--   * No attachments in v1. If a user needs to send a screenshot they can
--     still email contact@tidevisor.com. Adding file uploads here would
--     require a Supabase storage bucket + size/type validation + virus
--     scanning concerns; out of scope for the initial ship.
-- ============================================================================

create table public.feedback (
  id           bigserial primary key,
  user_id      uuid not null references auth.users on delete cascade,
  -- Submission category. Drives the admin filter view and lets us
  -- route bugs vs. feature requests to different review cadences.
  kind         text not null
                 check (kind in ('bug', 'feature', 'other')),
  -- Short one-line title. Required. Capped at 200 chars so the admin
  -- table view doesn't get wrecked by someone pasting an essay here.
  subject      text not null
                 check (char_length(subject) between 1 and 200),
  -- The actual report. Required, generous cap (8KB is plenty for a
  -- detailed bug repro and well below anything that would slow the
  -- table down).
  body         text not null
                 check (char_length(body) between 1 and 8000),
  -- Where in the app they were when they submitted. Helps reproduce
  -- bugs ("crashed on /locations" vs. "crashed on /"). Captured by
  -- the client form, not the server, because by the time the action
  -- runs the request URL is /feedback.
  page_url     text,
  -- Raw User-Agent string so we can tell mobile Safari bugs apart
  -- from desktop Chrome bugs without asking the submitter.
  user_agent   text,
  -- Admin-managed lifecycle. 'new' is the queue; everything else is
  -- a terminal-ish state that hides the row from the default view.
  status       text not null default 'new'
                 check (status in ('new', 'triaged', 'in_progress',
                                   'resolved', 'declined', 'duplicate')),
  -- Free-form admin note. Not shown to the submitter; used during
  -- triage ("dupe of #42", "needs more info, emailed user").
  admin_note   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.feedback enable row level security;

-- ─── RLS ───────────────────────────────────────────────────────────────────

-- Users can read their own submissions. Lets a future "your past
-- feedback" section on /feedback show what they've sent and the
-- current status (without exposing admin_note — selected columns are
-- the client's responsibility, not RLS's).
create policy "Users can view their own feedback"
  on public.feedback for select
  using (auth.uid() = user_id);

-- Users can insert rows scoped to themselves. WITH CHECK enforces
-- that they can't spoof a different user_id at insert time. Server
-- actions also pass the user_id explicitly from auth.getUser(), so
-- this is belt-and-suspenders.
create policy "Users can insert their own feedback"
  on public.feedback for insert
  with check (auth.uid() = user_id);

-- No update or delete policies — feedback is append-only from the
-- user side. Admins use the service role for triage changes, which
-- bypasses RLS.

-- ─── Indexes ───────────────────────────────────────────────────────────────

-- "Show me this user's past feedback, newest first" — used by the
-- /feedback page's history section if/when we add one.
create index feedback_user_created_idx
  on public.feedback (user_id, created_at desc);

-- "Show the admin queue, newest first, filtered by status" —
-- used by the future /admin/feedback page.
create index feedback_status_created_idx
  on public.feedback (status, created_at desc);

-- ─── updated_at trigger ───────────────────────────────────────────────────
-- Keep updated_at fresh on admin edits (status changes, admin_note
-- additions). User-side inserts get now() from the default and never
-- update.
create or replace function public.touch_feedback_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists feedback_set_updated_at on public.feedback;
create trigger feedback_set_updated_at
  before update on public.feedback
  for each row execute function public.touch_feedback_updated_at();

-- ============================================================================
-- End of 006_feedback.sql
-- ============================================================================
