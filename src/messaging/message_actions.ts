import * as browser from "webextension-polyfill";
import { getLunaConnected } from "./socket_actions";

interface MessageActionArgs {
  action: "open_tab" | "download" | "get_connection_status" | "vndb_search" | "auto_detect_vndb";
  url?: string | Blob;
  filename?: string;
  query?: string;
  uuid?: string;
}

export function cleanSearchQuery(title: string): string {
  let q = title.trim();
  q = q.replace(/\.(exe|bin|app)$/i, "");
  const withoutBrackets = q.replace(/\[[^\]]*\]|\([^\)]*\)/g, "").trim();
  if (withoutBrackets.length >= 2) {
    q = withoutBrackets;
  }
  return q;
}

export async function fetchVndbSearch(rawQuery: string) {
  const cleaned = cleanSearchQuery(rawQuery);
  const queriesToTry = [cleaned];
  if (cleaned !== rawQuery.trim()) {
    queriesToTry.push(rawQuery.trim());
  }

  for (const q of queriesToTry) {
    try {
      const resp = await fetch("https://api.vndb.org/kana/vn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: ["search", "=", q],
          fields: "id, title, alttitle",
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.results && data.results.length > 0) {
          return data.results;
        }
      }
    } catch {
      // try next
    }
  }
  return [];
}

export async function message_action(args: MessageActionArgs) {
  if (args.action === "open_tab" && args.url && typeof args.url === "string") {
    await open_tab(args.url);
  } else if (args["action"] == "download") {
    await download(args);
  } else if (args["action"] == "get_connection_status") {
    return { luna: getLunaConnected() };
  } else if (args.action === "vndb_search" && args.query) {
    try {
      const results = await fetchVndbSearch(args.query);
      return { results };
    } catch (e: any) {
      return { error: e?.message ?? "VNDB search failed", results: [] };
    }
  } else if (args.action === "auto_detect_vndb" && args.uuid && args.query) {
    try {
      const results = await fetchVndbSearch(args.query);
      if (results && results.length > 0) {
        const best = results[0];
        const raw = await browser.storage.local.get(args.uuid);
        const details = raw[args.uuid];
        if (details) {
          details.vndb_id = best.id;
          await browser.storage.local.set({ [args.uuid]: details });
        }
        return { success: true, vndb_id: best.id, title: best.title };
      }
      return { success: false, results: [] };
    } catch (e: any) {
      return { error: e?.message ?? "VNDB detection failed", results: [] };
    }
  }
}

async function download(args: MessageActionArgs) {
  await browser.downloads.download({
    url:
      typeof args["url"] !== "string"
        ? URL.createObjectURL(args["url"])
        : args["url"],
    filename: args["filename"],
  });
}

async function open_tab(url: string) {
  await browser.tabs.create({ url: url });
}
