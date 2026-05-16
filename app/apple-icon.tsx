// iOS home-screen icon for "Add to Home Screen."
//
// Previously generated dynamically with `next/og`'s ImageResponse, but
// @vercel/og's bundled-font path resolution breaks on Windows dev when the
// user's home directory has a space ("C:\Users\Skyler Reep\..." gets
// URL-encoded to "%20" and then file://-mangled into an Invalid URL). The
// font load happens at module init, BEFORE `fonts: []` can take effect,
// so `fonts: []` alone is not enough — we have to avoid importing
// `next/og` entirely from this route.
//
// Serving the icon as a raw SVG Response bypasses @vercel/og completely.
// Modern iOS (14+) accepts SVG for apple-touch-icon; older iOS will fall
// back to icon.svg (which the manifest also references).

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#07111a"/>
      <stop offset="0.55" stop-color="#0f6ea8"/>
      <stop offset="1" stop-color="#5cb8e8"/>
    </linearGradient>
  </defs>
  <rect width="192" height="192" rx="32" fill="url(#bg)"/>
  <g stroke="#ffffff" stroke-width="12" stroke-linecap="round" fill="none">
    <path d="M22 78 q15 -16 30 0 t30 0 t30 0 t30 0 t30 0"/>
    <path d="M22 110 q15 -16 30 0 t30 0 t30 0 t30 0 t30 0" opacity="0.7"/>
    <path d="M22 142 q15 -16 30 0 t30 0 t30 0 t30 0 t30 0" opacity="0.4"/>
  </g>
</svg>`;

export const contentType = "image/svg+xml";
export const size = { width: 180, height: 180 };

export default function AppleIcon() {
  return new Response(SVG, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
