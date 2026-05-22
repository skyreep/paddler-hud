-- ============================================================================
-- TIDEVISOR — Stripe subscriptions + comp-code system
-- ============================================================================
-- Adds three tables and a helper function to support the paid tier:
--
--   subscriptions      One row per user, tracking Stripe customer/subscription
--                      state plus any comp (beta-tester) window.
--   comp_codes         Admin-issued codes that grant N days of premium access
--                      without requiring a Stripe payment method.
--   comp_redemptions   Join table enforcing one-redemption-per-user-per-code.
--
-- Plus is_premium(uuid) — a SQL function the rest of the app uses to gate
-- premium features. Returns true if the user has any of:
--   - An active or trialing Stripe subscription
--   - A non-null lifetime_purchased_at (one-time lifetime purchase)
--   - comp_until > now() (active comp window)
--
-- Subscription state is server-authoritative. Webhooks from Stripe write to
-- subscriptions via the service role; users can read their own row but
-- can't insert or update directly (RLS denies). Same for comp_codes —
-- only the server creates/reads codes; users only see their own
-- redemptions. This is critical because comp_codes.code is the secret
-- token — if users could enumerate the table, the codes would be
-- trivially harvested.
-- ============================================================================

-- ─── subscriptions ─────────────────────────────────────────────────────────

create table public.subscriptions (
  user_id              uuid primary key references auth.users on delete cascade,
  -- Stripe identifiers. Customer is created on first checkout/portal use;
  -- subscription_id is null for users on free tier or with only a
  -- lifetime purchase (lifetime is a one-time charge, not a sub).
  stripe_customer_id   text unique,
  stripe_subscription_id text unique,
  -- Mirrors Stripe's subscription.status values: active, trialing,
  -- past_due, canceled, unpaid, incomplete, incomplete_expired, paused.
  -- Null = no Stripe sub on this account.
  status               text,
  -- Tier maps the active payment to a feature level. Source of truth
  -- for which features the user gets; is_premium() checks this plus
  -- the comp window.
  --   free       — no purchase
  --   monthly    — active monthly Stripe sub
  --   annual     — active annual Stripe sub
  --   lifetime   — one-time lifetime purchase
  -- We don't downgrade tier on cancellation until current_period_end
  -- passes — webhooks set status='canceled' but the user keeps premium
  -- until the period they paid for actually expires.
  tier                 text not null default 'free'
                          check (tier in ('free', 'monthly', 'annual', 'lifetime')),
  -- For subscription users: end of the currently-paid period. For
  -- lifetime users: null (no period). For free: null.
  current_period_end   timestamptz,
  -- One-time lifetime purchase timestamp. Once set, the user has
  -- premium forever (unless we explicitly revoke for refund).
  lifetime_purchased_at timestamptz,
  -- Beta-tester / promo comp window. is_premium() treats the user as
  -- premium when comp_until > now(). Can stack with paid subs (comp
  -- runs in parallel; expiring doesn't affect their Stripe sub).
  comp_until           timestamptz,
  updated_at           timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- Users can see their own subscription state (so the UI can show
-- "you're on the Annual plan, renews 2027-05-20" etc.). All writes
-- go through the service role — webhooks update on Stripe events,
-- the redemption server action updates comp_until.
create policy "Users can view their own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- Helpful indexes for webhook lookups (by stripe_subscription_id) and
-- for any future "expire comp_until" maintenance job.
create index subscriptions_stripe_sub_idx
  on public.subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

create index subscriptions_comp_until_idx
  on public.subscriptions (comp_until)
  where comp_until is not null;

-- Auto-create a free-tier subscription row when a profile is created,
-- so every signed-in user has exactly one row in this table. Mirrors
-- the handle_new_profile pattern from migration 001.
create or replace function public.handle_new_profile_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (user_id, tier)
  values (new.id, 'free')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_profile_created_subscription on public.profiles;
create trigger on_profile_created_subscription
  after insert on public.profiles
  for each row execute function public.handle_new_profile_subscription();

-- Backfill existing profiles (so the trigger above only handles new
-- signups going forward — but existing accounts also get a row now).
insert into public.subscriptions (user_id, tier)
  select id, 'free' from public.profiles
  on conflict (user_id) do nothing;

-- ─── comp_codes ────────────────────────────────────────────────────────────

create table public.comp_codes (
  -- The token itself — entered verbatim by users. Case-insensitive
  -- comparison happens in the redemption action; we store
  -- whatever case the admin entered for traceability.
  code           text primary key,
  -- Human-readable note for the admin's own bookkeeping ("Reddit beta
  -- testers Q2 2026", "Kayak Tybee guides", etc.). Not shown to users.
  description    text,
  -- How many days of premium this code grants on redemption. 30 = the
  -- standard one-month beta access. Adjust per-code for special
  -- campaigns ("90 days for paddle clubs", etc.).
  duration_days  int not null default 30
                   check (duration_days > 0 and duration_days <= 366),
  -- Optional cap on how many users can redeem. Null = unlimited.
  -- use_count is incremented by the redemption server action.
  max_uses       int check (max_uses is null or max_uses > 0),
  use_count      int not null default 0,
  -- Optional code-level expiration (different from the per-user comp
  -- window, which is set on redemption). Past this date the code
  -- can't be redeemed at all, regardless of use_count. Null = no
  -- expiry.
  expires_at     timestamptz,
  created_at     timestamptz not null default now()
);

alter table public.comp_codes enable row level security;

-- No public policies. Service role only. Codes are secret — if users
-- could enumerate this table the codes themselves leak. Redemption
-- goes through a server action that validates server-side using the
-- service-role client.

-- ─── comp_redemptions ─────────────────────────────────────────────────────

create table public.comp_redemptions (
  id           bigserial primary key,
  user_id      uuid not null references auth.users on delete cascade,
  -- We keep code as text rather than FK so we can keep history even
  -- if a code is later deleted by an admin. (We can still join when
  -- the code still exists.)
  code         text not null,
  redeemed_at  timestamptz not null default now(),
  -- Prevent double-redemption: each (user, code) pair is unique.
  unique (user_id, code)
);

alter table public.comp_redemptions enable row level security;

create policy "Users can view their own redemptions"
  on public.comp_redemptions for select
  using (auth.uid() = user_id);

-- Index for the "has this user redeemed this code?" check at
-- redemption time. The unique constraint above gives us this for
-- free, but naming it explicitly helps query planners.
create index comp_redemptions_user_code_idx
  on public.comp_redemptions (user_id, code);

-- ─── is_premium() helper ──────────────────────────────────────────────────
-- Single source of truth for "is this user a premium user right now?".
-- Used by server-side feature gates and (via a view, future work) by RLS
-- policies on premium-only data.
--
-- security definer + a fixed search_path so we can call it from the
-- API server confidently without auth context. Returns false for
-- non-existent users (no row in subscriptions = not premium).
create or replace function public.is_premium(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = uid
      and (
        -- Active or in trial period
        (s.status in ('active', 'trialing'))
        -- Lifetime purchase — never expires unless explicitly revoked
        or (s.lifetime_purchased_at is not null)
        -- Active comp window (beta tester etc.)
        or (s.comp_until is not null and s.comp_until > now())
      )
  );
$$;

-- Grant execution to authenticated and anon roles so server queries
-- using either context can call it. (Anon will always return false
-- since their uid won't have a row, but the function shouldn't error.)
grant execute on function public.is_premium(uuid) to anon, authenticated;

-- ============================================================================
-- End of 004_stripe_subscriptions.sql
-- ============================================================================
