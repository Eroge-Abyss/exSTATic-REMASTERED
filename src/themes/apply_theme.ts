import * as browser from "webextension-polyfill";
import { themes, type ThemeId } from "./themes";

let storageListenerAdded = false;

function applyTokens(id: ThemeId) {
  const tokens = themes[id] ?? themes.dark;
  const root = document.documentElement;
  for (const [key, val] of Object.entries(tokens)) {
    root.style.setProperty(key, val);
  }
  root.setAttribute("data-theme", id);
}

export async function getTheme(): Promise<ThemeId> {
  const data = await browser.storage.local.get("exs_theme");
  return (data.exs_theme as ThemeId) ?? "dark";
}

export async function applyTheme(): Promise<ThemeId> {
  if (!storageListenerAdded && typeof window !== "undefined") {
    storageListenerAdded = true;
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.exs_theme) {
        applyTokens((changes.exs_theme.newValue as ThemeId) ?? "dark");
      }
    });
  }

  const id = await getTheme();
  applyTokens(id);
  return id;
}

export async function setTheme(id: ThemeId): Promise<void> {
  await browser.storage.local.set({ exs_theme: id });
  applyTokens(id);
}
