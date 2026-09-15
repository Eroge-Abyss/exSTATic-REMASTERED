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
          hover: "var(--exs-accent-hover)"
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
