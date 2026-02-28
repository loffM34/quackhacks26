/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx,html}", "./popup.html", "./sidepanel.html"],
  theme: {
    extend: {
      // ── Liquid Glass Dark-Blue Color Palette ──
      colors: {
        glass: {
          50: "#e8edf5",
          100: "#c5d0e6",
          200: "#9fb3d5",
          300: "#7895c4",
          400: "#5b7fb8",
          500: "#3e69ab", // primary
          600: "#365da3",
          700: "#2c4f99",
          800: "#234190",
          900: "#122b7f",
          950: "#0a1a4a", // deepest background
        },
        // Score color states
        score: {
          safe: "#22c55e", // green, ≤40%
          caution: "#eab308", // yellow, 40-70%
          danger: "#ef4444", // red, >70%
        },
      },
      // Backdrop blur for glassmorphism
      backdropBlur: {
        xs: "2px",
        glass: "16px",
        "glass-heavy": "24px",
      },
      // Box shadow — inner glow effect
      boxShadow: {
        "glass-inset": "inset 0 1px 1px 0 rgba(148, 163, 184, 0.15)",
        "glass-sm": "0 2px 8px 0 rgba(10, 26, 74, 0.3)",
        "glass-md": "0 4px 16px 0 rgba(10, 26, 74, 0.4)",
        "glass-glow": "0 0 20px 2px rgba(62, 105, 171, 0.25)",
      },
      // Border radius
      borderRadius: {
        glass: "16px",
        badge: "24px",
      },
      // Font sizes for Elder Mode
      fontSize: {
        "elder-sm": ["1.125rem", "1.75rem"],
        "elder-base": ["1.25rem", "1.875rem"],
        "elder-lg": ["1.5rem", "2.25rem"],
        "elder-xl": ["1.875rem", "2.5rem"],
      },
      // Animations
      keyframes: {
        "badge-pulse": {
          "0%, 100%": { transform: "scale(1)", opacity: "0.85" },
          "50%": { transform: "scale(1.05)", opacity: "1" },
        },
        "slide-in": {
          "0%": { transform: "translateX(100%)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "badge-pulse": "badge-pulse 2s ease-in-out infinite",
        "slide-in": "slide-in 0.3s ease-out",
        "fade-in": "fade-in 0.2s ease-out",
      },
    },
  },
  plugins: [],
};
