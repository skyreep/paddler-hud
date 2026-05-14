import type { MetadataRoute } from "next";

/**
 * PWA manifest. Drives the "Install app" prompt on Android Chrome and gives
 * the home-screen icon a name, color, and standalone (no browser chrome)
 * launch behavior. iOS reads the apple-icon.tsx output separately.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Paddler HUD",
    short_name: "Paddler HUD",
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
      // Next.js routes app/apple-icon.tsx → /apple-icon (PNG, 180x180)
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
