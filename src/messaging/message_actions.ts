import * as browser from "webextension-polyfill";
import { getLunaConnected } from "./socket_actions";

interface MessageActionArgs {
  action: "open_tab" | "download" | "get_connection_status";
  url: string | Blob;
  filename?: string;
}

export async function message_action(args: MessageActionArgs) {
  if (args.action === "open_tab" && args.url && typeof args.url === "string") {
    await open_tab(args.url);
  } else if (args["action"] == "download") {
    await download(args);
  } else if (args["action"] == "get_connection_status") {
    return { luna: getLunaConnected() };
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
  try {
    const tabs = await browser.tabs.query({});
    const filename = url.split("/").pop()?.split("?")[0];
    const existingTab = filename
      ? tabs.find((t) => t.url && t.url.includes(filename))
      : undefined;

    if (existingTab && existingTab.id !== undefined) {
      await browser.tabs.update(existingTab.id, { active: true });
      return;
    }
  } catch (e) {
    console.error("Error finding existing tab:", e);
  }
  await browser.tabs.create({ url: url });
}
