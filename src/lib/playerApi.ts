import { getApiBase } from "../apiBase";

/** Путь Sutekihub API (`/api/v1/anime/...`, `/api/v1/media/...`). */
export function hubApiUrl(path: string): string {
  const raw = path.startsWith("/") ? path : `/${path}`;
  const apiPath = raw.startsWith("/api/v1") ? raw : `/api/v1${raw}`;
  const base = getApiBase().replace(/\/+$/, "");
  if (!base) return apiPath;
  const origin = base.endsWith("/api/v1") ? base.slice(0, -"/api/v1".length) : base.replace(/\/api\/v1$/, "");
  return `${origin.replace(/\/$/, "")}${apiPath}`;
}

export type PlayerBootstrapResponse = {
  anime_id: number;
  page_title?: string | null;
  translation_id?: string | null;
  episode?: number;
  watch: Record<string, unknown>;
  episodes?: Record<string, unknown> | null;
  link?: Record<string, unknown> | null;
};

export function playerBootstrapUrl(
  animeId: number,
  opts: {
    translationId?: string | null;
    episode?: number;
    includeLink?: boolean;
    client?: string | null;
  },
): string {
  const params = new URLSearchParams();
  params.set("episode", String(opts.episode ?? 1));
  params.set("include_link", opts.includeLink !== false ? "true" : "false");
  const tid = (opts.translationId ?? "").trim();
  if (tid) params.set("translation_id", tid);
  const client = (opts.client ?? "").trim();
  if (client) params.set("client", client);
  return hubApiUrl(`/anime/${encodeURIComponent(animeId)}/player/bootstrap?${params}`);
}
