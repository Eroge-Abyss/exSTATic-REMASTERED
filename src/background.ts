console.log("exSTATic");

import { message_action, runTadokuDayResetAutoPush } from "./messaging/message_actions";
import {
  connectionClosed,
  connectionOpened,
  dataFetched,
  initLunaSocket,
  messagingConnected,
} from "./messaging/socket_actions";

import * as browser from "webextension-polyfill";
import type { Tabs } from "webextension-polyfill";
import ReconnectingWebSocket from "reconnecting-websocket";

declare global {
  interface Window {
    chrome:
      | {
          runtime: object | undefined;
          webstore: object | undefined;
        }
      | undefined;
  }
  interface DocumentEventMap {
    media_changed: CustomEvent;
    new_line: CustomEvent;
    "ttsu:page.change": CustomEvent;
    ws_status: CustomEvent;
  }
}

const reloadTab = async (tab: Tabs.Tab) => {
  if (!tab.id) return;
  browser.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.location.reload(),
  });
};

// Run a function with each tab that has a content script
const runOnContentScripts = async (func: (tab: Tabs.Tab) => void) => {
  for (const content_script of browser.runtime.getManifest().content_scripts ??
    []) {
    for (const tab of await browser.tabs.query({ url: content_script.matches }))
      func(tab);
  }
};

const setupContextMenus = async () => {
  try {
    if (!browser.contextMenus) return;
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: "open_tracker",
      title: "Open Tracker",
      contexts: ["action"],
    });
    browser.contextMenus.create({
      id: "open_stats",
      title: "Open Statistics",
      contexts: ["action"],
    });
    browser.contextMenus.create({
      id: "open_settings",
      title: "Open Settings",
      contexts: ["action"],
    });
  } catch (e) {
    console.error("Failed to setup context menus:", e);
  }
};

const setupTadokuAlarms = async () => {
  try {
    if (!browser.alarms) return;
    await browser.alarms.clear("tadoku_day_check");
    browser.alarms.create("tadoku_day_check", { periodInMinutes: 15 });
  } catch (e) {
    console.error("Failed to setup alarms:", e);
  }
};

if (browser.alarms && browser.alarms.onAlarm) {
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "tadoku_day_check") {
      await runTadokuDayResetAutoPush().catch(() => {});
    }
  });
}

if (browser.runtime.onStartup) {
  browser.runtime.onStartup.addListener(async () => {
    await runTadokuDayResetAutoPush().catch(() => {});
  });
}

browser.runtime.onUpdateAvailable.addListener(() => browser.runtime.reload());
browser.runtime.onInstalled.addListener(async () => {
  setupContextMenus();
  setupTadokuAlarms();
  runTadokuDayResetAutoPush().catch(() => {});

  if (!(await browser.storage.local.get("client"))["client"])
    await browser.storage.local.set({ client: crypto.randomUUID() });

  console.log(
    "Client UUID: " + (await browser.storage.local.get("client"))["client"],
  );

  if (!(await browser.storage.local.get("schema_version"))["schema_version"])
    await browser.storage.local.set({ schema_version: 2 });

  console.log("Reloading all extension tabs...");
  runOnContentScripts(reloadTab);
});

setupContextMenus();
setupTadokuAlarms();
runTadokuDayResetAutoPush().catch(() => {});

browser.contextMenus.onClicked.addListener(async (info) => {
  const urlMap: Record<string, string> = {
    open_tracker: "https://kamwithk.github.io/exSTATic/tracker.html",
    open_stats: "https://kamwithk.github.io/exSTATic/stats.html",
    open_settings: "https://kamwithk.github.io/exSTATic/settings.html",
  };

  const targetUrl = urlMap[info.menuItemId as string];
  if (targetUrl) {
    const tabs = await browser.tabs.query({ url: `${targetUrl}*` });
    if (tabs.length > 0 && tabs[0].id !== undefined) {
      await browser.tabs.update(tabs[0].id, { active: true });
    } else {
      await browser.tabs.create({ url: targetUrl });
    }
  }
});

// Message passing is used for actions which can only be performed on the background page
browser.runtime.onMessage.addListener(message_action);

browser.action.onClicked.addListener(async () => {
  const listen_status = (await browser.storage.local.get("listen_status"))[
    "listen_status"
  ];

  if (listen_status == true || listen_status === undefined) {
    await browser.action.setIcon({
      path: {
        "100": "/docs/disabled_100x100.png",
        "500": "/docs/disabled.png",
      },
    });

    await browser.storage.local.set({
      listen_status: false,
    });
  } else {
    await browser.action.setIcon({
      path: {
        "100": "/docs/favicon_100x100.png",
        "500": "/docs/favicon.png",
      },
    });

    await browser.storage.local.set({
      listen_status: true,
    });
  }
});

let socket = new ReconnectingWebSocket("ws://localhost:9001");
initLunaSocket(socket);

socket.addEventListener("open", connectionOpened);
socket.addEventListener("close", connectionClosed);
socket.addEventListener("error", connectionClosed);
socket.addEventListener("message", (event: MessageEvent) => {
  dataFetched(event);
});

browser.runtime.onConnect.addListener(messagingConnected);
