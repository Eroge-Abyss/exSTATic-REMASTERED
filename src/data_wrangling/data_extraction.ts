import * as browser from "webextension-polyfill";
import type { InstanceDetails, Stat } from "../storage/instance_storage";
import { InstanceStorage } from "../storage/instance_storage";
import { charsInLine, lineSplitCount, timeToDateString } from "../calculations";

export interface DataEntry {
  client?: string;
  uuid: string;
  name: string;
  given_identifier: string;
  type: string;
  date: string;
  time_read?: number;
  chars_read?: number;
  lines_read?: number;
  [key: string]: unknown;
}

export interface SecondaryMergeInfo {
  secondaryUuid: string;
  secondaryName: string;
  secondaryDetails: Record<string, any>;
  secondaryStats: Record<string, Stat>;
  lineIdMap: [number, number][];
  mediaUpdates: Record<string, string>;
}

/** Snapshot saved before every merge so the operation can be fully undone. */
export interface MergeSnapshot {
  timestamp: string;
  primaryUuid: string;
  primaryName: string;
  /** primary's last_line_added before the merge */
  primaryLastLineId: number;
  /** primary's per-date stats before the merge */
  primaryStatsBefore: Record<string, Stat>;
  /** Secondaries merged into primary in this atomic transaction */
  secondaries?: SecondaryMergeInfo[];
  /** Date strings that had secondary entries (for restoring date arrays) */
  affectedDates: string[];
  /** Pre-merge date array entries for full restoration */
  dateEntriesBefore?: Record<string, [string, string][]>;
  /** List of primary stat keys written during merge */
  writtenPriKeys?: string[];
  // Legacy single-secondary fields for backwards compatibility with older snapshots:
  secondaryUuid?: string;
  secondaryName?: string;
  secondaryDetails?: Record<string, any>;
  secondaryStats?: Record<string, Stat>;
  lineIdMap?: [number, number][];
  mediaUpdates?: Record<string, string>;
}

/** Safely removes one or more keys in batches of 200, preventing empty array errors and IPC payload limits. */
export async function safeRemove(keys: string | string[] | undefined | null): Promise<void> {
  if (!keys) return;
  const list = Array.isArray(keys) ? keys : [keys];
  const valid = list.filter((k): k is string => typeof k === "string" && k.trim().length > 0);
  if (valid.length === 0) return;
  const chunkSize = 200;
  for (let i = 0; i < valid.length; i += chunkSize) {
    await browser.storage.local.remove(valid.slice(i, i + chunkSize));
  }
}

/** Safely writes key-value pairs in batches of 200 to prevent WebExtension IPC payload overflow. */
export async function batchSet(items: Record<string, unknown>, chunkSize = 200): Promise<void> {
  const entries = Object.entries(items);
  if (entries.length === 0) return;
  for (let i = 0; i < entries.length; i += chunkSize) {
    const chunk = Object.fromEntries(entries.slice(i, i + chunkSize));
    await browser.storage.local.set(chunk);
  }
}

/** Safely reads keys in batches of 200 to prevent WebExtension IPC message limits. */
export async function batchGet(keys: string[], chunkSize = 200): Promise<Record<string, any>> {
  if (!keys || keys.length === 0) return {};
  const results: Record<string, any> = {};
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    const res = await browser.storage.local.get(chunk);
    Object.assign(results, res);
  }
  return results;
}

/** Returns every tracked title UUID+name+type, even ones with no stats yet. */
export async function getAllInstances(): Promise<
  { uuid: string; name: string; type: string }[]
> {
  const immersionDates =
    (await browser.storage.local.get('immersion_dates'))['immersion_dates'] ?? [];
  const allUuids = new Set<string>();
  for (const date of immersionDates) {
    const entries: [string, string][] =
      (await browser.storage.local.get(date))[date] ?? [];
    for (const [, uuid] of entries) allUuids.add(uuid);
  }
  const mediaRaw = await browser.storage.local.get('media');
  const media: Record<string, string> = mediaRaw['media'] ?? {};
  for (const uuid of Object.values(media)) allUuids.add(uuid);
  const results: { uuid: string; name: string; type: string; vndb_id?: string; tadoku_auto_log?: boolean }[] = [];
  for (const uuid of allUuids) {
    const raw = await browser.storage.local.get(uuid);
    const details = raw[uuid];
    if (!details) continue;
    results.push({
      uuid,
      name: details.name ?? details.given_identifier ?? uuid,
      type: details.type ?? 'vn',
      vndb_id: details.vndb_id ?? '',
      tadoku_auto_log: details.tadoku_auto_log !== false,
    });
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Create a brand-new manually-added title in storage.
 * Returns the new instance so it can be edited immediately.
 */
export async function createManualTitle(
  name: string,
  type: string,
): Promise<{ uuid: string; name: string; type: string; vndb_id?: string }> {
  const uuid = crypto.randomUUID();
  const details = {
    name: name.trim(),
    given_identifier: name.trim(),
    type,
    last_line_added: 0,
    last_active_at: Date.now(),
    manual: true,
  };
  await browser.storage.local.set({ [uuid]: details });
  if (type === "vn") {
    browser.runtime
      .sendMessage({
        action: "auto_detect_vndb",
        uuid,
        query: name.trim(),
      })
      .catch(() => {});
  }
  return { uuid, name: name.trim(), type };
}

export async function getDateData(date: string): Promise<DataEntry[]> {
  const dateRaw = await browser.storage.local.get(date);
  const uuids = dateRaw[date];
  if (!Array.isArray(uuids)) return [];

  const date_data = uuids.map(async ([client, uuid]: [string, string]) => {
    const detailsRaw = await browser.storage.local.get(uuid);
    const details = detailsRaw[uuid] ?? {};

    const uuid_date_key = JSON.stringify([client, uuid, date]);
    let stats_entry =
      (await browser.storage.local.get(uuid_date_key))[uuid_date_key] ?? {};

    // Processed stats
    if (stats_entry.hasOwnProperty("time_read")) {
      stats_entry["time_read"] = stats_entry["time_read"];

      if (stats_entry.hasOwnProperty("chars_read")) {
        stats_entry["read_speed"] =
          stats_entry["chars_read"] / stats_entry["time_read"];
      }
    }

    return {
      client: client,
      uuid: uuid,
      name: details["name"] ?? details["given_identifier"] ?? uuid,
      given_identifier: details["given_identifier"] ?? "Unknown",
      type: details["type"] ?? "vn",
      vndb_id: details["vndb_id"],
      date: date,
      ...stats_entry,
    };
  });

  return (await Promise.all(date_data)).filter(
    (entry): entry is DataEntry => entry !== null && entry !== undefined,
  );
}

export async function getData(): Promise<DataEntry[]> {
  const dates = await browser.storage.local.get("immersion_dates");

  if (!dates.hasOwnProperty("immersion_dates") || !Array.isArray(dates["immersion_dates"])) {
    return [];
  }

  const validDates = dates["immersion_dates"].filter(
    (d: unknown) => typeof d === "string" && d.trim().length > 0,
  );

  const data = await Promise.all(validDates.map(getDateData));

  return data.flat().filter(
    (entry) => entry && typeof entry.date === "string" && entry.date.trim().length > 0,
  );
}

export async function getInstanceData([uuid, details]: [
  string,
  InstanceDetails,
]) {
  if (!details.hasOwnProperty("last_line_added")) {
    return;
  }

  const id_queries = [...Array(details["last_line_added"] + 1).keys()].map(
    (index) => JSON.stringify([uuid, index]),
  );
  const lines = await browser.storage.local.get(id_queries);

  return Object.values(lines).map((line) => {
    return {
      uuid: uuid,
      given_identifier: details["given_identifier"],
      name: details["name"],
      line: typeof line === "string" ? line : line[0],
      time: typeof line === "string" ? undefined : line[1],
    };
  });
}

// ------- Soft-Delete / Restore -------

export interface DeletedGameEntry {
  deleted_at: string;
  details: InstanceDetails;
  lines: { [key: string]: unknown };
  stats: { [key: string]: unknown };
  date_entries: { [date: string]: [string, string] };
  media_key: string;
}

export async function softDeleteGame(uuid: string): Promise<void> {
  // 1. Get instance details
  const detailsRaw = await browser.storage.local.get(uuid);
  const details: InstanceDetails = detailsRaw[uuid];
  if (!details) return;

  // 2. Collect all line keys
  const lineKeys: string[] = [];
  const linesData: { [key: string]: unknown } = {};
  if (details.last_line_added !== undefined && details.last_line_added >= 0) {
    for (let i = 0; i <= details.last_line_added; i++) {
      lineKeys.push(JSON.stringify([uuid, i]));
    }
    const lines = await browser.storage.local.get(lineKeys);
    Object.assign(linesData, lines);
  }

  // 3. Collect all stat keys and date references
  const statsData: { [key: string]: unknown } = {};
  const dateEntries: { [date: string]: [string, string] } = {};
  const immersionDates =
    (await browser.storage.local.get("immersion_dates"))["immersion_dates"] ??
    [];

  // Get client UUID
  const clientData = await browser.storage.local.get("client");
  const client = clientData["client"] ?? "";

  for (const date of immersionDates) {
    const dateData = (await browser.storage.local.get(date))[date];
    if (!dateData || !Array.isArray(dateData)) continue;

    for (const entry of dateData) {
      if (Array.isArray(entry) && entry[1] === uuid) {
        dateEntries[date] = entry as [string, string];

        // Collect stat key
        const statKey = JSON.stringify([entry[0], uuid, date]);
        const stat = await browser.storage.local.get(statKey);
        if (stat[statKey]) {
          statsData[statKey] = stat[statKey];
        }
      }
    }
  }

  // 4. Find media mapping key
  let mediaKey = "";
  const mediaEntries = await browser.storage.local.get("media");
  if (mediaEntries["media"]) {
    for (const [key, value] of Object.entries(mediaEntries["media"])) {
      if (value === uuid) {
        mediaKey = key;
        break;
      }
    }
  }

  // 5. Save snapshot to deleted_games
  const deletedGames =
    (await browser.storage.local.get("deleted_games"))["deleted_games"] ?? {};
  deletedGames[uuid] = {
    deleted_at: new Date().toISOString(),
    details: details,
    lines: linesData,
    stats: statsData,
    date_entries: dateEntries,
    media_key: mediaKey,
  } as DeletedGameEntry;
  await browser.storage.local.set({ deleted_games: deletedGames });

  // 6. Remove live data
  const keysToRemove = [uuid, ...lineKeys, ...Object.keys(statsData)];
  await safeRemove(keysToRemove);

  // Remove from media map
  if (mediaKey && mediaEntries["media"]) {
    delete mediaEntries["media"][mediaKey];
    await browser.storage.local.set({ media: mediaEntries["media"] });
  }

  // Remove uuid from date arrays
  for (const date of Object.keys(dateEntries)) {
    const dateData = (await browser.storage.local.get(date))[date];
    if (dateData && Array.isArray(dateData)) {
      const filtered = dateData.filter(
        (entry: [string, string]) => entry[1] !== uuid,
      );
      if (filtered.length > 0) {
        await browser.storage.local.set({ [date]: filtered });
      } else {
        await safeRemove(date);
        // Also remove from immersion_dates
        const dates = (
          await browser.storage.local.get("immersion_dates")
        )["immersion_dates"];
        if (dates && Array.isArray(dates)) {
          const idx = dates.indexOf(date);
          if (idx >= 0) {
            dates.splice(idx, 1);
            await browser.storage.local.set({ immersion_dates: dates });
          }
        }
      }
    }
  }
}

export async function restoreGame(uuid: string): Promise<void> {
  const deletedGames =
    (await browser.storage.local.get("deleted_games"))["deleted_games"] ?? {};
  const snapshot: DeletedGameEntry = deletedGames[uuid];
  if (!snapshot) return;

  // 1. Restore instance details
  await browser.storage.local.set({ [uuid]: snapshot.details });

  // 2. Restore lines
  if (Object.keys(snapshot.lines).length > 0) {
    await browser.storage.local.set(snapshot.lines);
  }

  // 3. Restore stats
  if (Object.keys(snapshot.stats).length > 0) {
    await browser.storage.local.set(snapshot.stats);
  }

  // 4. Restore media mapping
  if (snapshot.media_key) {
    const mediaEntries = await browser.storage.local.get("media");
    const media = mediaEntries["media"] ?? {};
    media[snapshot.media_key] = uuid;
    await browser.storage.local.set({ media: media });
  }

  // 5. Restore date references
  const immersionDates =
    (await browser.storage.local.get("immersion_dates"))["immersion_dates"] ??
    [];

  for (const [date, entry] of Object.entries(snapshot.date_entries)) {
    // Add date to immersion_dates if not present
    if (!immersionDates.includes(date)) {
      immersionDates.push(date);
    }

    // Add entry to date array
    const dateData = (await browser.storage.local.get(date))[date] ?? [];
    const exists = dateData.some(
      (e: [string, string]) => e[0] === entry[0] && e[1] === entry[1],
    );
    if (!exists) {
      dateData.push(entry);
      await browser.storage.local.set({ [date]: dateData });
    }
  }

  await browser.storage.local.set({ immersion_dates: immersionDates });

  // 6. Remove from deleted_games
  delete deletedGames[uuid];
  await browser.storage.local.set({ deleted_games: deletedGames });
}

export async function getDeletedGames(): Promise<
  { uuid: string; name: string; type: string; deleted_at: string }[]
> {
  const deletedGames =
    (await browser.storage.local.get("deleted_games"))["deleted_games"] ?? {};
  return Object.entries(deletedGames).map(([uuid, snapshot]) => {
    const s = snapshot as DeletedGameEntry;
    return {
      uuid,
      name: s.details.name ?? s.details.given_identifier ?? uuid,
      type: s.details.type ?? "unknown",
      deleted_at: s.deleted_at,
    };
  });
}

export async function permanentDeleteGame(uuid: string): Promise<void> {
  const deletedGames =
    (await browser.storage.local.get("deleted_games"))["deleted_games"] ?? {};
  delete deletedGames[uuid];
  await browser.storage.local.set({ deleted_games: deletedGames });
}

export async function renameGame(
  uuid: string,
  newName: string,
): Promise<void> {
  const detailsRaw = await browser.storage.local.get(uuid);
  const details = detailsRaw[uuid];
  if (!details) return;
  details.name = newName;
  await browser.storage.local.set({ [uuid]: details });
  if (!details.type || details.type === "vn") {
    browser.runtime
      .sendMessage({
        action: "auto_detect_vndb",
        uuid,
        query: newName.trim(),
      })
      .catch(() => {});
  }
}

export async function setGameVndbId(
  uuid: string,
  vndbId: string,
): Promise<void> {
  const detailsRaw = await browser.storage.local.get(uuid);
  const details = detailsRaw[uuid];
  if (!details) return;
  details.vndb_id = vndbId.trim();
  await browser.storage.local.set({ [uuid]: details });
}

export async function setGameTadokuAutoLog(
  uuid: string,
  autoLog: boolean,
): Promise<void> {
  const detailsRaw = await browser.storage.local.get(uuid);
  const details = detailsRaw[uuid];
  if (!details) return;
  details.tadoku_auto_log = autoLog;
  await browser.storage.local.set({ [uuid]: details });
}

// ------- Duplicate Detection & Merging -------

export async function getDuplicateGroups(): Promise<
  { name: string; uuids: string[] }[]
> {
  const immersionDates =
    (await browser.storage.local.get("immersion_dates"))["immersion_dates"] ??
    [];

  // Collect all unique UUIDs across all dates
  const allUuids = new Set<string>();
  for (const date of immersionDates) {
    const entries: [string, string][] =
      (await browser.storage.local.get(date))[date] ?? [];
    for (const [, uuid] of entries) allUuids.add(uuid);
  }

  // Group by name
  const nameMap = new Map<string, string[]>();
  for (const uuid of allUuids) {
    const raw = await browser.storage.local.get(uuid);
    const name: string = raw[uuid]?.name ?? raw[uuid]?.given_identifier ?? uuid;
    if (!nameMap.has(name)) nameMap.set(name, []);
    nameMap.get(name)!.push(uuid);
  }

  return Array.from(nameMap.entries())
    .filter(([, uuids]) => uuids.length > 1)
    .map(([name, uuids]) => ({ name, uuids }));
}

export async function mergeGameGroup(
  primaryUuid: string,
  secondaryUuids: string[],
): Promise<void> {
  const validSecondaries = [
    ...new Set(secondaryUuids.filter((u) => u && u !== primaryUuid)),
  ];
  if (validSecondaries.length === 0) return;

  const clientData = await browser.storage.local.get("client");
  const defaultClient: string = clientData["client"] ?? "";

  const immersionDates: string[] =
    (await browser.storage.local.get("immersion_dates"))["immersion_dates"] ??
    [];

  // ── Snapshot pre-merge state for undo ─────────────────────────────────────
  const priDetailsRaw = await browser.storage.local.get(primaryUuid);
  const priDetails = priDetailsRaw[primaryUuid] ?? {};

  const secDetailsMap: Record<string, Record<string, any>> = {};
  for (const sUuid of validSecondaries) {
    const raw = await browser.storage.local.get(sUuid);
    secDetailsMap[sUuid] = raw[sUuid] ?? {};
  }

  const primaryStatsBefore: Record<string, Stat> = {};
  const secStatsMap: Record<string, Record<string, Stat>> = {};
  for (const sUuid of validSecondaries) secStatsMap[sUuid] = {};

  const affectedDates: string[] = [];
  const dateEntriesBefore: Record<string, [string, string][]> = {};
  const writtenPriKeys: string[] = [];

  for (const date of immersionDates) {
    const dateRaw = await browser.storage.local.get(date);
    const entries: [string, string][] = Array.isArray(dateRaw[date])
      ? dateRaw[date]
      : [];

    let dateHasAnySecondary = false;
    for (const sUuid of validSecondaries) {
      const hasSec = entries.some(([, u]) => u === sUuid);
      const secClients = new Set<string>();
      for (const [c, u] of entries) {
        if (u === sUuid && c) secClients.add(c);
      }
      if (defaultClient) secClients.add(defaultClient);

      const secKeys = Array.from(secClients).map((c) =>
        JSON.stringify([c, sUuid, date]),
      );
      const secRaw = await browser.storage.local.get(secKeys);
      for (const k of secKeys) {
        if (secRaw[k] && Object.keys(secRaw[k]).length > 0) {
          secStatsMap[sUuid][k] = secRaw[k];
          dateHasAnySecondary = true;
        }
      }
      if (hasSec) dateHasAnySecondary = true;
    }

    if (!dateHasAnySecondary) continue;

    affectedDates.push(date);
    dateEntriesBefore[date] = [...entries];

    // Gather primary stats on this date before merge
    const priClients = new Set<string>();
    for (const [c, u] of entries) {
      if (u === primaryUuid && c) priClients.add(c);
    }
    if (defaultClient) priClients.add(defaultClient);

    const priKeys = Array.from(priClients).map((c) =>
      JSON.stringify([c, primaryUuid, date]),
    );
    const priRaw = await browser.storage.local.get(priKeys);
    for (const k of priKeys) {
      if (priRaw[k] && Object.keys(priRaw[k]).length > 0) {
        primaryStatsBefore[k] = priRaw[k];
      }
    }
  }

  // 1. Merge daily stats: sum all secondaries into primary
  for (const date of affectedDates) {
    const origEntries = dateEntriesBefore[date] ?? [];

    const chosenPriClient =
      origEntries.find(([, u]) => u === primaryUuid)?.[0] ??
      origEntries.find(([, u]) => validSecondaries.includes(u))?.[0] ??
      defaultClient;

    const targetPriKey = JSON.stringify([chosenPriClient, primaryUuid, date]);
    writtenPriKeys.push(targetPriKey);

    const combinedStats: Record<string, number> = {};

    // Sum primary stats before
    for (const [k, stat] of Object.entries(primaryStatsBefore)) {
      try {
        const [, u, d] = JSON.parse(k);
        if (u === primaryUuid && d === date && stat) {
          for (const [prop, val] of Object.entries(stat)) {
            if (typeof val === "number") {
              combinedStats[prop] = (combinedStats[prop] ?? 0) + val;
            }
          }
        }
      } catch {}
    }

    // Sum secondary stats
    for (const sUuid of validSecondaries) {
      for (const [k, stat] of Object.entries(secStatsMap[sUuid])) {
        try {
          const [, u, d] = JSON.parse(k);
          if (u === sUuid && d === date && stat) {
            for (const [prop, val] of Object.entries(stat)) {
              if (typeof val === "number") {
                combinedStats[prop] = (combinedStats[prop] ?? 0) + val;
              }
            }
          }
        } catch {}
      }
    }

    if (combinedStats.time_read && combinedStats.chars_read) {
      combinedStats.read_speed =
        (combinedStats.chars_read / combinedStats.time_read) * 3600;
    }

    await browser.storage.local.set({ [targetPriKey]: combinedStats });

    // Clean up secondary stat keys and duplicate primary keys for this date
    const keysToRemove: string[] = [];
    for (const sUuid of validSecondaries) {
      for (const k of Object.keys(secStatsMap[sUuid])) {
        try {
          const [, u, d] = JSON.parse(k);
          if (u === sUuid && d === date) keysToRemove.push(k);
        } catch {}
      }
    }
    for (const k of Object.keys(primaryStatsBefore)) {
      try {
        const [, u, d] = JSON.parse(k);
        if (u === primaryUuid && d === date && k !== targetPriKey) {
          keysToRemove.push(k);
        }
      } catch {}
    }
    await safeRemove(keysToRemove);

    // Update date array entries: remove all secondaries, keep chosen primary
    let newEntries = origEntries.filter(([, u]) => !validSecondaries.includes(u));
    newEntries = newEntries.filter(
      ([c, u]) => u !== primaryUuid || c === chosenPriClient,
    );
    if (!newEntries.some(([c, u]) => c === chosenPriClient && u === primaryUuid)) {
      newEntries.push([chosenPriClient, primaryUuid]);
    }
    await browser.storage.local.set({ [date]: newEntries });
  }

  // 2. Move lines from all secondaries to primary (safely chunked)
  let nextLineId: number = (priDetails.last_line_added ?? -1) + 1;
  const primaryLastLineId = priDetails.last_line_added ?? -1;
  const secLineIdMaps: Record<string, [number, number][]> = {};

  for (const sUuid of validSecondaries) {
    secLineIdMaps[sUuid] = [];
    const secDetails = secDetailsMap[sUuid];
    let secLastLine: number = secDetails?.last_line_added ?? -1;

    if (secLastLine < 0) {
      const probe = await browser.storage.local.get(JSON.stringify([sUuid, 0]));
      if (probe[JSON.stringify([sUuid, 0])] !== undefined) {
        let probeIdx = 0;
        while (true) {
          const batchKeys = [...Array(50).keys()].map((i) =>
            JSON.stringify([sUuid, probeIdx + i]),
          );
          const batch = await browser.storage.local.get(batchKeys);
          let foundAny = false;
          for (let i = 0; i < 50; i++) {
            if (batch[JSON.stringify([sUuid, probeIdx + i])] !== undefined) {
              secLastLine = probeIdx + i;
              foundAny = true;
            }
          }
          if (!foundAny) break;
          probeIdx += 50;
        }
      }
    }

    if (secLastLine >= 0) {
      const chunkSize = 200;
      for (let start = 0; start <= secLastLine; start += chunkSize) {
        const end = Math.min(start + chunkSize - 1, secLastLine);
        const secLineKeys: string[] = [];
        for (let i = start; i <= end; i++) {
          secLineKeys.push(JSON.stringify([sUuid, i]));
        }
        const secLines = await batchGet(secLineKeys);

        const newLines: Record<string, unknown> = {};
        const oldKeys: string[] = [];
        for (const [oldKey, lineData] of Object.entries(secLines)) {
          if (lineData === undefined || lineData === null) continue;
          const origSecId: number = JSON.parse(oldKey)[1];
          secLineIdMaps[sUuid].push([nextLineId, origSecId]);
          newLines[JSON.stringify([primaryUuid, nextLineId])] = lineData;
          oldKeys.push(oldKey);
          nextLineId++;
        }

        if (Object.keys(newLines).length > 0) await batchSet(newLines);
        await safeRemove(oldKeys);
      }
    }
  }

  // Update primary details & preserve metadata from secondaries
  priDetails.last_line_added = nextLineId - 1;
  for (const sUuid of validSecondaries) {
    const sDetails = secDetailsMap[sUuid];
    if (!priDetails.vndb_id && sDetails?.vndb_id) priDetails.vndb_id = sDetails.vndb_id;
    if (!priDetails.type && sDetails?.type) priDetails.type = sDetails.type;
  }
  await browser.storage.local.set({ [primaryUuid]: priDetails });

  // 3. Update media map to redirect secondary identifiers to primary
  const secMediaUpdates: Record<string, Record<string, string>> = {};
  for (const sUuid of validSecondaries) secMediaUpdates[sUuid] = {};

  const mediaRaw = await browser.storage.local.get("media");
  if (mediaRaw.hasOwnProperty("media") && mediaRaw["media"]) {
    const mediaMap: Record<string, string> = mediaRaw["media"];
    let changed = false;
    for (const [mediaKey, mappedUuid] of Object.entries(mediaMap)) {
      if (validSecondaries.includes(mappedUuid)) {
        secMediaUpdates[mappedUuid][mediaKey] = mappedUuid;
        mediaMap[mediaKey] = primaryUuid;
        changed = true;
      }
    }
    if (changed) {
      await browser.storage.local.set({ media: mediaMap });
    }
  }

  // 4. Update type properties if previous_uuid points to any secondary
  for (const type of ["vn", "mokuro", "ttu", "manual"]) {
    const typeRaw = await browser.storage.local.get(type);
    if (typeRaw[type] && validSecondaries.includes(typeRaw[type].previous_uuid)) {
      typeRaw[type].previous_uuid = primaryUuid;
      await browser.storage.local.set({ [type]: typeRaw[type] });
    }
  }

  // 5. Delete secondary instance details
  await safeRemove(validSecondaries);

  // 6. Save atomic snapshot to merge_history (keep last 20)
  const secondaries: SecondaryMergeInfo[] = validSecondaries.map((sUuid) => ({
    secondaryUuid: sUuid,
    secondaryName: secDetailsMap[sUuid]?.name ?? sUuid,
    secondaryDetails: secDetailsMap[sUuid] ?? {},
    secondaryStats: secStatsMap[sUuid] ?? {},
    lineIdMap: secLineIdMaps[sUuid] ?? [],
    mediaUpdates: secMediaUpdates[sUuid] ?? {},
  }));

  const snapshot: MergeSnapshot = {
    timestamp: new Date().toISOString(),
    primaryUuid,
    primaryName: priDetails.name ?? primaryUuid,
    primaryLastLineId,
    primaryStatsBefore,
    writtenPriKeys,
    affectedDates,
    dateEntriesBefore,
    secondaries,
    // Populate legacy single fields with first secondary for backwards compatibility:
    secondaryUuid: secondaries[0]?.secondaryUuid,
    secondaryName: secondaries[0]?.secondaryName,
    secondaryDetails: secondaries[0]?.secondaryDetails,
    secondaryStats: secondaries[0]?.secondaryStats,
    lineIdMap: secondaries[0]?.lineIdMap,
    mediaUpdates: secondaries[0]?.mediaUpdates,
  };

  const histRaw = await browser.storage.local.get("merge_history");
  const history: MergeSnapshot[] = histRaw["merge_history"] ?? [];
  history.push(snapshot);
  await browser.storage.local.set({
    merge_history: history.slice(-20),
  });
}

export async function mergeGames(
  primaryUuid: string,
  secondaryUuid: string,
): Promise<void> {
  return mergeGameGroup(primaryUuid, [secondaryUuid]);
}

/**
 * Fully reverses a merge using its saved snapshot.
 * Re-creates secondaries, restores pre-merge stats for all games,
 * moves lines back (chunked), and removes the snapshot from history.
 */
export async function undoMerge(snapshot: MergeSnapshot): Promise<void> {
  const clientData = await browser.storage.local.get("client");
  const client: string = clientData["client"] ?? "";

  const secondaries: SecondaryMergeInfo[] =
    snapshot.secondaries && snapshot.secondaries.length > 0
      ? snapshot.secondaries
      : [
          {
            secondaryUuid: snapshot.secondaryUuid!,
            secondaryName: snapshot.secondaryName ?? snapshot.secondaryUuid!,
            secondaryDetails: snapshot.secondaryDetails ?? {},
            secondaryStats: snapshot.secondaryStats ?? {},
            lineIdMap: snapshot.lineIdMap ?? [],
            mediaUpdates: snapshot.mediaUpdates ?? {},
          },
        ];

  // 1. Restore all secondary instance details & secondary stats
  for (const sec of secondaries) {
    if (sec.secondaryUuid) {
      await browser.storage.local.set({
        [sec.secondaryUuid]: sec.secondaryDetails ?? {},
      });
      if (sec.secondaryStats && Object.keys(sec.secondaryStats).length > 0) {
        await batchSet(sec.secondaryStats);
      }
    }
  }

  // 2. Restore primary stats
  if (snapshot.writtenPriKeys && snapshot.writtenPriKeys.length > 0) {
    await safeRemove(snapshot.writtenPriKeys);
  } else {
    // Fallback for older snapshots without writtenPriKeys
    const fallbackPriKeysToRemove: string[] = [];
    for (const date of snapshot.affectedDates ?? []) {
      const priKey = JSON.stringify([client, snapshot.primaryUuid, date]);
      if (snapshot.primaryStatsBefore?.[priKey] === undefined) {
        fallbackPriKeysToRemove.push(priKey);
      }
    }
    await safeRemove(fallbackPriKeysToRemove);
  }

  if (snapshot.primaryStatsBefore && Object.keys(snapshot.primaryStatsBefore).length > 0) {
    await batchSet(snapshot.primaryStatsBefore);
  }

  // 3. Move lines back: delete from primary, re-create under secondary IDs (safely chunked)
  for (const sec of secondaries) {
    if (sec.lineIdMap && sec.lineIdMap.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < sec.lineIdMap.length; i += chunkSize) {
        const chunk = sec.lineIdMap.slice(i, i + chunkSize);
        const primaryLineKeys = chunk.map(([newPriId]) =>
          JSON.stringify([snapshot.primaryUuid, newPriId]),
        );
        const primaryLines = await batchGet(primaryLineKeys);
        const linesToDelete: string[] = [];
        const linesToRestore: Record<string, unknown> = {};

        for (const [newPriId, origSecId] of chunk) {
          const priKey = JSON.stringify([snapshot.primaryUuid, newPriId]);
          const lineData = primaryLines[priKey];
          linesToDelete.push(priKey);
          if (lineData !== undefined && lineData !== null) {
            linesToRestore[JSON.stringify([sec.secondaryUuid, origSecId])] =
              lineData;
          }
        }
        await safeRemove(linesToDelete);
        if (Object.keys(linesToRestore).length > 0) {
          await batchSet(linesToRestore);
        }
      }
    }
  }

  // 4. Restore primary's last_line_added
  const priDetailsRaw = await browser.storage.local.get(snapshot.primaryUuid);
  const priDetails = priDetailsRaw[snapshot.primaryUuid] ?? {};
  priDetails.last_line_added = snapshot.primaryLastLineId;
  await browser.storage.local.set({ [snapshot.primaryUuid]: priDetails });

  // 5. Restore date arrays
  if (snapshot.dateEntriesBefore) {
    for (const [date, origEntries] of Object.entries(snapshot.dateEntriesBefore)) {
      await browser.storage.local.set({ [date]: origEntries });
    }
  } else {
    // Fallback for older snapshots
    for (const date of snapshot.affectedDates ?? []) {
      const dateRaw = await browser.storage.local.get(date);
      let entries: [string, string][] = Array.isArray(dateRaw[date]) ? dateRaw[date] : [];
      for (const sec of secondaries) {
        if (!entries.some(([, u]) => u === sec.secondaryUuid)) {
          entries.push([client, sec.secondaryUuid]);
        }
      }
      const priWasThere =
        snapshot.primaryStatsBefore?.[
          JSON.stringify([client, snapshot.primaryUuid, date])
        ] !== undefined;
      if (!priWasThere) {
        entries = entries.filter(([, u]) => u !== snapshot.primaryUuid);
      }
      if (entries.length > 0) {
        await browser.storage.local.set({ [date]: entries });
      } else {
        await safeRemove(date);
      }
    }
  }

  // Ensure dates are in immersion_dates
  const datesRaw = await browser.storage.local.get("immersion_dates");
  const dates: string[] = Array.isArray(datesRaw["immersion_dates"])
    ? datesRaw["immersion_dates"]
    : [];
  const missingDates = (snapshot.affectedDates ?? []).filter((d) => !dates.includes(d));
  if (missingDates.length > 0) {
    await browser.storage.local.set({ immersion_dates: [...dates, ...missingDates] });
  }

  // 6. Restore media map if it was changed
  const mediaRaw = await browser.storage.local.get("media");
  if (mediaRaw.hasOwnProperty("media") && mediaRaw["media"]) {
    const mediaMap: Record<string, string> = mediaRaw["media"];
    let changed = false;
    for (const sec of secondaries) {
      if (sec.mediaUpdates && Object.keys(sec.mediaUpdates).length > 0) {
        for (const [mediaKey, origUuid] of Object.entries(sec.mediaUpdates)) {
          mediaMap[mediaKey] = origUuid;
          changed = true;
        }
      }
    }
    if (changed) {
      await browser.storage.local.set({ media: mediaMap });
    }
  }

  // 7. Remove snapshot from history
  const histRaw = await browser.storage.local.get("merge_history");
  const history: MergeSnapshot[] = Array.isArray(histRaw["merge_history"])
    ? histRaw["merge_history"]
    : [];
  await browser.storage.local.set({
    merge_history: history.filter((h) => h.timestamp !== snapshot.timestamp),
  });
}

export async function getMergeHistory(): Promise<MergeSnapshot[]> {
  const raw = await browser.storage.local.get("merge_history");
  return (raw["merge_history"] ?? []).slice().reverse(); // newest first
}


// ------- Manual Stat Entry / Edit -------

export interface StatSnapshot {
  date: string;
  /** Full previous stat object so undo restores every field (chars, lines, time). */
  prev: Record<string, number> | null;
}

/**
 * Write (overwrite) stats for a single date for the given UUID.
 * Returns a snapshot of the previous value so it can be undone.
 */
export async function upsertManualStat(
  uuid: string,
  date: string,
  chars_read: number,
  time_read: number,
  lines_read?: number,
): Promise<StatSnapshot> {
  const clientData = await browser.storage.local.get("client");
  const client: string = clientData["client"] ?? "";

  const statKey = JSON.stringify([client, uuid, date]);
  const prevRaw = await browser.storage.local.get(statKey);
  const prevStat = prevRaw[statKey] ?? null;

  // Snapshot captures the full previous object so undo restores every field.
  const snapshot: StatSnapshot = {
    date,
    prev: prevStat ? { ...prevStat } : null,
  };

  // Spread over the existing stat so fields we don't explicitly set (e.g.
  // lines_read when not repairing) are preserved rather than dropped.
  const newStat: Record<string, number> = {
    ...(prevStat ?? {}),
    chars_read,
    time_read,
    ...(lines_read !== undefined ? { lines_read } : {}),
  };
  await browser.storage.local.set({ [statKey]: newStat });

  // Ensure date is in immersion_dates
  const datesRaw = await browser.storage.local.get("immersion_dates");
  const dates: string[] = datesRaw["immersion_dates"] ?? [];
  if (!dates.includes(date)) {
    dates.push(date);
    await browser.storage.local.set({ immersion_dates: dates });
  }

  // Ensure [client, uuid] is in the date entries array
  const dateRaw = await browser.storage.local.get(date);
  const entries: [string, string][] = dateRaw[date] ?? [];
  const alreadyPresent = entries.some(([c, u]) => c === client && u === uuid);
  if (!alreadyPresent) {
    entries.push([client, uuid]);
    await browser.storage.local.set({ [date]: entries });
  }

  return snapshot;
}

/**
 * Scan every stored line for `uuid` that has a timestamp matching `date`,
 * compute the ground-truth chars_read and lines_read, and return them along
 * with the currently stored time_read so the caller can pre-fill edit fields.
 * Does NOT write anything — the caller decides whether to apply.
 *
 * Lines stored in the old plain-string format (no timestamp) cannot be dated
 * and are counted in `skippedLines`.
 */
export async function repairDateStats(
  uuid: string,
  date: string,
): Promise<{ chars_read: number; lines_read: number; time_read: number; skippedLines: number }> {
  const clientData = await browser.storage.local.get("client");
  const client: string = clientData["client"] ?? "";

  const instance = await InstanceStorage.buildInstance(uuid);
  const allLines = await instance.getLines(); // no limit — fetch every stored line

  let chars_read = 0;
  let lines_read = 0;
  let skippedLines = 0;

  if (allLines) {
    for (const [, , lineText, time] of allLines) {
      if (time === undefined || isNaN(time as number)) {
        skippedLines++;
        continue;
      }
      const lineDate = timeToDateString(time as number);
      if (lineDate !== date) continue;
      chars_read += charsInLine(lineText as string);
      lines_read += lineSplitCount(lineText as string);
    }
  }

  // Read existing stat so we can hand back the current time_read.
  const statKey = JSON.stringify([client, uuid, date]);
  const existing = await browser.storage.local.get(statKey);
  const time_read: number = existing[statKey]?.time_read ?? 0;

  return { chars_read, lines_read, time_read, skippedLines };
}

/**
 * Restore a set of snapshots produced by upsertManualStat calls (one undo step).
 * If prev is null the date entry is removed entirely.
 */
export async function restoreManualStats(
  uuid: string,
  snapshots: StatSnapshot[],
): Promise<void> {
  const clientData = await browser.storage.local.get("client");
  const client: string = clientData["client"] ?? "";

  for (const { date, prev } of snapshots) {
    const statKey = JSON.stringify([client, uuid, date]);

    if (prev !== null) {
      // Restore previous stat value
      await browser.storage.local.set({ [statKey]: prev });
    } else {
      // Date didn't exist before — remove the stat key
      await safeRemove(statKey);

      // Remove [client, uuid] from date entries array
      const dateRaw = await browser.storage.local.get(date);
      let entries: [string, string][] = dateRaw[date] ?? [];
      entries = entries.filter(([c, u]) => !(c === client && u === uuid));

      if (entries.length > 0) {
        await browser.storage.local.set({ [date]: entries });
      } else {
        // Date is now empty — remove the date key and from immersion_dates
        await safeRemove(date);
        const datesRaw = await browser.storage.local.get("immersion_dates");
        const dates: string[] = datesRaw["immersion_dates"] ?? [];
        const filtered = dates.filter((d) => d !== date);
        await browser.storage.local.set({ immersion_dates: filtered });
      }
    }
  }
}
