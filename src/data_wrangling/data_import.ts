import { TypeStorage } from "../storage/type_storage";
import { InstanceStorage, type Stat } from "../storage/instance_storage";

import * as browser from "webextension-polyfill";
import type { DataEntry } from "./data_extraction";

async function batchSet(items: Record<string, unknown>, chunkSize = 500) {
  const entries = Object.entries(items);
  for (let i = 0; i < entries.length; i += chunkSize) {
    const chunk = Object.fromEntries(entries.slice(i, i + chunkSize));
    await browser.storage.local.set(chunk);
  }
}

export type ImportStatsMode = "smart" | "replace" | "sum";

export async function importStats(data: DataEntry[], mode: ImportStatsMode = "smart") {
  if (!Array.isArray(data) || data.length === 0) return;

  const validEntries = data.filter(
    (entry) =>
      entry &&
      entry.hasOwnProperty("type") &&
      entry.hasOwnProperty("date") &&
      entry.hasOwnProperty("given_identifier") &&
      entry["type"] &&
      entry["date"] &&
      entry["given_identifier"],
  );

  if (validEntries.length === 0) return;

  // 1. Upfront batch read for client and global metadata
  const metaRaw = await browser.storage.local.get([
    "client",
    "types",
    "media",
    "immersion_dates",
  ]);

  const defaultClient = (metaRaw["client"] as string) ?? crypto.randomUUID();
  const typesList: string[] = Array.isArray(metaRaw["types"])
    ? [...metaRaw["types"]]
    : [];
  const mediaRaw = metaRaw["media"] ?? {};
  const mediaMap: Record<string, string> =
    mediaRaw && typeof mediaRaw === "object" ? { ...mediaRaw } : {};
  const immersionDatesSet = new Set<string>(
    Array.isArray(metaRaw["immersion_dates"])
      ? (metaRaw["immersion_dates"] as string[])
      : [],
  );

  // 2. Discover/assign UUID for every entry using mediaMap
  const entryUuids = new Map<DataEntry, string>();
  const allUuids = new Set<string>();
  const uniqueTypes = new Set<string>();

  for (const entry of validEntries) {
    const type = String(entry["type"]);
    uniqueTypes.add(type);
    if (!typesList.includes(type)) {
      typesList.push(type);
    }

    const givenIdentifier = String(entry["given_identifier"]);
    const mediaKey = JSON.stringify([givenIdentifier, type]);

    const entryExplicitUuid =
      typeof entry["uuid"] === "string" ? entry["uuid"].trim() : "";
    let uuid = entryExplicitUuid || mediaMap[mediaKey] || crypto.randomUUID();
    mediaMap[mediaKey] = uuid;

    entryUuids.set(entry, uuid);
    allUuids.add(uuid);
  }

  // 3. Batch read existing UUID details, date arrays, type properties, and existing stats
  const uniqueDates = [
    ...new Set(validEntries.map((e) => String(e["date"]))),
  ];
  const allStatKeys = validEntries.map((e) => {
    const client = (e["client"] as string) || defaultClient;
    const uuid = entryUuids.get(e)!;
    const date = String(e["date"]);
    return JSON.stringify([client, uuid, date]);
  });
  const keysToFetch = [...allUuids, ...uniqueDates, ...uniqueTypes, ...allStatKeys];
  const preloaded = await browser.storage.local.get(keysToFetch);

  // 4. In-memory updates for types, details, dates, and stats
  const storageToWrite: Record<string, unknown> = {};

  // Types list & type dictionaries
  storageToWrite["types"] = typesList;
  for (const type of uniqueTypes) {
    if (!preloaded[type] || typeof preloaded[type] !== "object") {
      storageToWrite[type] = {};
    }
  }

  // Media map
  storageToWrite["media"] = mediaMap;

  // UUID details
  const detailsByUuid: Record<string, any> = {};
  for (const uuid of allUuids) {
    detailsByUuid[uuid] = preloaded[uuid]
      ? { ...preloaded[uuid] }
      : {
          last_line_added: -1,
        };
  }

  // Date entries: date -> [[client, uuid], ...]
  const dateEntriesByDate: Record<string, [string, string][]> = {};
  for (const date of uniqueDates) {
    const existingEntries = Array.isArray(preloaded[date])
      ? preloaded[date].map(([c, u]: [string, string]) => [String(c), String(u)])
      : [];
    dateEntriesByDate[date] = existingEntries;
  }

  // Process rows
  const dailyStatsToWrite: Record<string, Stat> = {};

  for (const entry of validEntries) {
    const uuid = entryUuids.get(entry)!;
    const date = String(entry["date"]);
    const client = (entry["client"] as string) || defaultClient;
    const givenIdentifier = String(entry["given_identifier"]);
    const type = String(entry["type"]);

    // Update details
    const details = detailsByUuid[uuid];
    details.given_identifier = details.given_identifier ?? givenIdentifier;
    details.type = details.type ?? type;
    if (entry.hasOwnProperty("name") && entry["name"]) {
      details.name = String(entry["name"]);
    } else if (!details.name) {
      details.name = givenIdentifier;
    }

    // Update date arrays & immersion dates
    immersionDatesSet.add(date);
    const dayEntries = dateEntriesByDate[date];
    const alreadyPresent = dayEntries.some(
      ([c, u]) => c === client && u === uuid,
    );
    if (!alreadyPresent) {
      dayEntries.push([client, uuid]);
    }

    // Daily stats calculation according to selected mode
    let chars = 0;
    if (entry.hasOwnProperty("chars_read") && entry["chars_read"] !== undefined) {
      chars = Number(entry["chars_read"]) || 0;
    }
    let lines: number | undefined = undefined;
    if (entry.hasOwnProperty("lines_read") && entry["lines_read"] !== undefined) {
      lines = Number(entry["lines_read"]) || 0;
    }
    let time = 0;
    if (entry.hasOwnProperty("time_read") && entry["time_read"] !== undefined) {
      time = Number(entry["time_read"]) || 0;
    }

    const statKey = JSON.stringify([client, uuid, date]);
    const existing = preloaded[statKey] as Stat | undefined;

    if (existing) {
      if (mode === "smart") {
        // Smart Merge: Only add positive difference / take higher of each metric
        chars = Math.max(existing.chars_read || 0, chars);
        if (lines !== undefined || existing.lines_read !== undefined) {
          lines = Math.max(existing.lines_read || 0, lines || 0);
        }
        time = Math.max(existing.time_read || 0, time);
      } else if (mode === "sum") {
        // Cumulative Sum: Add imported values directly to existing
        chars = (existing.chars_read || 0) + chars;
        if (lines !== undefined || existing.lines_read !== undefined) {
          lines = (existing.lines_read || 0) + (lines || 0);
        }
        time = (existing.time_read || 0) + time;
      }
      // "replace" mode keeps the imported values directly
    }

    const stats: Stat = {
      chars_read: chars,
      time_read: time,
      ...(lines !== undefined ? { lines_read: lines } : {}),
    };

    dailyStatsToWrite[statKey] = stats;
  }

  // Finalize metadata and details in storageToWrite
  storageToWrite["immersion_dates"] = Array.from(immersionDatesSet);
  for (const [uuid, details] of Object.entries(detailsByUuid)) {
    storageToWrite[uuid] = details;
  }
  for (const [date, entries] of Object.entries(dateEntriesByDate)) {
    storageToWrite[date] = entries;
  }

  // Save pre-import backup snapshot before writing
  const allKeysToTouch = [
    ...Object.keys(storageToWrite),
    ...Object.keys(dailyStatsToWrite),
  ];
  const previousState = await browser.storage.local.get(allKeysToTouch);
  const backupData: Record<string, unknown> = {};
  const newKeys: string[] = [];

  for (const key of allKeysToTouch) {
    if (previousState.hasOwnProperty(key) && previousState[key] !== undefined) {
      backupData[key] = previousState[key];
    } else {
      newKeys.push(key);
    }
  }

  await browser.storage.local.set({
    last_import_backup: {
      type: "stats",
      timestamp: Date.now(),
      entryCount: validEntries.length,
      data: backupData,
      new_keys: newKeys,
    },
  });

  // 5. Batch write to storage
  await batchSet(storageToWrite, 500);
  if (Object.keys(dailyStatsToWrite).length > 0) {
    await batchSet(dailyStatsToWrite, 500);
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

  // Pre-import backup snapshot of lines and details
  const backupData: Record<string, unknown> = {};
  for (const uuid of byUuid.keys()) {
    const instance_storage = await InstanceStorage.buildInstance(uuid);
    const lastLineAdded = instance_storage.details["last_line_added"] ?? -1;
    backupData[uuid] = { ...instance_storage.details };

    if (lastLineAdded >= 0) {
      const existingKeys = [...Array(lastLineAdded + 1).keys()].map((i) =>
        JSON.stringify([uuid, i]),
      );
      const existingLines = await browser.storage.local.get(existingKeys);
      Object.assign(backupData, existingLines);
    }
  }

  await browser.storage.local.set({
    last_import_backup: {
      type: "lines",
      timestamp: Date.now(),
      entryCount: data.length,
      data: backupData,
      new_keys: [],
    },
  });

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

export async function revertLastImport(): Promise<{ success: boolean; message: string }> {
  const stored = await browser.storage.local.get("last_import_backup");
  const backup = stored.last_import_backup;
  if (!backup || !backup.data) {
    return { success: false, message: "No previous import found to revert." };
  }

  const toSet: Record<string, unknown> = {};
  const toRemove: string[] = [];

  for (const [key, value] of Object.entries(backup.data)) {
    if (value === undefined || value === null) {
      toRemove.push(key);
    } else {
      toSet[key] = value;
    }
  }

  if (Array.isArray(backup.new_keys)) {
    for (const key of backup.new_keys) {
      if (!toSet.hasOwnProperty(key) && !toRemove.includes(key)) {
        toRemove.push(key);
      }
    }
  }

  if (Object.keys(toSet).length > 0) {
    await batchSet(toSet, 500);
  }
  if (toRemove.length > 0) {
    await browser.storage.local.remove(toRemove);
  }

  await browser.storage.local.remove("last_import_backup");

  return {
    success: true,
    message: `Successfully reverted the last ${backup.type || "data"} import (${backup.entryCount || Object.keys(toSet).length} records restored).`,
  };
}
