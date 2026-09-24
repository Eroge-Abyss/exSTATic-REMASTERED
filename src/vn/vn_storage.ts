
import { charsInLine, dateNowString, lineSplitCount } from "../calculations";
import type { InstanceStorage, Stat } from "../storage/instance_storage";
import { MediaStorage } from "../storage/media_storage";
import type { TypeStorage } from "../storage/type_storage";

// EXTENDED STORAGE SPEC
//     "uuid": {
//         "last_line_added": "line_id",
//         ...
//     }

export class VNStorage extends MediaStorage {
  max_lines: number;
  /** In-memory dedup cache — replaces the per-line storage.get read. */
  #lastLineText: string | undefined;

  constructor(
    type_storage: TypeStorage,
    instance_storage?: InstanceStorage,
    live_stat_update = false,
  ) {
    super(type_storage, instance_storage, live_stat_update);
    this.max_lines = Number.parseInt(type_storage.properties.max_loaded_lines);
    this.logLines();
  }

  static async build(live_stat_update = false) {
    const media_storage = await super.buildMediaStorage("vn");
    return new VNStorage(
      media_storage.type_storage,
      media_storage.instance_storage,
      live_stat_update,
    );
  }

  async logLines() {
    // Reset dedup cache on game switch — first line of a new game must
    // never be skipped because it matched the last line of the previous game.
    this.#lastLineText = undefined;

    if (!this.uuid || !this.details || !this.instance_storage) return;

    const event = new CustomEvent("media_changed", {
      detail: {
        uuid: this.uuid,
        name: this.details.name,
        lines: await this.instance_storage.getLines(this.max_lines),
      },
    });
    document.dispatchEvent(event);
  }

  async addLine(line: string, date: string, time: number) {
    // In-memory dedup — replaces a storage.get read (~50-100ms) per line.
    if (line === this.#lastLineText) return;

    const chars_in_line = charsInLine(line);
    if (chars_in_line === 0) return;

    // Mark as accepted before writes so rapid re-sends of the same text
    // don't pass the dedup check while insertLine is in-flight.
    this.#lastLineText = line;
    this.start_ticker(false);

    // Dispatch before insertLine — text appears at ~0ms perceived delay.
    // insertLine + stat writes complete silently in the background.
    document.dispatchEvent(new CustomEvent("new_line", {
      detail: {
        line_id: this.details!.last_line_added + 1,
        line: line,
        time: time,
      },
    }));

    await this.instance_storage?.insertLine(line, time);

    // If any of the subsequent writes fail (e.g. storage quota exceeded) we
    // roll back the line we just inserted so that lines and stats stay in sync.
    const insertedLineId = this.details!.last_line_added;
    try {
      // All three writes target different storage keys — run in parallel.
      await Promise.all([
        this.instance_storage?.addToDates(date),
        this.instance_storage?.addToDate(date),
        this.instance_storage?.addDailyStats(date, {
          lines_read: lineSplitCount(line),
          chars_read: chars_in_line,
        }),
      ]);
    } catch (e) {
      // Remove the orphaned line entry; last_line_added gap is harmless
      // (getLines skips missing keys).
      await this.instance_storage?.deleteLine(insertedLineId);
      throw e;
    }
  }

  async deleteLines(details: [number, string, string, number?][]) {
    let date_stats: { [date: string]: Partial<Stat> } = {};

    details.forEach(([, line, date]) => {
      if (date === undefined) {
        date = dateNowString();
      }

      const date_stat = date_stats[date];

      if (!date_stat) {
        date_stats[date] = { lines_read: 0, chars_read: 0 };
      }

      date_stats[date].lines_read =
        (date_stat?.lines_read ?? 0) + lineSplitCount(line);
      date_stats[date].chars_read =
        (date_stat?.chars_read ?? 0) + charsInLine(line);
    });

    // Save deletion snapshot into storage before deleting
    const backup = {
      uuid: this.uuid,
      game_name: this.details?.name || "Game",
      timestamp: Date.now(),
      lines: details.map(([line_id, line, date, time]) => ({
        id: line_id,
        line,
        date: date || dateNowString(),
        time: time || timeNowSeconds(),
      })),
      date_stats,
    };
    await browser.storage.local.set({ last_deletion_backup: backup });

    await this.instance_storage?.deleteLines(
      details.map(([line_id, ,]) => line_id),
    );
    await this.instance_storage?.subStats(date_stats);
  }

  async deleteLine(line_id: number, line: string, date: string, time?: number) {
    const date_stats: { [date: string]: Partial<Stat> } = {
      [date]: {
        lines_read: lineSplitCount(line),
        chars_read: charsInLine(line),
      },
    };

    const backup = {
      uuid: this.uuid,
      game_name: this.details?.name || "Game",
      timestamp: Date.now(),
      lines: [
        {
          id: line_id,
          line,
          date,
          time: time || timeNowSeconds(),
        },
      ],
      date_stats,
    };
    await browser.storage.local.set({ last_deletion_backup: backup });

    await this.instance_storage?.deleteLine(line_id);
    await this.instance_storage?.subDailyStats(date, {
      lines_read: lineSplitCount(line),
      chars_read: charsInLine(line),
    });
  }
}
