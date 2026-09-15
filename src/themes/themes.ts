export type ThemeId = "dark" | "white" | "black";

export interface ThemeTokens {
  [key: `--exs-${string}`]: string;
}

export const themes: Record<ThemeId, ThemeTokens> = {
  dark: {
    "--exs-backdrop": "#1e293b", // slate-800
    "--exs-block": "#0f172a", // slate-900
    "--exs-surface": "#1e293b",
    "--exs-chart-bg": "#0f172a",
    "--exs-title": "#818cf8", // indigo-400
    "--exs-text": "#94a3b8", // slate-400
    "--exs-text-strong": "#e2e8f0", // slate-200
    "--exs-text-muted": "#64748b", // slate-500
    "--exs-accent": "#818cf8", // indigo-400
    "--exs-accent-dim": "#6366f1", // indigo-500
    "--exs-accent-hover": "#4338ca", // indigo-700
    "--exs-icon": "#ffffff",
    "--exs-menu-bg": "#334155", // slate-700
    "--exs-menu-text": "#d1d5db", // gray-300
    "--exs-border": "#334155", // slate-700
    "--exs-border-dim": "#1e293b",
    "--exs-card-bg": "#6d78d2",
    "--exs-card-border": "#3e36b4",
    "--exs-card-line": "#3e36b4",
    "--exs-card-text": "#000000",
    "--exs-btn-primary-bg": "#4f46e5",
    "--exs-btn-primary-text": "#ffffff",
    "--exs-heatmap-empty": "rgba(255, 255, 255, 0.07)",
    "--exs-section-shadow": "0 4px 24px rgba(0, 0, 0, 0.4)",
  },
  white: {
    "--exs-backdrop": "#f8fafc", // slate-50
    "--exs-block": "#f1f5f9", // slate-100
    "--exs-surface": "#ffffff",
    "--exs-chart-bg": "#ffffff",
    "--exs-title": "#4f46e5", // indigo-600
    "--exs-text": "#334155", // slate-700
    "--exs-text-strong": "#0f172a", // slate-900
    "--exs-text-muted": "#64748b", // slate-500
    "--exs-accent": "#4f46e5", // indigo-600
    "--exs-accent-dim": "#4338ca", // indigo-700
    "--exs-accent-hover": "#3730a3", // indigo-800
    "--exs-icon": "#1e293b", // slate-800
    "--exs-menu-bg": "#e2e8f0", // slate-200
    "--exs-menu-text": "#1e293b", // slate-800
    "--exs-border": "#cbd5e1", // slate-300
    "--exs-border-dim": "#e2e8f0",
    "--exs-card-bg": "#e0e7ff", // indigo-100
    "--exs-card-border": "#a5b4fc", // indigo-300
    "--exs-card-line": "#a5b4fc",
    "--exs-card-text": "#1e1b4b",
    "--exs-btn-primary-bg": "#4f46e5",
    "--exs-btn-primary-text": "#ffffff",
    "--exs-heatmap-empty": "#e2e8f0",
    "--exs-section-shadow": "0 2px 12px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.07)",
  },
  black: {
    "--exs-backdrop": "#070614",
    "--exs-block": "#0d0b1f",
    "--exs-surface": "#13102a",
    "--exs-chart-bg": "#070614",
    "--exs-title": "#818cf8",
    "--exs-text": "#a1a1aa",
    "--exs-text-strong": "#f4f4f5",
    "--exs-text-muted": "#71717a",
    "--exs-accent": "#818cf8",
    "--exs-accent-dim": "#6366f1",
    "--exs-accent-hover": "#4338ca",
    "--exs-icon": "#ffffff",
    "--exs-menu-bg": "#181533",
    "--exs-menu-text": "#e4e4e7",
    "--exs-border": "#29244f",
    "--exs-border-dim": "#181533",
    "--exs-card-bg": "#6d78d2",
    "--exs-card-border": "#3e36b4",
    "--exs-card-line": "#3e36b4",
    "--exs-card-text": "#000000",
    "--exs-btn-primary-bg": "#4f46e5",
    "--exs-btn-primary-text": "#ffffff",
    "--exs-heatmap-empty": "#181533",
    "--exs-section-shadow": "0 4px 24px rgba(0, 0, 0, 0.8), 0 0 0 1px #29244f",
  },
};
