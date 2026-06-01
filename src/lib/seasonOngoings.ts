import { hubApiUrl } from "./playerApi";

export type OngoingCard = {
  anime_id: number;
  title: string;
  original_title?: string | null;
  poster?: string | null;
  kind?: string | null;
  episodes?: number | null;
  episodes_aired?: number | null;
  score?: string | null;
};

const STORAGE_KEY = "suteki:ongoings:v1";
const STORAGE_TTL_MS = 60 * 60 * 1000;

function readFromStorage(): OngoingCard[] | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const env = JSON.parse(raw) as { savedAt?: number; items?: OngoingCard[] };
    if (!env.savedAt || !Array.isArray(env.items)) return null;
    if (Date.now() - env.savedAt > STORAGE_TTL_MS) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return env.items;
  } catch {
    return null;
  }
}

function writeToStorage(items: OngoingCard[]): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), items }));
  } catch {
    /* quota */
  }
}

/** Топ популярных онгоингов сезона (для hero-слайдера). */
export async function fetchSeasonOngoings(limit = 3): Promise<OngoingCard[]> {
  const cached = readFromStorage();
  if (cached) return cached.slice(0, limit);

  const r = await fetch(hubApiUrl(`/anime/ongoings?limit=${Math.max(limit, 8)}`), {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (!r.ok) throw new Error(`ongoings ${r.status}`);
  const payload = (await r.json()) as { results?: unknown };
  const rows = payload && Array.isArray(payload.results) ? payload.results : [];
  const items: OngoingCard[] = rows
    .filter((x): x is OngoingCard => Boolean(x && typeof x === "object" && Number((x as OngoingCard).anime_id) > 0))
    .map((x) => ({
      anime_id: Number(x.anime_id),
      title: String(x.title || `#${x.anime_id}`),
      original_title: x.original_title ?? null,
      poster: x.poster ?? null,
      kind: x.kind ?? null,
      episodes: x.episodes ?? null,
      episodes_aired: x.episodes_aired ?? null,
      score: x.score != null ? String(x.score) : null,
    }));
  writeToStorage(items);
  return items.slice(0, limit);
}
