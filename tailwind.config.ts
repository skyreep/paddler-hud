import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        bg: "var(--bg)",
        "bg-elev": "var(--bg-elev)",
        "bg-elev-2": "var(--bg-elev-2)",
        border: "var(--border)",
        "border-soft": "var(--border-soft)",
        text: "var(--text)",
        "text-muted": "var(--text-muted)",
        "text-faint": "var(--text-faint)",
        accent: "var(--accent)",
        "accent-2": "var(--accent-2)",
        "accent-soft": "var(--accent-soft)",
        good: "var(--good)",
        "good-soft": "var(--good-soft)",
        warn: "var(--warn)",
        "warn-soft": "var(--warn-soft)",
        bad: "var(--bad)",
        "bad-soft": "var(--bad-soft)",
      },
      borderRadius: { tile: "16px" },
    },
  },
  plugins: [],
};
export default config;
