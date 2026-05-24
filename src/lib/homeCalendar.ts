import { getApiBase } from "../apiBase";
import { rememberCalendarPosters, warmCalendarPosters } from "./calendarPosterCache";

export type CalendarAiringItem = {
  anime_id: number;
  title: string;
  original_title?: string | null;
  poster?: string | null;
  kind?: string | null;
  episode?: number | null;
  airs_at: string;
  airs_time: string;
  airs_date: string;
};

export type TodayCalendarPayload = {
  date: string;
  date_label: string;
  weekday: string;
  timezone: string;
  count: number;
  items: CalendarAiringItem[];
};

const CAL_STORAGE_KEY = "suteki:calendar:today:v1";
const CAL_STORAGE_TTL_MS = 6 * 60 * 60 * 1000;

function readCalendarFromStorage(): TodayCalendarPayload | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CAL_STORAGE_KEY);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as { savedAt?: number; payload?: TodayCalendarPayload };
    if (!envelope.savedAt || !envelope.payload) return null;
    if (Date.now() - envelope.savedAt > CAL_STORAGE_TTL_MS) {
      sessionStorage.removeItem(CAL_STORAGE_KEY);
      return null;
    }
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
    if (envelope.payload.date !== today) {
      sessionStorage.removeItem(CAL_STORAGE_KEY);
      return null;
    }
    return envelope.payload;
  } catch {
    return null;
  }
}

function writeCalendarToStorage(payload: TodayCalendarPayload): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      CAL_STORAGE_KEY,
      JSON.stringify({ savedAt: Date.now(), payload }),
    );
  } catch {
    /* quota */
  }
}

function hydrateCalendarPayload(payload: TodayCalendarPayload): TodayCalendarPayload {
  rememberCalendarPosters(payload.items);
  warmCalendarPosters(payload.items);
  return payload;
}

export async function fetchTodayCalendar(): Promise<TodayCalendarPayload> {
  const cached = readCalendarFromStorage();
  if (cached) return hydrateCalendarPayload(cached);

  if (typeof window !== "undefined") {
    const w = window as Window & { __sutekiHomeCal__?: Promise<TodayCalendarPayload> };
    if (w.__sutekiHomeCal__) {
      try {
        const payload = await w.__sutekiHomeCal__;
        writeCalendarToStorage(payload);
        return hydrateCalendarPayload(payload);
      } catch {
        delete w.__sutekiHomeCal__;
      }
    }
  }

  const base = getApiBase();
  const url = base
    ? `${base.replace(/\/+$/, "")}/anime/calendar/today`
    : "/api/v1/anime/calendar/today";
  const r = await fetch(url, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (!r.ok) {
    throw new Error(`calendar ${r.status}`);
  }
  const payload = (await r.json()) as TodayCalendarPayload;
  writeCalendarToStorage(payload);
  return hydrateCalendarPayload(payload);
}
