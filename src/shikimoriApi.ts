/** Клиент Shikimori REST API v1 (без бэкенда). Требуется User-Agent. */

export const SHIKIMORI_ORIGIN = "https://shikimori.one";

const HEADERS: HeadersInit = {
  Accept: "application/json",
  "User-Agent": "SutekiPlayerEasy/0.1 (education; +https://shikimori.one/)",
};

export type ShikiImage = {
  original?: string;
  preview?: string;
  x96?: string;
};

export type ShikiAnimeBrief = {
  id: number;
  name: string;
  russian?: string | null;
  image?: ShikiImage;
  url?: string;
  kind?: string;
  score?: string;
  status?: string;
  episodes?: number;
  episodes_aired?: number;
  aired_on?: string | null;
  released_on?: string | null;
};

export type ShikiRelatedRow = {
  relation?: string;
  relation_russian?: string;
  anime?: ShikiAnimeBrief | null;
  manga?: {
    id: number;
    name: string;
    russian?: string | null;
    image?: ShikiImage;
    kind?: string;
    aired_on?: string | null;
    released_on?: string | null;
  } | null;
};

export type ChronologyEntry = {
  id: string;
  title: string;
  kindLabel: string;
  /** Сырой `kind` из API (tv, movie, ova, …) */
  sourceKind: string | null;
  sourceType: "anime" | "manga";
  year: string;
  relation?: string;
  posterUrl: string | null;
};

/** Только TV-аниме для основной хронологии; остальное — отдельная карусель. */
export function isChronologyTvSeries(e: ChronologyEntry): boolean {
  return e.sourceType === "anime" && e.sourceKind === "tv";
}

export function posterUrlFromShiki(image?: ShikiImage | null): string | null {
  const p = image?.preview || image?.original || image?.x96;
  if (!p) return null;
  return p.startsWith("http") ? p : `${SHIKIMORI_ORIGIN}${p}`;
}

export function displayTitle(a: Pick<ShikiAnimeBrief, "russian" | "name">): string {
  const r = String(a.russian || "").trim();
  if (r) return r;
  return String(a.name || "").trim() || `id ${a}`;
}

const KIND_RU: Record<string, string> = {
  tv: "TV",
  movie: "Фильм",
  ova: "OVA",
  ona: "ONA",
  special: "Спешл",
  tv_special: "TV-спешл",
  music: "Клип",
  manga: "Манга",
  light_novel: "Ранобэ",
  novel: "Новелла",
  one_shot: "Ваншот",
};

export function kindLabel(kind?: string | null): string {
  if (!kind) return "—";
  return KIND_RU[kind] || kind.replace(/_/g, " ").toUpperCase();
}

export function yearFromShiki(aired_on?: string | null, released_on?: string | null): string {
  const s = (released_on || aired_on || "").trim();
  if (s.length >= 4) return s.slice(0, 4);
  return "—";
}

/** Число серий для сетки: при незаконченном сериале — episodes_aired. */
export function episodeTotalFromShiki(a: Pick<ShikiAnimeBrief, "episodes" | "episodes_aired">): number {
  const ep = Math.max(0, Math.floor(Number(a.episodes) || 0));
  const aired = Math.max(0, Math.floor(Number(a.episodes_aired) || 0));
  if (ep > 0) return ep;
  if (aired > 0) return aired;
  return 1;
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${SHIKIMORI_ORIGIN}${path}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`Shikimori ${r.status}`);
  return r.json() as Promise<T>;
}

export function searchAnimes(query: string, limit = 20): Promise<ShikiAnimeBrief[]> {
  const q = String(query || "").trim();
  if (!q) return Promise.resolve([]);
  const lim = Math.min(50, Math.max(1, limit));
  return getJson<ShikiAnimeBrief[]>(`/api/animes?search=${encodeURIComponent(q)}&limit=${lim}`);
}

export function fetchAnimeById(id: number): Promise<ShikiAnimeBrief> {
  return getJson<ShikiAnimeBrief>(`/api/animes/${encodeURIComponent(String(id))}`);
}

function rowToChronology(row: ShikiRelatedRow): ChronologyEntry | null {
  const rel = String(row.relation_russian || row.relation || "").trim();
  if (row.anime?.id) {
    const a = row.anime;
    const rawKind = a.kind != null && String(a.kind).trim() !== "" ? String(a.kind).trim() : null;
    return {
      id: `anime-${a.id}`,
      title: displayTitle(a),
      kindLabel: kindLabel(a.kind),
      sourceKind: rawKind,
      sourceType: "anime",
      year: yearFromShiki(a.aired_on, a.released_on),
      relation: rel || undefined,
      posterUrl: posterUrlFromShiki(a.image),
    };
  }
  if (row.manga?.id) {
    const m = row.manga;
    const rawKind = m.kind != null && String(m.kind).trim() !== "" ? String(m.kind).trim() : null;
    return {
      id: `manga-${m.id}`,
      title: displayTitle({ russian: m.russian, name: m.name }),
      kindLabel: kindLabel(m.kind),
      sourceKind: rawKind,
      sourceType: "manga",
      year: yearFromShiki(m.aired_on, m.released_on),
      relation: rel || undefined,
      posterUrl: posterUrlFromShiki(m.image),
    };
  }
  return null;
}

export async function fetchChronology(animeId: number): Promise<ChronologyEntry[]> {
  const rows = await getJson<ShikiRelatedRow[]>(`/api/animes/${encodeURIComponent(String(animeId))}/related`);
  if (!Array.isArray(rows)) return [];
  const out: ChronologyEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const e = rowToChronology(row);
    if (!e) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}
