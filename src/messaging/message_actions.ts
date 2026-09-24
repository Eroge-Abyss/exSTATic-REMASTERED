import * as browser from "webextension-polyfill";
import { getLunaConnected } from "./socket_actions";

import { formatISO } from "date-fns";

interface MessageActionArgs {
  action:
    | "open_tab"
    | "download"
    | "get_connection_status"
    | "vndb_search"
    | "auto_detect_vndb"
    | "tadoku_status"
    | "tadoku_post_log"
    | "tadoku_day_reset_push";
  url?: string | Blob;
  filename?: string;
  query?: string;
  uuid?: string;
  chars?: number;
  timeInSeconds?: number;
  gameTitle?: string;
  vndbId?: string;
  date?: string;
  autoJoinContest?: boolean;
}

export function yesterdayDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatISO(d, { representation: "date" });
}

export async function getTadokuAuthStatus(): Promise<{
  loggedIn: boolean;
  role?: string;
  user?: { id?: string; displayName?: string; email?: string };
  error?: string;
}> {
  try {
    const roleResp = await fetch("https://tadoku.app/api/internal/authz/current-user/role", {
      credentials: "include",
    });
    if (!roleResp.ok) {
      const cfg = await browser.storage.local.get("tadoku_logging");
      if (cfg.tadoku_logging) {
        await browser.storage.local.set({ tadoku_session_expired: true });
      }
      return { loggedIn: false };
    }
    const roleData = await roleResp.json();
    if (roleData.role === "guest" || !roleData.role) {
      const cfg = await browser.storage.local.get("tadoku_logging");
      if (cfg.tadoku_logging) {
        await browser.storage.local.set({ tadoku_session_expired: true });
      }
      return { loggedIn: false };
    }

    await browser.storage.local.set({ tadoku_session_expired: false });

    let displayName = "Tadoku User";
    let email: string | undefined = undefined;
    let userId: string | undefined = undefined;
    try {
      const whoamiResp = await fetch("https://account.tadoku.app/kratos/sessions/whoami", {
        credentials: "include",
      });
      if (whoamiResp.ok) {
        const session = await whoamiResp.json();
        userId = session?.identity?.id;
        const traits = session?.identity?.traits;
        if (traits) {
          email = traits.email;
          if (traits.display_name) {
            displayName = traits.display_name;
          } else if (traits.name?.first) {
            displayName = `${traits.name.first} ${traits.name.last ?? ""}`.trim();
          } else if (traits.email) {
            displayName = traits.email.split("@")[0];
          }
        }
      }
    } catch {
      // whoami is optional, role check is sufficient
    }

    return {
      loggedIn: true,
      role: roleData.role,
      user: {
        id: userId,
        displayName,
        email,
      },
    };
  } catch (e: any) {
    return { loggedIn: false, error: e?.message };
  }
}

export async function getLatestOfficialContest(): Promise<any | null> {
  try {
    const resp = await fetch("https://tadoku.app/api/internal/immersion/contests/latest-official", {
      credentials: "include",
    });
    if (resp.ok) {
      return await resp.json();
    }
    return null;
  } catch {
    return null;
  }
}

export async function ensureOfficialContestRegistration(contestId: string): Promise<string | null> {
  try {
    const regResp = await fetch(`https://tadoku.app/api/internal/immersion/contests/${contestId}/registration`, {
      credentials: "include",
    });
    if (regResp.status === 200) {
      const reg = await regResp.json();
      if (reg.id) {
        const hasJpn = reg.languages?.some((l: any) => l.code === "jpn");
        if (hasJpn) {
          return reg.id;
        }
        const langCodes = (reg.languages ?? []).map((l: any) => l.code);
        if (!langCodes.includes("jpn")) langCodes.push("jpn");
        const upsertResp = await fetch(`https://tadoku.app/api/internal/immersion/contests/${contestId}/registration`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ language_codes: langCodes }),
        });
        if (upsertResp.ok) {
          return reg.id;
        }
      }
    } else if (regResp.status === 204) {
      const joinResp = await fetch(`https://tadoku.app/api/internal/immersion/contests/${contestId}/registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ language_codes: ["jpn"] }),
      });
      if (joinResp.ok) {
        const getAgain = await fetch(`https://tadoku.app/api/internal/immersion/contests/${contestId}/registration`, {
          credentials: "include",
        });
        if (getAgain.ok) {
          const freshReg = await getAgain.json();
          return freshReg.id ?? null;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function postTadokuLog(params: {
  chars: number;
  timeInSeconds?: number;
  gameTitle: string;
  vndbId?: string;
  date?: string;
  uuid?: string;
  autoJoinContest?: boolean;
}): Promise<{ success: boolean; error?: string; log?: any; contestTitle?: string }> {
  try {
    const auth = await getTadokuAuthStatus();
    if (!auth.loggedIn) {
      return { success: false, error: "Not logged in to Tadoku.app" };
    }

    let registrationId: string | null = null;
    let contestTitle: string | undefined = undefined;

    if (params.autoJoinContest !== false) {
      const contest = await getLatestOfficialContest();
      if (contest && contest.id) {
        const now = Date.now();
        const start = new Date(contest.contest_start).getTime();
        const end = new Date(contest.contest_end).getTime();
        if (now >= start && now <= end) {
          contestTitle = contest.title;
          registrationId = await ensureOfficialContestRegistration(contest.id);
        }
      }
    }

    const tags = ["vn"];
    if (params.vndbId && params.vndbId.trim()) {
      const cleaned = params.vndbId.trim().toLowerCase();
      if (!tags.includes(cleaned)) {
        tags.push(cleaned);
      }
    }

    const payload: any = {
      language_code: "jpn",
      activity_id: 1,
      unit_key: "reading_character",
      amount: Math.round(params.chars),
      tags: tags,
      description: params.gameTitle || undefined,
    };

    if (params.timeInSeconds && params.timeInSeconds > 0) {
      payload.duration_seconds = Math.round(params.timeInSeconds);
    }
    if (registrationId) {
      payload.registration_ids = [registrationId];
    }

    const logResp = await fetch("https://tadoku.app/api/internal/immersion/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    if (!logResp.ok) {
      const errText = await logResp.text().catch(() => "");
      return {
        success: false,
        error: `Tadoku API error (${logResp.status}): ${errText || logResp.statusText}`,
      };
    }

    const logData = await logResp.json();

    if (params.uuid && params.date) {
      const pushedRaw = await browser.storage.local.get("tadoku_pushed_records");
      const pushedRecords = pushedRaw["tadoku_pushed_records"] ?? {};
      const recordKey = `${params.uuid}_${params.date}`;
      pushedRecords[recordKey] = {
        chars: params.chars,
        time: params.timeInSeconds ?? 0,
        pushed_at: Date.now(),
        contest: contestTitle,
      };
      await browser.storage.local.set({ tadoku_pushed_records: pushedRecords });
    }

    return { success: true, log: logData, contestTitle };
  } catch (e: any) {
    return { success: false, error: e?.message ?? "Failed to post log to Tadoku" };
  }
}

export async function runTadokuDayResetAutoPush(): Promise<{ pushedCount: number }> {
  try {
    const config = await browser.storage.local.get([
      "tadoku_logging",
      "tadoku_auto_join_contest",
      "tadoku_last_day_reset_processed",
      "tadoku_pushed_records",
      "client",
    ]);

    if (!config.tadoku_logging) {
      return { pushedCount: 0 };
    }

    const yesterday = yesterdayDateString();
    if (config.tadoku_last_day_reset_processed === yesterday) {
      return { pushedCount: 0 };
    }

    const auth = await getTadokuAuthStatus();
    if (!auth.loggedIn) {
      return { pushedCount: 0 };
    }

    const client = config.client;
    const pushedRecords = config.tadoku_pushed_records ?? {};
    const yesterdayEntries: [string, string][] =
      (await browser.storage.local.get(yesterday))[yesterday] ?? [];

    let count = 0;
    for (const [entryClient, uuid] of yesterdayEntries) {
      const recordKey = `${uuid}_${yesterday}`;
      const rawDetails = await browser.storage.local.get(uuid);
      const details = rawDetails[uuid];
      if (!details) continue;
      if (details.tadoku_auto_log === false) continue;

      const statKey = JSON.stringify([entryClient || client, uuid, yesterday]);
      const statRaw = await browser.storage.local.get(statKey);
      const stat = statRaw[statKey];
      if (!stat || !stat.chars_read || stat.chars_read <= 0) continue;

      if (pushedRecords[recordKey] && pushedRecords[recordKey].chars >= stat.chars_read) {
        continue;
      }

      const res = await postTadokuLog({
        chars: stat.chars_read,
        timeInSeconds: stat.time_read ?? 0,
        gameTitle: details.name ?? details.given_identifier ?? "Visual Novel",
        vndbId: details.vndb_id,
        date: yesterday,
        uuid: uuid,
        autoJoinContest: config.tadoku_auto_join_contest !== false,
      });

      if (res.success) {
        count++;
      }
    }

    await browser.storage.local.set({
      tadoku_last_day_reset_processed: yesterday,
    });

    return { pushedCount: count };
  } catch (e) {
    console.error("Error in Tadoku day reset auto-push:", e);
    return { pushedCount: 0 };
  }
}

export function cleanSearchQuery(title: string): string {
  let q = title.trim();
  q = q.replace(/\.(exe|bin|app)$/i, "");
  const withoutBrackets = q.replace(/\[[^\]]*\]|\([^\)]*\)/g, "").trim();
  if (withoutBrackets.length >= 2) {
    q = withoutBrackets;
  }
  return q;
}

export async function fetchVndbSearch(rawQuery: string) {
  const cleaned = cleanSearchQuery(rawQuery);
  const queriesToTry = [cleaned];
  if (cleaned !== rawQuery.trim()) {
    queriesToTry.push(rawQuery.trim());
  }

  for (const q of queriesToTry) {
    try {
      const resp = await fetch("https://api.vndb.org/kana/vn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: ["search", "=", q],
          fields: "id, title, alttitle",
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.results && data.results.length > 0) {
          return data.results;
        }
      }
    } catch {
      // try next
    }
  }
  return [];
}

export async function message_action(args: MessageActionArgs) {
  if (args.action === "open_tab" && args.url && typeof args.url === "string") {
    await open_tab(args.url);
  } else if (args["action"] == "download") {
    await download(args);
  } else if (args["action"] == "get_connection_status") {
    return { luna: getLunaConnected() };
  } else if (args.action === "vndb_search" && args.query) {
    try {
      const results = await fetchVndbSearch(args.query);
      return { results };
    } catch (e: any) {
      return { error: e?.message ?? "VNDB search failed", results: [] };
    }
  } else if (args.action === "auto_detect_vndb" && args.uuid && args.query) {
    try {
      const results = await fetchVndbSearch(args.query);
      if (results && results.length > 0) {
        const best = results[0];
        const raw = await browser.storage.local.get(args.uuid);
        const details = raw[args.uuid];
        if (details) {
          details.vndb_id = best.id;
          await browser.storage.local.set({ [args.uuid]: details });
        }
        return { success: true, vndb_id: best.id, title: best.title };
      }
      return { success: false, results: [] };
    } catch (e: any) {
      return { error: e?.message ?? "VNDB detection failed", results: [] };
    }
  } else if (args.action === "tadoku_status") {
    return await getTadokuAuthStatus();
  } else if (args.action === "tadoku_post_log" && args.chars !== undefined && args.gameTitle) {
    return await postTadokuLog({
      chars: args.chars,
      timeInSeconds: args.timeInSeconds,
      gameTitle: args.gameTitle,
      vndbId: args.vndbId,
      date: args.date,
      uuid: args.uuid,
      autoJoinContest: args.autoJoinContest,
    });
  } else if (args.action === "tadoku_day_reset_push") {
    return await runTadokuDayResetAutoPush();
  } else if (args.action === "tadoku_contest_info") {
    try {
      const contest = await getLatestOfficialContest();
      if (!contest || !contest.id) return { active: false };
      const now = Date.now();
      const start = new Date(contest.contest_start).getTime();
      const end = new Date(contest.contest_end).getTime();
      const isOngoing = now >= start && now <= end;
      let registered = false;
      try {
        const regResp = await fetch(`https://tadoku.app/api/internal/immersion/contests/${contest.id}/registration`, {
          credentials: "include",
        });
        if (regResp.status === 200) {
          const reg = await regResp.json();
          registered = reg.languages?.some((l: any) => l.code === "jpn") ?? false;
        }
      } catch {
        // ignore registration fetch failure
      }
      return {
        active: isOngoing,
        contestId: contest.id,
        title: contest.title,
        registered,
        start: contest.contest_start,
        end: contest.contest_end,
      };
    } catch {
      return { active: false };
    }
  }
}

async function download(args: MessageActionArgs) {
  await browser.downloads.download({
    url:
      typeof args["url"] !== "string"
        ? URL.createObjectURL(args["url"])
        : args["url"],
    filename: args["filename"],
  });
}

async function open_tab(url: string) {
  await browser.tabs.create({ url: url });
}
