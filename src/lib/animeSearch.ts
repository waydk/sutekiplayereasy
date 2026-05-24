import { hubApiUrl } from "./playerApi";

export const SEARCH_DEBOUNCE_MS = 420;

export type AnimeSearchRow = {
  anime_id: number;
  title: string;
  poster?: string | null;
  original_title?: string | null;
};

export function normalizeSearchQuery(raw: string): string {
  const s = String(raw || "");
  return s
    .normalize("NFKC")
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchAnime(query: string, limit = 12): Promise<AnimeSearchRow[]> {
  const q = normalizeSearchQuery(query);
  if (!q) return [];

  const r = await fetch(hubApiUrl(`/anime/search?q=${encodeURIComponent(q)}&limit=${limit}`), {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (!r.ok) {
    throw new Error(`search ${r.status}`);
  }

  const payload = (await r.json()) as { results?: unknown };
  const results = payload && Array.isArray(payload.results) ? payload.results : [];
  return results
    .filter((row): row is AnimeSearchRow => {
      return Boolean(row && typeof row === "object" && Number((row as AnimeSearchRow).anime_id) > 0);
    })
    .map((row) => ({
      anime_id: Number(row.anime_id),
      title: String(row.title || ""),
      poster: row.poster ?? null,
      original_title: row.original_title ?? null,
    }));
}
