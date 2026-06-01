/**
 * Календарь выхода серий на ~2 недели вперёд.
 * Берём весь список из Shikimori GET /api/calendar (там сразу много дней)
 * и группируем по датам (Europe/Moscow). Edge-функция Vercel — same-origin,
 * без CORS-проблем и без нагрузки на VPS-бэкенд.
 */
export const config = { runtime: "edge" };

const SHIKIMORI = "https://shikimori.one";
const UA = "Sutekihub/1.0 (calendar; +https://sutekiplayereasy.vercel.app)";

const WEEKDAY = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const WEEKDAY_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTH = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

type RawAnime = {
  id?: number;
  name?: string;
  russian?: string;
  image?: { preview?: string; original?: string };
  kind?: string;
  score?: string | number;
  episodes?: number;
};
type RawRow = { next_episode?: number; next_episode_at?: string; anime?: RawAnime };

type DayItem = {
  anime_id: number;
  title: string;
  original_title: string | null;
  poster: string | null;
  kind: string | null;
  episode: number | null;
  score: string | null;
  airs_at: string;
  airs_time: string;
  airs_date: string;
};

function mskParts(iso: string): { date: string; time: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  if (!p.year || !p.month || !p.day) return null;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function mskToday(): { y: number; m: number; d: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date())) p[part.type] = part.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

export default async function handler(): Promise<Response> {
  let raw: RawRow[] = [];
  try {
    const r = await fetch(`${SHIKIMORI}/api/calendar?type=release`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j)) raw = j as RawRow[];
    }
  } catch {
    /* отдадим пустой календарь — фронт покажет fallback */
  }

  const byDate = new Map<string, DayItem[]>();
  for (const row of raw) {
    const anime = row?.anime;
    if (!anime || typeof anime !== "object") continue;
    const animeId = Number(anime.id) || 0;
    if (!animeId) continue;
    const parts = mskParts(String(row.next_episode_at || ""));
    if (!parts) continue;
    const preview = anime.image?.preview;
    const item: DayItem = {
      anime_id: animeId,
      title: String(anime.russian || anime.name || "").trim() || `#${animeId}`,
      original_title: anime.name ? String(anime.name) : null,
      poster: preview ? `${SHIKIMORI}${preview}` : null,
      kind: anime.kind ? String(anime.kind) : null,
      episode: row.next_episode != null ? Number(row.next_episode) : null,
      score: anime.score ? String(anime.score) : null,
      airs_at: String(row.next_episode_at || ""),
      airs_time: parts.time,
      airs_date: parts.date,
    };
    const bucket = byDate.get(parts.date);
    if (bucket) bucket.push(item);
    else byDate.set(parts.date, [item]);
  }

  const today = mskToday();
  const base = Date.UTC(today.y, today.m - 1, today.d);
  const todayIso = `${today.y}-${String(today.m).padStart(2, "0")}-${String(today.d).padStart(2, "0")}`;

  const MAX_DAYS = 14;
  const allDays: Array<{
    date: string;
    date_label: string;
    weekday: string;
    weekday_short: string;
    day_num: number;
    count: number;
    is_today: boolean;
    items: DayItem[];
  }> = [];
  let lastWithItems = 6; // всегда показываем минимум неделю
  for (let i = 0; i < MAX_DAYS; i++) {
    const dt = new Date(base + i * 86_400_000);
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth();
    const d = dt.getUTCDate();
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const wd = dt.getUTCDay();
    const items = (byDate.get(iso) || []).sort(
      (a, b) => a.airs_time.localeCompare(b.airs_time) || a.title.localeCompare(b.title),
    );
    if (items.length) lastWithItems = i;
    allDays.push({
      date: iso,
      date_label: `${d} ${MONTH[m]}`,
      weekday: WEEKDAY[wd],
      weekday_short: WEEKDAY_SHORT[wd],
      day_num: d,
      count: items.length,
      is_today: iso === todayIso,
      items,
    });
  }
  const days = allDays.slice(0, Math.min(MAX_DAYS, lastWithItems + 1));

  return new Response(JSON.stringify({ timezone: "Europe/Moscow", today: todayIso, days }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=1800, s-maxage=1800",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
