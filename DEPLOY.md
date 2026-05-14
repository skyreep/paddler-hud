# Deploying Paddler HUD for Alpha Testing

This is the fastest path to a shareable URL. The whole thing fits inside Vercel's free tier.

---

## Step 1 — Create a GitHub repo

1. Go to <https://github.com/new>. Name it `paddler-hud` (or whatever — private is fine).
2. **Do not** initialize with a README, `.gitignore`, or license — we already have them.
3. Copy the two `git remote add origin …` commands GitHub shows you on the next screen.

Then in your terminal (replace `…` with the URLs GitHub gave you):

```bash
cd "C:\Users\Skyler Reep\PADL\paddler-hud-app"
git init
git add .
git commit -m "Initial Paddler HUD alpha"
git branch -M main
git remote add origin https://github.com/<you>/paddler-hud.git
git push -u origin main
```

If you don't have `git` installed: <https://git-scm.com/download/win>. GitHub Desktop (<https://desktop.github.com>) works too if you prefer a GUI.

---

## Step 2 — Sign up for Vercel

1. Go to <https://vercel.com/signup>.
2. Click **Continue with GitHub** — fastest, gives Vercel permission to read your repos.
3. Pick the free **Hobby** plan when prompted.

---

## Step 3 — Import the repo

1. From your Vercel dashboard, click **Add New → Project**.
2. Find `paddler-hud` in the list of your GitHub repos and click **Import**.
3. **Framework Preset** auto-detects as Next.js. Leave it.
4. **Root Directory** stays as `./`.
5. Expand **Environment Variables** and add these two:

   | Name              | Value                                          |
   | ----------------- | ---------------------------------------------- |
   | `NWS_USER_AGENT`  | `PaddlerHUD/0.1 (your-email@example.com)`      |
   | `AIRNOW_API_KEY`  | *(paste the key you already have)*             |

   The User-Agent is mandatory — `api.weather.gov` rejects anonymous requests.
6. Click **Deploy**.

Vercel builds and deploys in ~90 seconds. You'll get a URL like
`https://paddler-hud-xxxx.vercel.app` — that's the link to share with friends.

---

## Step 4 — Test it

Open the URL on a phone. Verify:

- Tybee loads with tides, weather, radar, satellite
- Switching locations updates the data
- Dark/light toggle works
- Refresh button shows the spin animation

If any tile shows an error, check Vercel's **Logs** tab for the deployment — it'll show the failing API call.

---

## Step 5 — Iterating

Every `git push` to `main` triggers an automatic redeploy on Vercel — usually live within 60 seconds. Each push also creates a preview URL on its own commit hash, so you can A/B test changes.

```bash
# After making local changes:
git add .
git commit -m "What changed"
git push
```

That's it.

---

## Optional: custom domain

If you own a domain (e.g. `paddlerhud.com`):

1. Vercel project → **Settings → Domains → Add**.
2. Vercel shows you the DNS records to add at your registrar. CNAME for a subdomain, A record + CNAME for the apex.
3. SSL auto-provisions in ~30 seconds.

---

## Costs

Free tier covers:
- 100 GB bandwidth / month (plenty for alpha)
- Unlimited deploys
- All the data sources we use are free with no rate limits we'll hit
- AirNow's free key: 500 requests/hour (cached at edge, so a single user request fans out to most visitors)

If alpha grows past ~5k unique visitors a month, the next tier ($20/month) is where you'd land — not before.

---

## Things to do before sharing widely

- Add a privacy/disclaimer line in the footer (you're showing weather + tide data;
  add: *"Always verify conditions with official sources before launching."* — already in the footer)
- Toggle the Vercel project to "Public" in Settings so anyone with the link can load it
- Consider turning off Vercel Analytics's "Personal data collection" if you want to be strict

Good luck with the alpha. Send the link 🛶
