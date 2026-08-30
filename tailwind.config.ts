import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0E14",
        panel: "#131720",
        panelAlt: "#171C27",
        border: "#1F2530",
        text: "#E6E9EF",
        muted: "#7A8296",
        buy: "#34D399",
        sell: "#F87171",
        accent: "#5B8DEF",
        warn: "#F5B942",
      },
      fontFamily: {
        sans: ["'IBM Plex Sans'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
