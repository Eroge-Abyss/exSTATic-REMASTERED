import * as browser from "webextension-polyfill";
import { themes, type ThemeId } from "./themes";

let storageListenerAdded = false;

function applyTokens(id: ThemeId) {
  const tokens = themes[id] ?? themes.dark;
  const root = document.documentElement;
  if (root) {
    for (const [key, val] of Object.entries(tokens)) {
      root.style.setProperty(key, val);
    }
    root.style.backgroundColor = tokens["--exs-backdrop"];
    root.style.colorScheme = id === "white" ? "light" : "dark";
    root.setAttribute("data-theme", id);
  }
  if (typeof document !== "undefined" && document.body) {
    document.body.style.backgroundColor = tokens["--exs-backdrop"];
  }
  // Also persist synchronously so the content script / inline script can avoid the FOUC
  try {
    localStorage.setItem("exs_theme", id);
  } catch {}
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("exs-theme-changed", { detail: { theme: id } }));
    } catch {}
  }
}

export function applyThemeSync(): ThemeId {
  let id: ThemeId = "dark";
  try {
    const saved = localStorage.getItem("exs_theme") as ThemeId;
    if (saved && saved in themes) id = saved;
  } catch {}
  applyTokens(id);
  return id;
}

export async function getTheme(): Promise<ThemeId> {
  try {
    const data = await browser.storage.local.get("exs_theme");
    return (data.exs_theme as ThemeId) ?? "dark";
  } catch {
    return "dark";
  }
}

export async function applyTheme(): Promise<ThemeId> {
  if (!storageListenerAdded && typeof window !== "undefined") {
    storageListenerAdded = true;
    try {
      browser.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.exs_theme) {
          applyTokens((changes.exs_theme.newValue as ThemeId) ?? "dark");
        }
      });
    } catch {}
  }

  const id = await getTheme();
  applyTokens(id);
  return id;
}

export async function setTheme(id: ThemeId): Promise<void> {
  await browser.storage.local.set({ exs_theme: id });
  applyTokens(id);
}

