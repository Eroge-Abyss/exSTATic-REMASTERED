import type { Runtime } from "webextension-polyfill";
import { dateNowString, timeNowSeconds } from "../calculations";

import * as browser from "webextension-polyfill";

import ReconnectingWebSocket from "reconnecting-websocket";

export const SPLIT_PATH = /\\|\//g;

let lunaSocket: ReconnectingWebSocket | null = null;
let port: Runtime.Port | undefined;

export function initLunaSocket(socket: ReconnectingWebSocket) {
  lunaSocket = socket;
}

export function getLunaConnected() {
  return lunaSocket?.readyState === WebSocket.OPEN;
}

export function connectionOpened() {
  console.log("Connected");
  port?.postMessage({ luna_connected: true });
}

export function connectionClosed() {
  console.log("Connection Lost");
  port?.postMessage({ luna_connected: false });
}

export function messagingConnected(port_: Runtime.Port) {
  console.log("Messaging Connected: ", port_);
  port = port_;

  // Immediately send current Luna status when the content script connects
  port.postMessage({ luna_connected: getLunaConnected() });

  port.onDisconnect.addListener(messagingDisconnected);
}

function messagingDisconnected(port_: Runtime.Port) {
  console.log("Messaging Disconnected: ", port_);

  if (port === port_) {
    port = undefined;
  }
}

// Cache listen_status so dataFetched doesn't block on storage.get every message.
// Defaults to true (active) until the stored value is read back.
let listen_status_cached = true;
browser.storage.local.get("listen_status").then((r) => {
  listen_status_cached = r["listen_status"] ?? true;
});
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "listen_status" in changes) {
    listen_status_cached = changes["listen_status"].newValue ?? true;
  }
});

export function dataFetched(event: MessageEvent) {
  if (listen_status_cached === false) return;

  // Start by getting a timestamp for accuracy
  const time = timeNowSeconds();
  const date = dateNowString();

  // Parse provided data
  const data = JSON.parse(event.data);
  console.log("Recieved Socket Data: ", data);

  if ("type" in data && data.type === "translate") return;

  // Lines will have a valid process path and sentence
  if (
    !data.hasOwnProperty("process_path") ||
    !data.hasOwnProperty("sentence")
  ) {
    return;
  }

  let process_path = data["process_path"];
  // Wrap with newlines so that yomichan's default sentence parsing will work
  const line = "\n" + data["sentence"] + "\n";

  // Only consider at max the last three sections of the path
  const path_segments = process_path.split(SPLIT_PATH);
  process_path = path_segments
    .slice(Math.max(0, path_segments.length - 3))
    .join("/");

  port?.postMessage({
    line: line,
    process_path: process_path,
    original_process_path: data["process_path"],
    date: date,
    time: time,
  });
}
