import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Paddler HUD",
  description: "Mobile-first marine dashboard for paddlers of the Lowcountry.",
  applicationName: "Paddler HUD",
  // When added to an iOS home screen, the app launches in standalone mode
  // (no Safari chrome) with a translucent status bar over the topbar.
  appleWebApp: {
    capable: true,
    title: "Paddler HUD",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,   // don't autolink phone-number-shaped strings
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f5f8" },
    { media: "(prefers-color-scheme: dark)",  color: "#0a1b26" },
  ],
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
        {/* Set initial theme before paint to avoid a flash.
            Defensive about iOS Safari edge cases:
            - localStorage may throw in private mode (handled with try/catch).
            - matchMedia.matches sometimes returns stale "false" on first paint
              even when system is dark; we re-check in TopBar.tsx after hydration. */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var dark = false;
            try {
              var saved = null;
              try { saved = localStorage.getItem('phud_theme'); } catch (e) {}
              var t = saved || 'auto';
              if (t === 'dark') {
                dark = true;
              } else if (t === 'auto') {
                try {
                  var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
                  dark = !!(mq && mq.matches);
                } catch (e) {}
              }
            } catch (e) {}
            document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
          })();
        `}} />
      </head>
      <body>{children}</body>
    </html>
  );
}
