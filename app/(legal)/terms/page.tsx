import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service · Tidevisor",
  description: "Terms under which Tidevisor is provided.",
};

const EFFECTIVE_DATE = "May 18, 2026";
const CONTACT_EMAIL = "contact@tidevisor.com";
const GOVERNING_STATE = "Georgia";

export default function TermsPage() {
  return (
    <article>
      <h1 style={h1}>Terms of Service</h1>
      <p style={subtle}>Effective: {EFFECTIVE_DATE}</p>

      <p>
        By accessing Tidevisor (tidevisor.com), you agree to these terms.
        If you do not agree, please don&apos;t use the service.
      </p>

      <h2 style={h2}>1. The service</h2>

      <p>Tidevisor is a marine information dashboard for paddlers. We
      aggregate data from public sources (NOAA, NWS, USGS, NDBC, EPA AirNow,
      Open-Meteo, and others) and present it in a unified view. The service
      is currently free to use.</p>

      <div style={dangerBox}>
        <h2 style={{ ...h2, marginTop: 0, color: "var(--bad, #c44)" }}>
          2. Marine and weather data disclaimer
        </h2>

        <p><strong>Please read this carefully. It is the most important
        section of these terms.</strong></p>

        <p>The data shown on Tidevisor is for informational purposes only.
        It is <strong>not</strong> a substitute for official forecasts,
        warnings, or navigational charts.</p>

        <ul style={ul}>
          <li>Marine and weather conditions can change rapidly. Always check
          official NOAA and NWS sources, and listen to VHF marine weather
          broadcasts, before launching.</li>
          <li>Tide predictions are computed from harmonic constituents and may
          differ from actual water levels due to wind, pressure, or storm
          surge.</li>
          <li>Wind, wave, and weather forecasts carry inherent uncertainty
          and may not reflect rapidly-evolving local conditions.</li>
          <li>River gauge data has reporting delays and may not reflect
          current conditions, especially during rapidly-changing flow events.</li>
          <li>The active-alerts list relies on third-party data feeds and may
          be incomplete or delayed.</li>
          <li>Station selection and data quality vary by location; resolver
          choices may pick stations farther from you than is ideal.</li>
        </ul>

        <p><strong>You are solely responsible for your safety on the
        water.</strong> Before any paddling trip, we strongly recommend:</p>

        <ul style={ul}>
          <li>Filing a float plan with someone on shore.</li>
          <li>Carrying appropriate safety gear (PFD, communication,
          signaling, navigation).</li>
          <li>Monitoring official VHF marine weather and Coast Guard
          broadcasts.</li>
          <li>Making conservative, judgment-based decisions about conditions —
          not relying on any single data source, including this one.</li>
        </ul>
      </div>

      <h2 style={h2}>3. Account responsibilities</h2>

      <p>If you sign in to Tidevisor, you&apos;re responsible for keeping
      your account secure: use a strong password on the email address you
      sign in with, and don&apos;t forward magic-link emails to others.
      Notify us immediately if you suspect unauthorized access.</p>

      <h2 style={h2}>4. Acceptable use</h2>

      <p>You may use Tidevisor for personal, non-commercial purposes. You
      agree not to:</p>

      <ul style={ul}>
        <li>Scrape or systematically harvest data from the dashboard.</li>
        <li>Use the service to defame, harass, or harm anyone.</li>
        <li>Attempt to gain unauthorized access to our systems or other users&apos; accounts.</li>
        <li>Reverse-engineer the service in a way that would impair its operation.</li>
        <li>Use the service in a way that violates applicable laws.</li>
      </ul>

      <p>We reserve the right to terminate accounts that violate these
      restrictions.</p>

      <h2 style={h2}>5. Intellectual property</h2>

      <p>The Tidevisor brand, design, and code are owned by the creator.
      The underlying weather and marine data come from public-domain
      sources and remain in the public domain.</p>

      <h2 style={h2}>6. Limitation of liability</h2>

      <p><strong>To the maximum extent permitted by law:</strong></p>

      <ul style={ul}>
        <li>Tidevisor is provided <strong>&quot;as is&quot;</strong> and{" "}
        <strong>&quot;as available&quot;</strong>, without warranty of any
        kind, express or implied.</li>
        <li>We make no warranty about the accuracy, completeness, or
        timeliness of the data shown.</li>
        <li>We are not liable for any damages arising from your use of the
        service, including but not limited to property damage, personal
        injury, or loss of life resulting from decisions made based on the
        information displayed.</li>
        <li>Our total aggregate liability to you for any claim is limited
        to the amount you have paid us in the past 12 months (which, for
        free-tier users, is $0).</li>
      </ul>

      <p>You acknowledge that you use Tidevisor at your own risk.</p>

      <h2 style={h2}>7. Service availability</h2>

      <p>We don&apos;t guarantee uptime. The service may be unavailable
      due to maintenance, third-party API outages (NOAA, Vercel, Supabase,
      etc.), or other issues. We&apos;ll try to communicate planned
      maintenance in advance, but unplanned outages do happen.</p>

      <h2 style={h2}>8. Termination</h2>

      <p>You may stop using Tidevisor at any time and request account
      deletion via{" "}
      <a href={`mailto:${CONTACT_EMAIL}`} style={link}>{CONTACT_EMAIL}</a>.
      We may suspend or terminate accounts that violate these terms; in
      most cases we&apos;ll contact you first.</p>

      <h2 style={h2}>9. Changes to these terms</h2>

      <p>We may update these terms from time to time. The
      &quot;Effective&quot; date above will change when we do. Material
      changes will be communicated via the dashboard or the daily briefing
      email. Continued use after changes constitutes acceptance.</p>

      <h2 style={h2}>10. Governing law</h2>

      <p>These terms are governed by the laws of the State of{" "}
      {GOVERNING_STATE}, USA, without regard to its conflict-of-laws
      principles. Any disputes will be resolved in the state or federal
      courts located in {GOVERNING_STATE}.</p>

      <h2 style={h2}>11. Contact</h2>

      <p>Questions about these terms? Email{" "}
      <a href={`mailto:${CONTACT_EMAIL}`} style={link}>{CONTACT_EMAIL}</a>.</p>
    </article>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────

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
/** The marine-safety disclaimer gets a tinted box around it so it
 *  visually reads as the most important section of the page. */
const dangerBox: React.CSSProperties = {
  margin: "32px 0",
  padding: "16px 18px",
  background: "var(--bad-soft, rgba(196, 68, 68, 0.06))",
  border: "1px solid var(--bad, #c44)",
  borderRadius: 10,
};
