console.log("Injected");
console.log("Kofta999's fork with Tadoku support");

import { applyThemeSync, applyTheme } from "../themes/apply_theme";
applyThemeSync();
applyTheme();

import * as browser from "webextension-polyfill";
import { VNStorage } from "./vn_storage";
import App from "./vn.svelte";
import { mount } from "svelte";
import { Tadoku } from "../tadoku";

const setup = async () => {
  const vn_storage = await VNStorage.build(true);
  const tadoku = new Tadoku();

  let prevTime = vn_storage.instance_storage?.today_stats?.time_read;

  let port;
  const connectMessaging = () => {
    port = browser.runtime.connect({ name: "vn_lines" });
    port.onDisconnect.addListener(connectMessaging);

    port.onMessage.addListener(async (data) => {
      // Luna connection status pushed from background
      if (data.luna_connected !== undefined) {
        document.dispatchEvent(new CustomEvent("ws_status", {
          detail: { luna: data.luna_connected, tadoku: tadoku.isConnected }
        }));
        return;
      }

      try {
        await vn_storage.changeInstance(undefined, data["process_path"]);
        await vn_storage.addLine(data["line"], data["date"], data["time"]);
      } catch (e: any) {
        const isQuota =
          e?.name === "QuotaExceededError" ||
          (typeof e?.message === "string" && e.message.includes("QUOTA_BYTES"));
        if (isQuota) {
          console.warn(
            "exSTATic: storage quota exceeded — line was not saved. " +
            "Export and clear old line data to free space.",
          );
        } else {
          console.error("exSTATic: failed to add line:", e);
        }
        return;
      }

      const timeRead = vn_storage.instance_storage?.today_stats.time_read;

      if (timeRead) {
        const delta = timeRead - (prevTime || timeRead);
        const charsRead = await vn_storage.instance_storage?.getTotalCharsRead();
        tadoku.send(delta, data["original_process_path"], charsRead);
        prevTime = timeRead;
      }
    });
  };
  connectMessaging();

  // Keep the background service worker alive — Chrome MV3 suspends it after
  // ~30s of idle causing a ~400ms wakeup delay on the next line.
  // Pinging every 25s via the existing port resets the idle timer.
  setInterval(() => {
    try { port.postMessage({ ping: true }); } catch { /* port may briefly disconnect on reconnect */ }
  }, 25000);

  // Tadoku status: event-driven, fires immediately on connect/disconnect
  tadoku.onStatusChange((connected) => {
    document.dispatchEvent(new CustomEvent("ws_status", {
      detail: { tadoku: connected }
    }));
  });

  mount(App, {
    target: document.documentElement,
    props: {
      vn_storage: vn_storage,
    },
  });
};
setup();