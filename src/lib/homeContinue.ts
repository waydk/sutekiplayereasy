import { hubApiUrl } from "./playerApi";
import { warmPosterCache } from "./posterPreload";
import type { ContinueWatchEntry } from "./watchProgress";
import { listContinueWatching } from "./watchProgress";

type AnimeMeta = {
  title: string;
  poster: string | null;
};

export async function fetchAnimeMeta(animeId: number): Promise<AnimeMeta> {
  try {
    const r = await fetch(hubApiUrl(`/anime/${animeId}`), {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!r.ok) return { title: "", poster: null };
    const j = (await r.json()) as { title?: string; poster?: string | null };
    return {
      title: (j.title || "").trim(),
      poster: j.poster ?? null,
    };
  } catch {
    return { title: "", poster: null };
  }
}

export async function loadContinueWatching(limit = 12): Promise<ContinueWatchEntry[]> {
  const raw = listContinueWatching(limit);
  if (!raw.length) return [];

  const enriched = await Promise.all(
    raw.map(async (item) => {
      const meta = await fetchAnimeMeta(item.animeId);
      return {
        ...item,
        title: item.title || meta.title || `Аниме #${item.animeId}`,
        poster: meta.poster,
      };
    }),
  );

  const shikiPosters = enriched.map((x) => x.poster).filter((u): u is string => Boolean(u));
  if (shikiPosters.length) warmPosterCache(shikiPosters);

  return enriched;
}
