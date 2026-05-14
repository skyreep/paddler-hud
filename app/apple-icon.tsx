import { ImageResponse } from "next/og";

// 180x180 PNG that iOS uses when a user picks "Add to Home Screen".
// iOS automatically rounds the corners, so we render a square fill.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #07111a 0%, #0f6ea8 55%, #5cb8e8 100%)",
      }}>
        <svg width="140" height="140" viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g stroke="#ffffff" strokeWidth="12" strokeLinecap="round" fill="none">
            <path d="M22 78 q15 -16 30 0 t30 0 t30 0 t30 0 t30 0" />
            <path d="M22 110 q15 -16 30 0 t30 0 t30 0 t30 0 t30 0" opacity="0.7" />
            <path d="M22 142 q15 -16 30 0 t30 0 t30 0 t30 0 t30 0" opacity="0.4" />
          </g>
        </svg>
      </div>
    ),
    { ...size }
  );
}
