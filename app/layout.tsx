import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Paddler HUD",
  description: "Mobile-first marine dashboard for paddlers of the Lowcountry.",
};

export const viewport: Viewport = {
  themeColor: "#0a1b26",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap"
        />
        {/* Set initial theme before paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            try {
              var t = localStorage.getItem('phud_theme') || 'auto';
              var dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
              document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
            } catch (e) {}
          })();
        `}} />
      </head>
      <body>{children}</body>
    </html>
  );
}
