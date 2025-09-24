import fluidType from "tailwindcss-fluid-type";
import defaultTheme from "tailwindcss/defaultTheme";

/** @type {import("tailwindcss").Config} */
const config = {
  content: ["./src/**/*.{astro,html,js,jsx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter Variable", ...defaultTheme.fontFamily.sans],
      },
      colors: {
        primary: "var(--color-primary)",
        secondary: "var(--color-secondary)",
      },
      textColor: {
        default: "var(--color-text)",
        offset: "var(--color-text-offset)",
        secondary: "var(--color-secondary)",
      },
      backgroundColor: {
        default: "var(--color-background)",
        offset: "var(--color-background-offset)",
        secondary: "var(--color-secondary)",
      },
      borderColor: {
        default: "var(--color-border)",
      },
      ringColor: {
        secondary: "var(--color-secondary)",
      },
    },
  },
  corePlugins: {
    fontSize: false,
  },
  plugins: [fluidType],
};

export default config;
