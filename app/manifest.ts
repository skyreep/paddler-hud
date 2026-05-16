import type { MetadataRoute } from "next";

/**
 * PWA manifest. Drives the "Install app" prompt on Android Chrome and gives
 * the home-screen icon a name, color, and standalone (no browser chrome)
 * launch behavior. iOS reads the apple-icon.tsx output separately.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LoCo WX",
    short_name: "LoCo WX",
    description: "Marine conditions for paddlers of the Lowcountry — tides, currents, weather, radar, satellite, and more.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#07111a",
    theme_color: "#0a1b26",
    categories: ["weather", "navigation", "sports", "lifestyle"],
    icons: [
      // Next.js routes app/icon.svg → /icon.svg
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      // app/apple-icon.tsx now returns SVG (was a Vercel-OG PNG); iOS 14+
      // handles SVG home-screen icons fine, older iOS falls back to /icon.svg.
      { src: "/apple-icon", sizes: "180x180", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
