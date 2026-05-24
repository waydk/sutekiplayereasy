import type { Page, Route } from "@playwright/test";

export type MockOptions = {
  bootstrapLatencyMs?: number;
  linkLatencyMs?: number;
  /** Имитировать ошибку Kodik. */
  bootstrapError?: { status: number; body?: object };
  linkError?: { status: number; body?: object };
  episodesCount?: number;
  /** Если задано, manifest_url прилетит вместо MP4-only ответа. */
  withHls?: boolean;
  /** Не возвращать link в bootstrap (тестирует fallback на /kodik/link). */
  bootstrapWithoutLink?: boolean;
};

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function mockPlayerApi(page: Page, opts: MockOptions = {}): Promise<void> {
  const seriesCount = opts.episodesCount ?? 12;

  await page.route("**/api/v1/anime/search?*", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            anime_id: 1735,
            title: "Naruto",
            original_title: "ナルト",
            poster: "https://example.invalid/poster.jpg",
            kind: "tv",
            episodes: seriesCount,
            score: "8.1",
          },
        ],
      }),
    });
  });

  await page.route("**/api/v1/anime/*/player/bootstrap?*", async (route: Route) => {
    if (opts.bootstrapLatencyMs) await delay(opts.bootstrapLatencyMs);
    if (opts.bootstrapError) {
      return route.fulfill({
        status: opts.bootstrapError.status,
        contentType: "application/json",
        body: JSON.stringify(opts.bootstrapError.body ?? { detail: "KODIK_UNAVAILABLE" }),
      });
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        anime_id: 1735,
        page_title: "Naruto",
        translation_id: "2068",
        episode: 1,
        watch: {
          translations: [
            { id: 2068, name: "Studio A", type: "dub", series_range: [1, seriesCount] },
            { id: 42, name: "Short", type: "sub", series_range: [1, seriesCount] },
          ],
          series_count: seriesCount,
        },
        episodes: {
          seasons: [
            {
              season: 1,
              episodes: Array.from({ length: seriesCount }, (_, i) => ({
                episode: i + 1,
                available: true,
              })),
            },
          ],
        },
        link: opts.bootstrapWithoutLink
          ? null
          : {
              player_url: "https://example.invalid/video/720.mp4",
              kodik_max_quality: 720,
              ...(opts.withHls
                ? { hls_manifest_url: "https://example.invalid/video/manifest.m3u8" }
                : {}),
            },
      }),
    });
  });

  await page.route("**/api/v1/anime/*/kodik/link?*", async (route: Route) => {
    if (opts.linkLatencyMs) await delay(opts.linkLatencyMs);
    if (opts.linkError) {
      return route.fulfill({
        status: opts.linkError.status,
        contentType: "application/json",
        body: JSON.stringify(opts.linkError.body ?? { detail: "KODIK_UNAVAILABLE" }),
      });
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        player_url: "https://example.invalid/video/720.mp4",
        kodik_max_quality: 720,
        ...(opts.withHls
          ? { hls_manifest_url: "https://example.invalid/video/manifest.m3u8" }
          : {}),
      }),
    });
  });

  await page.route("**/api/v1/anime/*/chronology", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  /* Видео и manifest fetch — ловим, чтобы не уходили в реальную сеть. */
  await page.route("**/example.invalid/**", async (route: Route) => {
    const url = route.request().url();
    if (url.endsWith(".m3u8")) {
      return route.fulfill({
        status: 200,
        contentType: "application/vnd.apple.mpegurl",
        body: "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg0.ts\n#EXT-X-ENDLIST\n",
      });
    }
    if (url.endsWith("seg0.ts")) {
      return route.fulfill({ status: 200, contentType: "video/mp2t", body: "" });
    }
    return route.fulfill({ status: 200, contentType: "video/mp4", body: "" });
  });

  /* /api/v1/media/kodik прокси — тоже ловим. */
  await page.route("**/api/v1/media/kodik**", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "video/mp4", body: "" });
  });
}
