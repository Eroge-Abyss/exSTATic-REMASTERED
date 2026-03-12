console.log("Injected");
console.log("Kofta999's fork with Tadoku support");

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

      await vn_storage.changeInstance(undefined, data["process_path"]);
      await vn_storage.addLine(data["line"], data["date"], data["time"]);

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