import { dateNowString } from "../calculations";

import { Mutex } from "async-mutex";
import * as browser from "webextension-polyfill";

// STORAGE SPEC
// {
//     "uuid": {
//         "name": "",
//         ...
//     },
//     ["client", "uuid", "date"]: {
//         "lines_read": 0,
//         "chars_read": 0,
//         "time_read": 0,
//         ...
//     },
//     ["uuid", "line_id"]: "line",
//     "immersion_dates": ["date"],
//     "date": [["client", "uuid"]]
// }

export interface InstanceDetails {
  given_identifier: string;
  last_active_at: number;
  last_line_added: number;
  name: string;
  type: string;
}

export interface Stat {
  chars_read: number;
  lines_read?: number;
  time_read: number;
}

export class InstanceStorage<
  TDetails extends InstanceDetails = InstanceDetails,
> {
  uuid: string;
  mutex: Mutex;
  client: string;
  details: TDetails;
  today_stats: Stat;

  // ── Session-local caches ──────────────────────────────────────────────────
  /** Dates already registered this session — skips I/O after first call. */
  #registeredDates: Set<string> = new Set();
  /** Accumulated stat deltas not yet written to storage. Flushed by ticker. */
  #pendingStats: { [date: string]: Partial<Stat> } = {};
  #pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;
  /** The date string that today_stats was accumulated for. Used to detect
   *  midnight rollovers so today_stats is reset rather than carrying over. */
  #todayDate: string = dateNowString();
  // ──────────────────────────────────────────────────────────────────────────


  constructor(
    uuid: string,
    client: string,
    details: TDetails,
    today_stats: Stat,
  ) {
    this.uuid = uuid;
    this.mutex = new Mutex();
    this.client = client;
    this.details = details;
    this.today_stats = today_stats;
  }

  static async buildInstance(uuid: string) {
    const client = (await browser.storage.local.get("client"))["client"];

    const rawDetails = await browser.storage.local.get(uuid);
    const details = rawDetails.hasOwnProperty(uuid) ? rawDetails[uuid] : {};

    // Key must match the write format in #addStats: [client, uuid, date].
    const uuid_date_key = JSON.stringify([client, uuid, dateNowString()]);
    const today_stats = (await browser.storage.local.get(uuid_date_key))[
      uuid_date_key
    ];

    return new InstanceStorage(uuid, client, details, today_stats);
  }

  async updateDetails(details: Partial<TDetails | InstanceDetails>) {
    Object.assign(this.details, details);
    await browser.storage.local.set({ [this.uuid]: this.details });
  }

  async setDailyStats(date: string, values: Stat, from_client?: string) {
    const uuid_date_key = JSON.stringify([
      from_client ?? this.client,
      this.uuid,
      date,
    ]);
    let daily_stats_entry = await browser.storage.local.get(uuid_date_key);

    daily_stats_entry[uuid_date_key] = values;
    if (date == dateNowString()) {
      this.today_stats = daily_stats_entry[uuid_date_key];
    }

    await browser.storage.local.set(daily_stats_entry);
  }

  async addStats(
    date_stat_adds: { [date: string]: Partial<Stat> },
    multiple = 1,
  ) {
    return this.mutex.runExclusive(async () =>
      this.#addStats(date_stat_adds, multiple),
    );
  }

  async #addStats(
    date_stat_adds: { [date: string]: Partial<Stat> },
    multiple = 1,
    from_client?: string,
  ) {
    const today = dateNowString();
    const client = from_client ?? this.client;

    const date_keys = Object.keys(date_stat_adds).map((date) =>
      JSON.stringify([client, this.uuid, date]),
    );

    // For today: seed from today_stats (always current in memory, includes any
    // buffered additions) so subtractions see the correct ground-truth value.
    // For past dates: read from storage as normal.
    let date_stats: { [key: string]: any } = {};
    if (!from_client) {
      for (const key of date_keys) {
        if (JSON.parse(key)[2] === today) {
          date_stats[key] = { ...(this.today_stats ?? {}) };
        }
      }
    }
    const pastKeys = date_keys.filter((k) => !date_stats.hasOwnProperty(k));
    if (pastKeys.length > 0) {
      Object.assign(date_stats, await browser.storage.local.get(pastKeys));
    }

    date_keys.forEach((key) => {
      const date = JSON.parse(key)[2];

      if (!date_stats.hasOwnProperty(key)) {
        date_stats[key] = {};
      }

      Object.entries(date_stat_adds[date]).forEach(([stat, value]) => {
        if (!date_stats[key].hasOwnProperty(stat)) {
          date_stats[key][stat] = 0;
        }
        date_stats[key][stat] = Math.max(
          0,
          date_stats[key][stat] + value * multiple,
        );
      });

      if (date === today && !from_client) {
        this.today_stats = date_stats[key];
      }
    });

    await browser.storage.local.set(date_stats);
  }

  async addDailyStats(date: string, values: Partial<Stat>, multiple = 1) {
    const today = dateNowString();

    // Update today_stats synchronously so any concurrent reader (subStats,
    // Tadoku) always sees the correct current value without waiting for flush.
    if (date === today) {
      // Detect midnight rollover: reset today_stats when the date changes so
      // yesterday's accumulated data doesn't bleed into the new day.
      if (this.#todayDate !== today) {
        this.today_stats = {} as Stat;
        this.#todayDate = today;
      } else if (!this.today_stats) {
        this.today_stats = {} as Stat;
      }
      for (const [k, v] of Object.entries(values) as [string, number][]) {
        const cur = ((this.today_stats as any)[k] as number) ?? 0;
        (this.today_stats as any)[k] = Math.max(0, cur + v * multiple);
      }
    }


    // Accumulate the delta; ticker calls flushPendingStats once per second.
    if (!this.#pendingStats[date]) this.#pendingStats[date] = {};
    for (const [k, v] of Object.entries(values) as [string, number][]) {
      const cur = ((this.#pendingStats[date] as any)[k] as number) ?? 0;
      (this.#pendingStats[date] as any)[k] = cur + v * multiple;
    }

    // Safety net: flush within 2 s even when the ticker isn't running.
    if (!this.#pendingFlushTimer) {
      this.#pendingFlushTimer = setTimeout(() => {
        this.flushPendingStats();
      }, 2000);
    }
  }

  async subStats(
    date_stat_adds: { [date: string]: Partial<Stat> },
    multiple = 1,
  ) {
    await this.addStats(date_stat_adds, -1 * multiple);
  }

  /**
   * Bypass the buffer so single-line deletions are written to storage
   * immediately and the stats page refreshes without waiting for the ticker.
   */
  async subDailyStats(date: string, values: Partial<Stat>, multiple = 1) {
    await this.addStats({ [date]: values }, -1 * multiple);
  }

  /**
   * Write all buffered stat deltas to storage in one batch.
   * Called by the ticker every second and on game-switch / AFK / safety timer.
   */
  async flushPendingStats() {
    if (this.#pendingFlushTimer) {
      clearTimeout(this.#pendingFlushTimer);
      this.#pendingFlushTimer = null;
    }

    const pending = this.#pendingStats;
    if (Object.keys(pending).length === 0) return;
    this.#pendingStats = {};

    const today = dateNowString();

    await this.mutex.runExclusive(async () => {
      const result: { [key: string]: any } = {};

      // Apply every pending delta on top of whatever is currently in storage.
      // Treating today the same as past dates means external writes (merges,
      // manual stat edits from the stats page) survive the next flush, because
      // we add only the new delta rather than overwriting with today_stats.
      // today_stats is re-synced afterwards so subtractions stay accurate.
      const allPendingDates = Object.keys(pending);
      if (allPendingDates.length > 0) {
        const allKeys = allPendingDates.map((d) =>
          JSON.stringify([this.client, this.uuid, d]),
        );
        const stored = await browser.storage.local.get(allKeys);
        for (const date of allPendingDates) {
          const key = JSON.stringify([this.client, this.uuid, date]);
          const base: Record<string, number> = stored[key] ?? {};
          const entry: Record<string, number> = { ...base };
          for (const [k, v] of Object.entries(pending[date]) as [
            string,
            number,
          ][]) {
            entry[k] = Math.max(0, (entry[k] ?? 0) + v);
          }
          result[key] = entry;
          // Keep today_stats in sync so #addStats (line deletions) always
          // sees the correct ground-truth base, including any merges.
          if (date === today) {
            this.today_stats = entry as Stat;
          }
        }
      }

      if (Object.keys(result).length > 0) {
        await browser.storage.local.set(result);
      }
    });

  }

  async insertLine(line: string, time: number) {
    const new_id = this.details.last_line_added + 1;
    const line_key = JSON.stringify([this.uuid, new_id]);

    // Update in-memory details synchronously before the write.
    Object.assign(this.details, { last_line_added: new_id, last_active_at: time });

    // One storage write instead of two (updateDetails + line entry).
    await browser.storage.local.set({
      [this.uuid]: this.details,
      [line_key]: [line, time],
    });
  }

  async deleteLine(line_id: number) {
    await browser.storage.local.remove(JSON.stringify([this.uuid, line_id]));
  }

  async deleteLines(line_ids: number[]) {
    await browser.storage.local.remove(
      line_ids.map((line_id) => JSON.stringify([this.uuid, line_id])),
    );
  }

  async getLines(max_lines?: number) {
    if (!this.details.last_line_added) {
      return;
    }

    // NOTE: This doesn't account for deleted lines
    const max_line_id = this.details.last_line_added;
    const min_line_id =
      max_lines === undefined || max_lines <= 0 || isNaN(max_lines)
        ? 0
        : Math.max(0, this.details.last_line_added - max_lines + 1);

    const id_queries = [...Array(max_line_id - min_line_id + 1).keys()].map(
      (index) => JSON.stringify([this.uuid, min_line_id + index]),
    );
    const lines: { [key: string]: [string, number] | string } =
      await browser.storage.local.get(id_queries);

    return Object.entries(lines).map(([key, line_data]) => {
      let line = typeof line_data === "string" ? line_data : line_data[0];
      let time = typeof line_data === "string" ? undefined : line_data[1];
      let [uuid, id] = JSON.parse(key);

      return [uuid, id, line, time];
    });
  }

  /** Register this date in immersion_dates. Cached — skips I/O after first call per date per session. */
  async addToDates(date: string) {
    const cacheKey = `D:${date}`;
    if (this.#registeredDates.has(cacheKey)) return;

    let day_entries = await browser.storage.local.get("immersion_dates");

    if (!day_entries.hasOwnProperty("immersion_dates")) {
      day_entries["immersion_dates"] = [];
    }

    if (!day_entries["immersion_dates"].includes(date)) {
      day_entries["immersion_dates"].push(date);
      await browser.storage.local.set(day_entries);
    }

    this.#registeredDates.add(cacheKey);
  }

  /** Register [client, uuid] under the date key. Cached — skips I/O after first call per client+date per session. */
  async addToDate(date: string, from_client?: string) {
    const client = from_client ?? this.client;
    const cacheKey = `C:${client}:${date}`;
    if (this.#registeredDates.has(cacheKey)) return;

    let day_entries = await browser.storage.local.get(date);

    if (!day_entries.hasOwnProperty(date)) {
      day_entries[date] = [];
    }

    const client_uuid = [client, this.uuid];
    const exists = day_entries[date].some(
      (current: [string, string]) =>
        current[0] === client_uuid[0] && current[1] === client_uuid[1],
    );

    if (!exists) {
      day_entries[date].push(client_uuid);
      await browser.storage.local.set(day_entries);
    }

    this.#registeredDates.add(cacheKey);
  }

  async getTotalCharsRead(): Promise<number> {
    const dates_entry = await browser.storage.local.get("immersion_dates");
    const dates: string[] = dates_entry["immersion_dates"] ?? [];

    const keys = dates.map((date) =>
      JSON.stringify([this.client, this.uuid, date]),
    );

    if (keys.length === 0) return 0;

    const stats = await browser.storage.local.get(keys);

    return Object.values(stats).reduce((total: number, entry: any) => {
      return total + (entry?.chars_read ?? 0);
    }, 0);
  }
}

