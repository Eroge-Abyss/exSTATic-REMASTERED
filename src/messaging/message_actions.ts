import * as browser from "webextension-polyfill";
import { getLunaConnected } from "./socket_actions";

interface MessageActionArgs {
  action: "open_tab" | "download" | "get_connection_status" | "vndb_search";
  url?: string | Blob;
  filename?: string;
  query?: string;
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
      const resp = await fetch("https://api.vndb.org/kana/vn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: ["search", "=", args.query],
          fields: "id, title, alttitle",
        }),
      });
      return await resp.json();
    } catch (e: any) {
      return { error: e?.message ?? "VNDB search failed", results: [] };
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
