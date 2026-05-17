# Supabase migrations

SQL files in `migrations/` are the version-controlled history of the database
schema. They are NOT auto-applied — apply them manually through the Supabase
Dashboard's SQL Editor so you see exactly what runs.

## Initial setup (fresh project)

1. Create a Supabase project (https://supabase.com/dashboard)
2. Open **SQL Editor** in the sidebar
3. Click **New query**
4. Paste the entire contents of `migrations/001_initial_schema.sql`
5. Click **Run** (bottom right)
6. Verify in **Database → Tables** that you see:
   - `profiles`
   - `user_locations`
   - `user_gauges`
   - `user_preferences`

## Adding a future schema change

1. Create a new file: `migrations/00N_description.sql`
2. Write the SQL — additive changes only when possible (new columns with
   defaults, new tables) so the running app doesn't break mid-deploy
3. Open SQL Editor → paste → run
4. Commit the file to git so anyone else setting up gets the same schema

## Why not auto-apply on push?

Supabase's GitHub integration with automatic migration application is great,
but database branching (the safety net that makes it safe) requires the Pro
plan ($25/mo). On the free tier, auto-applying migrations means a typo can
take down production with no preview. Manual paste-and-run is slower but
visible — you see exactly what's about to happen before it does.

When we upgrade to Pro, we can flip on the GitHub integration and the
migrations apply on push from `main`.

## Row Level Security (RLS) — read this if you touch any user-data table

Every user-data table (`profiles`, `user_locations`, `user_gauges`,
`user_preferences`) has RLS enabled with policies that restrict each row
to `auth.uid() = user_id` (or `= id` for the profiles table).

When adding a new user-data table, **always**:

1. `alter table foo enable row level security;`
2. Add `select`, `insert`, `update`, `delete` policies scoped to `auth.uid()`
3. Test it with the `anon` key — if the table is readable without auth, the
   policy is wrong

Skipping RLS means the `anon` key (which we ship to the browser) can read
every user's data. That's the catastrophic failure mode to avoid.
