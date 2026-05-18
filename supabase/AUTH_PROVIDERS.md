# Auth provider setup

Phase 2 of the auth rollout wires up two sign-in paths in the app:
**Google OAuth** and **email magic link**. Each one needs configuration
in the Supabase Dashboard. Email magic link is the lightest lift (no
third-party signup), so start there.

Apple Sign In is documented at the bottom but **not** wired into the UI
— it requires an Apple Developer Program membership ($99/yr). Re-enable
it when there's a clear need (e.g. iOS home-screen users requesting it);
the sign-in modal can add the button back in a few lines.

## 0. Redirect URLs (do this first — required for ALL providers)

Supabase needs to know every URL it's allowed to send a freshly
authenticated user back to. If a redirect URL isn't on the allow-list,
the provider refuses to redirect and the sign-in dies silently.

**Dashboard → Authentication → URL Configuration → Redirect URLs.** Add:

```
http://localhost:3000/auth/callback
https://paddler-hud.vercel.app/auth/callback
https://paddler-hud-*.vercel.app/auth/callback
```

The third line is a wildcard for Vercel preview deploys — adjust the
pattern if your branch deploys look different (`git checkout feat/auth` →
look at the URL Vercel comments on the PR).

Also set **Site URL** to `https://paddler-hud.vercel.app` (or your
production domain). Supabase uses this as the default if a redirect URL
isn't supplied per-request.

---

## 1. Email magic link

This is the easiest provider — Supabase sends the email itself.

**Dashboard → Authentication → Providers → Email.** It's enabled by
default; just verify:

- **Enable Email provider**: on
- **Confirm email**: leave on for production (users must click the link to
  verify ownership). For local dev you can turn it off if it's slowing you
  down, but flip it back on before merging to main.
- **Secure email change**: on
- **Mailer Autoconfirm**: off (defeats the point of magic links)

**No further env vars needed.** Supabase uses its built-in SMTP for the
free tier — fine for dev and low-volume use. For production scale you'll
want to configure a real SMTP provider (Postmark, Resend, SES) under
**Authentication → Emails → SMTP Settings**, but that's a later concern.

Try it: open the HUD, click **Sign in**, enter your email, click **Send
magic link**, check your inbox. The link will bounce through
`/auth/callback` and drop you back on the dashboard, signed in.

---

## 2. Google OAuth

Free. ~10 minutes if you've done it before, ~25 if it's your first time.

### A. Create a Google Cloud project (or reuse one)

1. <https://console.cloud.google.com> → top-left project picker → **New
   Project**. Name it `loco-wx` or similar.
2. In the new project, search **APIs & Services → OAuth consent screen**.
   - **User type**: External
   - **App name**: `LoCo WX` (this is what users see)
   - **User support email**: your email
   - **Developer contact**: your email
   - **Scopes**: leave defaults (`openid`, `email`, `profile`)
   - **Test users**: add your own email while you're in test mode. Move to
     "In production" before launch so anyone can sign in.

### B. Create an OAuth client

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. **Application type**: Web application
3. **Name**: `LoCo WX — Supabase`
4. **Authorized redirect URIs**: this is the Supabase callback URL, NOT
   ours. Find it in **Supabase Dashboard → Authentication → Providers →
   Google → Callback URL (for OAuth)**. It looks like:
   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```
5. Click **Create**. Copy the **Client ID** and **Client secret**.

### C. Plug into Supabase

**Supabase Dashboard → Authentication → Providers → Google**:

- Toggle **Enable Google provider** on
- Paste **Client ID** and **Client secret**
- Click **Save**

Try it: HUD → **Sign in** → **Continue with Google** → Google consent
screen → back to the HUD, signed in.

---

## 3. Apple Sign In  *(deferred — not in the UI today)*

The most setup work of the three. Requires an **Apple Developer Program**
membership ($99/year). Skip until iOS home-screen users specifically ask
for it. When you're ready to enable it, add the "Continue with Apple"
button back in `components/auth/SignInModal.tsx` (it was removed when
this section was deferred) and follow the steps below.

### A. In your Apple Developer account

1. <https://developer.apple.com/account> → **Certificates, Identifiers &
   Profiles → Identifiers**.

2. **Create an App ID** (if you don't already have one for LoCo WX):
   - **+** → **App IDs → App**
   - **Description**: `LoCo WX`
   - **Bundle ID** (Explicit): `com.locowx.app` (or your reverse-DNS choice)
   - **Capabilities**: check **Sign In with Apple**
   - Register.

3. **Create a Services ID** (this is what Supabase uses):
   - **+** → **Services IDs**
   - **Description**: `LoCo WX Web Auth`
   - **Identifier**: `com.locowx.web` (must differ from the App ID)
   - Register.
   - Click into it → check **Sign In with Apple** → **Configure**:
     - **Primary App ID**: the one you registered above
     - **Domains and Subdomains**: `<your-project-ref>.supabase.co`
     - **Return URLs**: `https://<your-project-ref>.supabase.co/auth/v1/callback`
   - Save.

4. **Create a Sign In with Apple key**:
   - **Keys** tab → **+**
   - **Key Name**: `LoCo WX Sign In`
   - Check **Sign In with Apple** → **Configure** → choose the Primary App ID
   - **Continue → Register**. **Download the .p8 file immediately** — you
     can't download it again, and you need its contents for Supabase.
   - Note the **Key ID** (10-character string shown after registration)
     and your **Team ID** (top-right of the Apple Developer site).

### B. Plug into Supabase

**Supabase Dashboard → Authentication → Providers → Apple**:

- Toggle **Enable Apple provider** on
- **Client IDs**: the Services ID from step 3 (`com.locowx.web`)
- **Secret Key (for OAuth)**: paste the contents of the `.p8` file
  (Supabase generates the client secret JWT from these inputs)
- **Team ID**: from your Apple Developer account
- **Key ID**: from step 4
- Click **Save**

Try it: HUD → **Sign in** → **Continue with Apple** → Apple consent →
back to the HUD, signed in.

---

## Sanity checks once everything's wired

1. **Open the HUD as a guest** (incognito window). The topbar should show
   a **Sign in** button.
2. **Click Sign in.** The modal appears with all three options.
3. **Each provider end-to-end:**
   - Magic link: get the email, click it, land back signed in.
   - Google: consent screen, then signed in.
   - Apple: consent screen, then signed in.
4. **After signing in:** topbar shows your avatar/initials. Click → menu
   shows name, email, and **Sign out**.
5. **Sign out:** topbar returns to **Sign in** pill, page revalidates.
6. **In Supabase Dashboard → Authentication → Users:** every sign-in
   creates a row. Provider info is visible in the row detail.
7. **In Database → Table editor → public.profiles:** every new user has a
   matching profiles row (created by the trigger from migration 001).
8. **public.user_locations:** every new user has 4 default Lowcountry
   locations seeded (Tybee, Hilton Head, Beaufort, Charleston). The
   `seed_default_locations` trigger from migration 001 is responsible.

If any of those fail, the most likely cause is a redirect URL not
allow-listed in section 0 — double-check those first.
