console.log("Injected");

import { applyThemeSync, applyTheme } from "../themes/apply_theme";
applyThemeSync();
applyTheme();

import { getData } from "../data_wrangling/data_extraction";
import Stats from "./stats.svelte";

import { parseISO } from "date-fns";
import { mount } from "svelte";

function safeParseDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const iso = parseISO(trimmed);
    if (!isNaN(iso.getTime())) return iso;
    const fallback = new Date(trimmed.replace(/\//g, "-"));
    if (!isNaN(fallback.getTime())) return fallback;
    const direct = new Date(trimmed);
    if (!isNaN(direct.getTime())) return direct;
  }
  return null;
}

const setup = async () => {
  const rawData = await getData();
  const validData = (rawData ?? []).filter((d) => safeParseDate(d?.date) !== null);

  mount(Stats, {
    target: document.documentElement,
    props: {
      data: validData.sort(
        (first, second) =>
          (safeParseDate(first["date"])?.valueOf() ?? 0) -
          (safeParseDate(second["date"])?.valueOf() ?? 0),
      ),
    },
  });
};
setup();

export {};
