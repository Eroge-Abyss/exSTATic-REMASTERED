import { TypeStorage } from "../storage/type_storage";
import { InstanceStorage, type Stat } from "../storage/instance_storage";

import * as browser from "webextension-polyfill";
import type { DataEntry } from "./data_extraction";

export async function importStats(data: DataEntry[]) {
  for (const entry of data) {
    if (
      !entry.hasOwnProperty("type") ||
      !entry.hasOwnProperty("date") ||
      !entry.hasOwnProperty("given_identifier")
    ) {
      continue; // was: return — which killed the whole import on a single bad row (e.g. trailing empty CSV row)
    }

    const type_storage = await TypeStorage.buildTypeStorage(
      entry["type"] as string,
    );
    const uuid = await type_storage.addMedia(
      entry["given_identifier"] as string,
      entry["uuid"] as string | undefined,
    );

    let stats: Stat = { chars_read: 0, time_read: 0 };
    if (entry.hasOwnProperty("chars_read")) {
      stats.chars_read = entry["chars_read"] as number;
    }
    if (entry.hasOwnProperty("lines_read")) {
      stats.lines_read = entry["lines_read"] as number;
    }
    if (entry.hasOwnProperty("time_read")) {
      stats.time_read = entry["time_read"] as number;
    }

    const instance_storage = await InstanceStorage.buildInstance(uuid);

    if (entry.hasOwnProperty("name")) {
      await instance_storage.updateDetails({
        name: entry["name"] as string | undefined,
      });
    }

    await instance_storage.addToDates(entry["date"] as string);
    await instance_storage.addToDate(
      entry["date"] as string,
      entry["client"] as string,
    );

    if (Object.keys(stats).length !== 0) {
      await instance_storage.setDailyStats(
        entry["date"] as string,
        stats,
        entry["client"] as string,
      );
    }
  }
}

export async function importLines(data: { [key: string]: string | number }[]) {
  // Sort by time so lines are inserted in order
  data = data.filter((entry) => entry["uuid"] && entry["line"] !== undefined);
  data = data.sort(
    (first, second) => (first["time"] as number) - (second["time"] as number),
  );

  // Group lines by UUID so we can process each game in one batch
  const byUuid = new Map<string, { [key: string]: string | number }[]>();
  for (const entry of data) {
    const uuid = entry["uuid"] as string;
    if (!byUuid.has(uuid)) byUuid.set(uuid, []);
    byUuid.get(uuid)!.push(entry);
  }

  for (const [uuid, lines] of byUuid) {
    const instance_storage = await InstanceStorage.buildInstance(uuid);
    const lastLineAdded = instance_storage.details["last_line_added"] ?? -1;

    // Clear existing lines for this UUID before overwriting
    if (lastLineAdded >= 0) {
      const existingKeys = [...Array(lastLineAdded + 1).keys()].map((i) =>
        JSON.stringify([uuid, i]),
      );
      await browser.storage.local.remove(existingKeys);
    }

    // Build all new line entries in one object for a single batch write
    const lineEntries: { [key: string]: [string, number] } = {};
    lines.forEach((entry, index) => {
      const line_key = JSON.stringify([uuid, index]);
      lineEntries[line_key] = [entry["line"] as string, entry["time"] as number];
    });

    // Write all lines in one call, then update last_line_added once
    await browser.storage.local.set(lineEntries);
    await instance_storage.updateDetails({
      last_line_added: lines.length - 1,
    });
  }
}
