export type ThemeId =
  | "dark"
  | "white"
  | "tadoku-default"
  | "tokyo-night"
  | "sakura"
  | "ocean-blue"
  | "forest-green";

export interface ThemeTokens {
  [key: `--exs-${string}`]: string;
}

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  primary: string;
  background: string;
  accent: string;
}

export const themeList: ThemeInfo[] = [
  { id: "dark", name: "Classic Dark", primary: "#818cf8", background: "#1e293b", accent: "#334155" },
  { id: "white", name: "White", primary: "#4f46e5", background: "#f8fafc", accent: "#e2e8f0" },
  { id: "tadoku-default", name: "Tadoku Dark", primary: "#bb9af7", background: "#1b1b1b", accent: "#2a2a2a" },
  { id: "tokyo-night", name: "Tokyo Night", primary: "#bb9af7", background: "#1a1b26", accent: "#24283b" },
  { id: "sakura", name: "Sakura Pink", primary: "#f978b6", background: "#1f1d2e", accent: "#2d2a3e" },
  { id: "ocean-blue", name: "Ocean Blue", primary: "#7aa2f7", background: "#192330", accent: "#24283b" },
  { id: "forest-green", name: "Forest Green", primary: "#9ece6a", background: "#1e2030", accent: "#282e44" },
];

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
    "--exs-accent-text": "#ffffff",
    "--exs-icon": "#ffffff",
    "--exs-menu-bg": "#334155", // slate-700
    "--exs-menu-text": "#d1d5db", // gray-300
    "--exs-border": "#334155", // slate-700
    "--exs-border-dim": "#1e293b",
    "--exs-card-bg": "#818cf8",
    "--exs-card-border": "transparent",
    "--exs-card-line": "transparent",
    "--exs-card-text": "#0f172a",
    "--exs-btn-primary-bg": "#4f46e5",
    "--exs-btn-primary-text": "#ffffff",
    "--exs-heatmap-empty": "rgba(255, 255, 255, 0.07)",
    "--exs-heatmap-lo": "#818cf8",
    "--exs-heatmap-hi": "#4338ca",
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
    "--exs-accent-text": "#ffffff",
    "--exs-icon": "#1e293b", // slate-800
    "--exs-menu-bg": "#e2e8f0", // slate-200
    "--exs-menu-text": "#1e293b", // slate-800
    "--exs-border": "#cbd5e1", // slate-300
    "--exs-border-dim": "#e2e8f0",
    "--exs-card-bg": "#4f46e5",
    "--exs-card-border": "transparent",
    "--exs-card-line": "transparent",
    "--exs-card-text": "#ffffff",
    "--exs-btn-primary-bg": "#4f46e5",
    "--exs-btn-primary-text": "#ffffff",
    "--exs-heatmap-empty": "#e2e8f0",
    "--exs-heatmap-lo": "#818cf8",
    "--exs-heatmap-hi": "#4338ca",
    "--exs-section-shadow": "0 2px 12px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.07)",
  },
  "tadoku-default": {
    "--exs-backdrop": "#1b1b1b",
    "--exs-block": "#141414",
    "--exs-surface": "#2a2a2a",
    "--exs-chart-bg": "#141414",
    "--exs-title": "#bb9af7",
    "--exs-text": "#9ca3af",
    "--exs-text-strong": "#f3f3f3",
    "--exs-text-muted": "#6b7280",
    "--exs-accent": "#bb9af7",
    "--exs-accent-dim": "#9d7ada",
    "--exs-accent-hover": "#7a52c4",
    "--exs-accent-text": "#131022",
    "--exs-icon": "#ffffff",
    "--exs-menu-bg": "#2a2a2a",
    "--exs-menu-text": "#d1d5db",
    "--exs-border": "#383838",
    "--exs-border-dim": "#222222",
    "--exs-card-bg": "#bb9af7",
    "--exs-card-border": "transparent",
    "--exs-card-line": "transparent",
    "--exs-card-text": "#131022",
    "--exs-btn-primary-bg": "#7c52c7",
    "--exs-btn-primary-text": "#ffffff",
    "--exs-heatmap-empty": "rgba(187, 154, 247, 0.08)",
    "--exs-heatmap-lo": "#d4b8fb",
    "--exs-heatmap-hi": "#7c4fd4",
    "--exs-section-shadow": "0 4px 24px rgba(0, 0, 0, 0.4)",
  },
  "tokyo-night": {
    "--exs-backdrop": "#1a1b26",
    "--exs-block": "#13141f",
    "--exs-surface": "#24283b",
    "--exs-chart-bg": "#13141f",
    "--exs-title": "#bb9af7",
    "--exs-text": "#9ca3af",
    "--exs-text-strong": "#f3f3f3",
    "--exs-text-muted": "#6b7280",
    "--exs-accent": "#bb9af7",
    "--exs-accent-dim": "#9d7ada",
    "--exs-accent-hover": "#7a52c4",
    "--exs-accent-text": "#13141f",
    "--exs-icon": "#ffffff",
    "--exs-menu-bg": "#24283b",
    "--exs-menu-text": "#d1d5db",
    "--exs-border": "#2f354f",
    "--exs-border-dim": "#1a1b26",
    "--exs-card-bg": "#bb9af7",
    "--exs-card-border": "transparent",
    "--exs-card-line": "transparent",
    "--exs-card-text": "#13141f",
    "--exs-btn-primary-bg": "#7c52c7",
    "--exs-btn-primary-text": "#ffffff",
    "--exs-heatmap-empty": "rgba(187, 154, 247, 0.08)",
    "--exs-heatmap-lo": "#d4b8fb",
    "--exs-heatmap-hi": "#7c4fd4",
    "--exs-section-shadow": "0 4px 24px rgba(0, 0, 0, 0.45)",
  },
  sakura: {
    "--exs-backdrop": "#1f1d2e",
    "--exs-block": "#161422",
    "--exs-surface": "#2d2a3e",
    "--exs-chart-bg": "#161422",
    "--exs-title": "#f978b6",
    "--exs-text": "#a69eb0",
    "--exs-text-strong": "#f8f7f9",
    "--exs-text-muted": "#786f85",
    "--exs-accent": "#f978b6",
    "--exs-accent-dim": "#d95897",
    "--exs-accent-hover": "#b83c79",
    "--exs-accent-text": "#1f1624",
    "--exs-icon": "#ffffff",
    "--exs-menu-bg": "#2d2a3e",
    "--exs-menu-text": "#e2dfe7",
    "--exs-border": "#3d3954",
    "--exs-border-dim": "#1f1d2e",
    "--exs-card-bg": "#f978b6",
    "--exs-card-border": "transparent",
    "--exs-card-line": "transparent",
    "--exs-card-text": "#1f1624",
    "--exs-btn-primary-bg": "#b83c79",
    "--exs-btn-primary-text": "#ffffff",
    "--exs-heatmap-empty": "rgba(249, 120, 182, 0.08)",
    "--exs-heatmap-lo": "#fbb3d5",
    "--exs-heatmap-hi": "#c43d7f",
    "--exs-section-shadow": "0 4px 24px rgba(0, 0, 0, 0.45)",
  },
  "ocean-blue": {
    "--exs-backdrop": "#192330",
    "--exs-block": "#121a24",
    "--exs-surface": "#24283b",
    "--exs-chart-bg": "#121a24",
    "--exs-title": "#7aa2f7",
    "--exs-text": "#8e9db3",
    "--exs-text-strong": "#f0f4f9",
    "--exs-text-muted": "#5b6c82",
    "--exs-accent": "#7aa2f7",
    "--exs-accent-dim": "#567ad4",
    "--exs-accent-hover": "#3d60b5",
    "--exs-accent-text": "#0f172a",
    "--exs-icon": "#ffffff",
    "--exs-menu-bg": "#24283b",
    "--exs-menu-text": "#d6dfeb",
    "--exs-border": "#303b54",
    "--exs-border-dim": "#192330",
    "--exs-card-bg": "#7aa2f7",
    "--exs-card-border": "transparent",
    "--exs-card-line": "transparent",
    "--exs-card-text": "#0f172a",
    "--exs-btn-primary-bg": "#3d63c4",
    "--exs-btn-primary-text": "#ffffff",
    "--exs-heatmap-empty": "rgba(122, 162, 247, 0.08)",
    "--exs-heatmap-lo": "#b3c9fb",
    "--exs-heatmap-hi": "#3d63c4",
    "--exs-section-shadow": "0 4px 24px rgba(0, 0, 0, 0.45)",
  },
  "forest-green": {
    "--exs-backdrop": "#1e2030",
    "--exs-block": "#151624",
    "--exs-surface": "#282e44",
    "--exs-chart-bg": "#151624",
    "--exs-title": "#9ece6a",
    "--exs-text": "#949ea8",
    "--exs-text-strong": "#f2f6ee",
    "--exs-text-muted": "#606975",
    "--exs-accent": "#9ece6a",
    "--exs-accent-dim": "#7ea84f",
    "--exs-accent-hover": "#618a35",
    "--exs-accent-text": "#0f1a0e",
    "--exs-icon": "#ffffff",
    "--exs-menu-bg": "#282e44",
    "--exs-menu-text": "#d9e2dc",
    "--exs-border": "#363d57",
    "--exs-border-dim": "#1e2030",
    "--exs-card-bg": "#9ece6a",
    "--exs-card-border": "transparent",
    "--exs-card-line": "transparent",
    "--exs-card-text": "#0f1a0e",
    "--exs-btn-primary-bg": "#5f8737",
    "--exs-btn-primary-text": "#ffffff",
    "--exs-heatmap-empty": "rgba(158, 206, 106, 0.08)",
    "--exs-heatmap-lo": "#c8e89b",
    "--exs-heatmap-hi": "#5a9030",
    "--exs-section-shadow": "0 4px 24px rgba(0, 0, 0, 0.45)",
  },
};
