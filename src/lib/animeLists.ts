import { hubApiUrl } from "./playerApi";
import { TOP_ANIME_ALL_TIME } from "./topAnime";

export type CatalogTab = "season" | "popular" | "top";

export type CatalogCard = {
  id: number;
  title: string;
  score?: string | null;
  tag?: string;
  year?: number | null;
  ongoing?: boolean;
};

/** Оценки Shikimori для статичной подборки «Популярное». */
const POPULAR_SCORES: Record<number, string> = {
  5114: "9.1", 9253: "9.0", 16498: "8.5", 11061: "9.0", 1535: "8.6",
  30276: "8.3", 2904: "8.9", 1: "8.7", 33: "8.4", 38000: "8.5",
  32182: "8.4", 32281: "8.6", 4085: "8.8", 33352: "8.6", 40748: "8.6",
  21: "8.7", 1735: "8.3", 31964: "7.9", 30: "8.3", 11757: "7.3",
};

function kindLabel(kind: string | null | undefined): string {
  const k = (kind || "").toLowerCase();
  if (k === "tv") return "ТВ-сериал";
  if (k === "movie") return "Фильм";
  if (k === "ova") return "OVA";
  if (k === "ona") return "ONA";
  if (k === "special") return "Спешл";
  if (k === "music") return "Клип";
  return kind ? kind.toUpperCase() : "Аниме";
}

type ApiRow = {
  anime_id?: number;
  title?: string;
  kind?: string | null;
  status?: string | null;
  score?: string | number | null;
};

function normalizeApiRow(row: ApiRow): CatalogCard | null {
  const id = Number(row.anime_id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const score = row.score != null && Number(row.score) > 0 ? String(row.score) : null;
  return {
    id,
    title: String(row.title || `#${id}`),
    score,
    tag: kindLabel(row.kind),
    ongoing: String(row.status || "").toLowerCase() === "ongoing",
  };
}

const cache = new Map<CatalogTab, CatalogCard[]>();

async function fetchApiList(path: string): Promise<CatalogCard[]> {
  const r = await fetch(hubApiUrl(path), {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (!r.ok) throw new Error(`list ${r.status}`);
  const payload = (await r.json()) as { results?: unknown };
  const rows = payload && Array.isArray(payload.results) ? payload.results : [];
  return rows
    .map((row) => normalizeApiRow(row as ApiRow))
    .filter((c): c is CatalogCard => Boolean(c));
}

function popularStatic(): CatalogCard[] {
  return TOP_ANIME_ALL_TIME.map((a) => ({
    id: a.shikiId,
    title: a.title,
    score: POPULAR_SCORES[a.shikiId] ?? null,
    tag: kindLabel("tv"),
    year: a.year,
    ongoing: false,
  }));
}

export async function fetchCatalog(tab: CatalogTab): Promise<CatalogCard[]> {
  const cached = cache.get(tab);
  if (cached) return cached;

  let items: CatalogCard[];
  if (tab === "popular") {
    items = popularStatic();
  } else if (tab === "season") {
    items = (await fetchApiList("/anime/ongoings?limit=20")).slice(0, 18);
  } else {
    items = await fetchApiList("/anime/top?limit=24");
    items = [...items].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 18);
  }

  cache.set(tab, items);
  return items;
}
