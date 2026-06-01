import { fetchTodayCalendar } from "./homeCalendar";

export type CalWeekItem = {
  anime_id: number;
  title: string;
  original_title?: string | null;
  poster?: string | null;
  kind?: string | null;
  episode?: number | null;
  score?: string | null;
  airs_at: string;
  airs_time: string;
  airs_date: string;
};

export type CalWeekDay = {
  date: string;
  date_label: string;
  weekday: string;
  weekday_short: string;
  day_num: number;
  count: number;
  is_today: boolean;
  items: CalWeekItem[];
};

export type CalWeekPayload = {
  timezone: string;
  today: string;
  days: CalWeekDay[];
};

const WEEK_STORAGE_KEY = "suteki:calendar:week:v1";
const WEEK_STORAGE_TTL_MS = 60 * 60 * 1000;

function readWeekFromStorage(): CalWeekPayload | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(WEEK_STORAGE_KEY);
    if (!raw) return null;
    const env = JSON.parse(raw) as { savedAt?: number; payload?: CalWeekPayload };
    if (!env.savedAt || !env.payload) return null;
    if (Date.now() - env.savedAt > WEEK_STORAGE_TTL_MS) {
      sessionStorage.removeItem(WEEK_STORAGE_KEY);
      return null;
    }
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
    if (env.payload.today !== today) {
      sessionStorage.removeItem(WEEK_STORAGE_KEY);
      return null;
    }
    return env.payload;
  } catch {
    return null;
  }
}

function writeWeekToStorage(payload: CalWeekPayload): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(WEEK_STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), payload }));
  } catch {
    /* quota */
  }
}

/** Превращает ответ «сегодня» в недельную форму (fallback, если week-функция недоступна). */
async function weekFromToday(): Promise<CalWeekPayload> {
  const today = await fetchTodayCalendar();
  const iso = today.date;
  const dayNum = Number(iso.slice(8, 10)) || 1;
  return {
    timezone: today.timezone || "Europe/Moscow",
    today: iso,
    days: [
      {
        date: iso,
        date_label: today.date_label,
        weekday: today.weekday,
        weekday_short: today.weekday.slice(0, 2),
        day_num: dayNum,
        count: today.count,
        is_today: true,
        items: today.items.map((i) => ({
          anime_id: i.anime_id,
          title: i.title,
          original_title: i.original_title ?? null,
          poster: i.poster ?? null,
          kind: i.kind ?? null,
          episode: i.episode ?? null,
          airs_at: i.airs_at,
          airs_time: i.airs_time,
          airs_date: i.airs_date,
        })),
      },
    ],
  };
}

export async function fetchCalendarWeek(): Promise<CalWeekPayload> {
  const cached = readWeekFromStorage();
  if (cached) return cached;

  try {
    const base = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
    const url = `${base}api/calendar-week`.replace(/\/+/g, "/");
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (r.ok) {
      const payload = (await r.json()) as CalWeekPayload;
      if (payload && Array.isArray(payload.days) && payload.days.length) {
        writeWeekToStorage(payload);
        return payload;
      }
    }
  } catch {
    /* нет serverless-функции (dev / GitHub Pages) — падаем на «сегодня» */
  }

  return weekFromToday();
}
