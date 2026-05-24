import { pickSkipMarkersFromKodikLink, type KodikSkipMarkers } from "./kodikSkip";
import type { KodikLinkResponse } from "./playerCache";

const skipInflight = new Map<string, Promise<KodikSkipMarkers | null>>();

/** Фоновая подгрузка таймкодов OP/ED — не в критическом пути старта Mini App. */
export function fetchKodikSkipMarkersAsync(
  embedUrl: string,
  apiJson: (path: string) => Promise<unknown>,
): Promise<KodikSkipMarkers | null> {
  const url = String(embedUrl || "").trim();
  if (!url.startsWith("http")) return Promise.resolve(null);
  const cached = skipInflight.get(url);
  if (cached) return cached;
  const p = apiJson(`/api/v1/media/kodik-skip?embed_url=${encodeURIComponent(url)}`)
    .then((raw) => pickSkipMarkersFromKodikLink(raw as KodikLinkResponse))
    .catch(() => null)
    .finally(() => {
      skipInflight.delete(url);
    });
  skipInflight.set(url, p);
  return p;
}
