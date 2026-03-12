import * as browser from "webextension-polyfill";
import type { InstanceDetails, Stat } from "../storage/instance_storage";

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

export async function getDateData(date: string): Promise<DataEntry[]> {
  const uuids = (await browser.storage.local.get(date))[date];

  const date_data = uuids.map(async ([client, uuid]: [string, string]) => {
    const details = (await browser.storage.local.get(uuid))[uuid];

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
      name: details["name"],
      given_identifier: details["given_identifier"],
      type: details["type"],
      date: date,
      ...stats_entry,
    };
  });

  return Promise.all(date_data);
}

export async function getData(): Promise<DataEntry[]> {
  const dates = await browser.storage.local.get("immersion_dates");

  if (!dates.hasOwnProperty("immersion_dates")) {
    return [];
  }

  const data = await Promise.all(dates["immersion_dates"].map(getDateData));

  return data.flat();
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
        dateEntries[date] = entry;

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
  await browser.storage.local.remove(keysToRemove);

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
        await browser.storage.local.remove(date);
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
}

