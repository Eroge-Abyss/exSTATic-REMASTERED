const colors = require('tailwindcss/colors')

/** @type {import("tailwindcss").Config} */ 
module.exports = {
    content: ["./src/**/*\.{html,css,js,ts,svelte}"],
    theme: {
      extend: {
        colors: {
          backdrop: "var(--exs-backdrop)",
          block: "var(--exs-block)",
          surface: "var(--exs-surface)",
          title: "var(--exs-title)",
          text: "var(--exs-text)",
          "button-text": "var(--exs-accent-dim)",
          icon: "var(--exs-icon)",
          menu: "var(--exs-menu-bg)",
          "menu-text": "var(--exs-menu-text)",
          button: "var(--exs-accent)",
          hover: "var(--exs-accent-hover)",
          dim: "var(--exs-border-dim, rgba(255, 255, 255, 0.08))",
          border: "var(--exs-border, rgba(255, 255, 255, 0.1))"
        },
        borderColor: {
          DEFAULT: "var(--exs-border, rgba(255, 255, 255, 0.08))",
          dim: "var(--exs-border-dim, rgba(255, 255, 255, 0.06))",
          border: "var(--exs-border, rgba(255, 255, 255, 0.1))"
        }
      }
    },
    variants: {
      extend: {}
    },
    plugins: [
      require("@tailwindcss/forms")
    ]
}
