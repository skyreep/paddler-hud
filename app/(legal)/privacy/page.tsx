import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy · Tidevisor",
  description: "How Tidevisor collects, uses, and protects your information.",
};

const EFFECTIVE_DATE = "May 18, 2026";
const CONTACT_EMAIL = "contact@tidevisor.com";

export default function PrivacyPage() {
  return (
    <article>
      <h1 style={h1}>Privacy Policy</h1>
      <p style={subtle}>Effective: {EFFECTIVE_DATE}</p>

      <p>
        Tidevisor is a marine information dashboard for paddlers. This policy
        explains what data we collect, why, and what your rights are. We try
        to keep it plain English; if anything is unclear, please contact us at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} style={link}>{CONTACT_EMAIL}</a>.
      </p>

      <h2 style={h2}>What we collect</h2>

      <p><strong>Account data.</strong> When you sign in with Google or via
      email magic link, we receive your email address and (from Google) your
      display name. We do not store passwords because we don&apos;t use them.</p>

      <p><strong>Saved settings.</strong> Locations, river gauges, and
      preferences (units, theme, time format, briefing schedule) are stored
      against your account so the dashboard remembers your choices across
      devices.</p>

      <p><strong>Standard server logs.</strong> Our host (Vercel) keeps
      standard request logs — IP address, user agent, timestamps — for
      typically 30 days for security and debugging.</p>

      <p><strong>What we do NOT collect.</strong> Tidevisor contains no third-
      party analytics, no advertising trackers, no email tracking pixels, and
      no behavioral profiling. We do not know which tiles you look at, how
      long you spend on the site, or whether you open the daily briefing
      email.</p>

      <h2 style={h2}>How we use it</h2>

      <p><strong>Authentication.</strong> We use your email to send magic-link
      sign-in messages and to maintain your session via cookies.</p>

      <p><strong>Personalization.</strong> Your saved locations, gauges, and
      preferences drive what you see on the dashboard.</p>

      <p><strong>Daily briefings.</strong> If you opt in to the daily briefing
      email (off by default), we email you a one-screen summary of your
      primary location&apos;s conditions at the hour you choose. You can
      opt out at any time in Preferences.</p>

      <p>We do not sell, rent, or share your personal data with anyone for
      marketing purposes.</p>

      <h2 style={h2}>Service providers</h2>

      <p>We use the following services to operate Tidevisor. Each receives
      only the data it needs and is governed by its own privacy policy:</p>

      <ul style={ul}>
        <li><strong>Supabase</strong> — authentication and database storage.</li>
        <li><strong>Resend</strong> — sends sign-in and daily briefing emails.</li>
        <li><strong>Vercel</strong> — hosts the application.</li>
        <li><strong>Google</strong> — provides OAuth sign-in (only if you choose Google to sign in).</li>
        <li><strong>Cloudflare RainViewer</strong> — serves weather radar tiles.</li>
        <li><strong>Esri</strong> — serves satellite map tiles.</li>
        <li><strong>Porkbun</strong> — domain registration.</li>
        <li><strong>GitHub</strong> — hosts the code and triggers our daily briefing job.</li>
      </ul>

      <h2 style={h2}>Public data sources</h2>

      <p>The dashboard fetches publicly-available data from NOAA CO-OPS,
      NWS, USGS, NDBC, EPA AirNow, Open-Meteo, and SunCalc. These queries
      originate from our server and do not pass any of your account
      information to those services.</p>

      <h2 style={h2}>Data retention</h2>

      <p>We keep your account data for as long as your account exists. To
      delete your account and all associated data, email{" "}
      <a href={`mailto:${CONTACT_EMAIL}`} style={link}>{CONTACT_EMAIL}</a>
      {" "}and we&apos;ll process the deletion within 14 days. Backups containing
      your data may persist for up to 30 days after deletion before being
      purged on rotation.</p>

      <h2 style={h2}>Your rights</h2>

      <p>You can:</p>

      <ul style={ul}>
        <li>Access the data we have about you — your settings are all visible in the dashboard, and we can provide an export on request.</li>
        <li>Correct your data via the dashboard.</li>
        <li>Delete your account at any time (see above).</li>
        <li>Opt out of the daily briefing at any time via Preferences.</li>
        <li>Object to processing, or restrict it — contact us.</li>
      </ul>

      <p>If you&apos;re in the EU or California, you may have additional
      rights under GDPR or CCPA. To exercise them, contact us.</p>

      <h2 style={h2}>Cookies</h2>

      <p>We use only essential cookies — specifically, the session cookies
      that Supabase Auth uses to keep you signed in. We don&apos;t use
      advertising or analytics cookies. Because these are necessary for
      the service to function, we don&apos;t show a cookie banner.</p>

      <h2 style={h2}>Security</h2>

      <p>Tidevisor uses HTTPS everywhere, OAuth via verified providers, and
      encrypted data at rest in the database. We follow standard security
      practices, but no system is perfectly secure. If you suspect a breach
      or vulnerability, contact us immediately.</p>

      <h2 style={h2}>Children</h2>

      <p>Tidevisor is not directed at children under 13 and we don&apos;t
      knowingly collect their data. If you believe a child has provided us
      with information, contact us and we&apos;ll delete it.</p>

      <h2 style={h2}>Changes to this policy</h2>

      <p>We may update this policy from time to time. The &quot;Effective&quot;
      date above will change when we do. Material changes will be
      communicated via the dashboard or the daily briefing email. Continued
      use after changes constitutes acceptance.</p>

      <h2 style={h2}>Contact</h2>

      <p>Questions, requests, or concerns? Email{" "}
      <a href={`mailto:${CONTACT_EMAIL}`} style={link}>{CONTACT_EMAIL}</a>.</p>
    </article>
  );
}

// ─── Styles (inline so this file is self-contained) ────────────────────

const h1: React.CSSProperties = {
  fontSize: 28, fontWeight: 700, marginTop: 0, marginBottom: 4,
  color: "var(--text)",
};
const h2: React.CSSProperties = {
  fontSize: 18, fontWeight: 700, marginTop: 32, marginBottom: 8,
  color: "var(--text)",
};
const subtle: React.CSSProperties = {
  fontSize: 13, color: "var(--text-muted)", marginTop: 0, marginBottom: 24,
};
const link: React.CSSProperties = {
  color: "var(--accent)", textDecoration: "underline",
};
const ul: React.CSSProperties = {
  paddingLeft: 22, margin: "8px 0 12px",
};
