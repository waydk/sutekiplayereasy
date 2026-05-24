import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapCache,
  cacheGet,
  cacheSet,
  CACHE_TTL_BOOTSTRAP_MS,
  CACHE_TTL_LINK_MS,
  linkCache,
  preconnectMediaOrigin,
  takeWarmBootstrap,
  takeWarmLink,
  warmBootstrap,
} from "../playerCache";

const ORIGINAL_FETCH = globalThis.fetch;

function clearCaches() {
  linkCache.clear();
  bootstrapCache.clear();
  document.head.querySelectorAll("link[id^='suteki-media-preconnect-']").forEach((n) => n.remove());
}

beforeEach(() => {
  clearCaches();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = ORIGINAL_FETCH;
  delete (window as unknown as { __sutekiBoot__?: unknown }).__sutekiBoot__;
});

describe("LRU + TTL cache primitives", () => {
  it("cacheSet/cacheGet round-trip", () => {
    cacheSet(linkCache, "k1", { player_url: "u" }, 5000);
    expect(cacheGet(linkCache, "k1")).toEqual({ player_url: "u" });
  });

  it("cacheGet returns null after TTL", () => {
    cacheSet(linkCache, "k1", { player_url: "u" }, 1000);
    vi.advanceTimersByTime(1500);
    expect(cacheGet(linkCache, "k1")).toBeNull();
    /* expired entry is also removed */
    expect(linkCache.has("k1")).toBe(false);
  });

  it("LRU evicts oldest after 140 items", () => {
    for (let i = 0; i < 160; i += 1) {
      cacheSet(linkCache, `k${i}`, { player_url: `u${i}` }, 60_000);
    }
    expect(linkCache.size).toBeLessThanOrEqual(140);
    /* самые свежие сохранены */
    expect(cacheGet(linkCache, "k159")).toBeTruthy();
    /* очень старые вытеснены */
    expect(cacheGet(linkCache, "k0")).toBeNull();
  });
});

describe("warmBootstrap", () => {
  it("uses normal fetch when no head-prefetch", async () => {
    const fakeData = {
      anime_id: 1735,
      translation_id: "2068",
      episode: 1,
      watch: {},
      link: { player_url: "https://cdn/720.mp4", kodik_max_quality: 720 },
    };
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => fakeData,
        }) as unknown as Response,
    );
    const result = await warmBootstrap(1735, "2068", 1);
    expect(result).toEqual(fakeData);
    expect(takeWarmBootstrap(1735, "2068", 1)).toEqual(fakeData);
    /* link тоже попал в кэш */
    expect(takeWarmLink(1735, "2068", 1)).toEqual({
      player_url: "https://cdn/720.mp4",
      kodik_max_quality: 720,
    });
  });

  it("consumes window.__sutekiBoot__ if params match", async () => {
    const fakeData = {
      anime_id: 1735,
      translation_id: "2068",
      episode: 1,
      watch: {},
      link: null,
    };
    (window as unknown as { __sutekiBoot__: object }).__sutekiBoot__ = {
      params: { animeId: 1735, translationId: "2068", episode: 1 },
      bootstrap: Promise.resolve(fakeData),
    };
    /* fetch не должен вызываться, если head-prefetch есть */
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const result = await warmBootstrap(1735, "2068", 1);
    expect(result).toEqual(fakeData);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignores head-prefetch when animeId mismatches", async () => {
    (window as unknown as { __sutekiBoot__: object }).__sutekiBoot__ = {
      params: { animeId: 9999, translationId: null, episode: 1 },
      bootstrap: Promise.resolve({} as never),
    };
    const fakeData = {
      anime_id: 1735,
      translation_id: "2068",
      episode: 1,
      watch: {},
      link: null,
    };
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => fakeData,
        }) as unknown as Response,
    );
    const result = await warmBootstrap(1735, "2068", 1);
    expect(result).toEqual(fakeData);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to normal fetch if head-prefetch rejects", async () => {
    (window as unknown as { __sutekiBoot__: object }).__sutekiBoot__ = {
      params: { animeId: 1735, translationId: "2068", episode: 1 },
      bootstrap: Promise.reject(new Error("network err")),
    };
    const fakeData = {
      anime_id: 1735,
      translation_id: "2068",
      episode: 1,
      watch: {},
      link: null,
    };
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => fakeData,
        }) as unknown as Response,
    );
    const result = await warmBootstrap(1735, "2068", 1);
    expect(result).toEqual(fakeData);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent calls (in-flight)", async () => {
    const fakeData = {
      anime_id: 1735,
      translation_id: "2068",
      episode: 1,
      watch: {},
      link: null,
    };
    let resolveFetch: (r: Response) => void = () => {};
    const p = new Promise<Response>((res) => {
      resolveFetch = res;
    });
    const fetchSpy = vi.fn(async () => p);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const a = warmBootstrap(1735, "2068", 1);
    const b = warmBootstrap(1735, "2068", 1);
    expect(a).toBe(b);
    resolveFetch({ ok: true, status: 200, json: async () => fakeData } as unknown as Response);
    await a;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("stores result with correct TTL", async () => {
    const fakeData = {
      anime_id: 1735,
      translation_id: "2068",
      episode: 1,
      watch: {},
      link: null,
    };
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => fakeData,
        }) as unknown as Response,
    );
    await warmBootstrap(1735, "2068", 1);
    expect(takeWarmBootstrap(1735, "2068", 1)).toEqual(fakeData);
    vi.advanceTimersByTime(CACHE_TTL_BOOTSTRAP_MS + 1000);
    expect(takeWarmBootstrap(1735, "2068", 1)).toBeNull();
  });
});

describe("link cache TTL is shorter than bootstrap TTL", () => {
  it("link expires faster than bootstrap to refresh stale URLs", () => {
    expect(CACHE_TTL_LINK_MS).toBeLessThanOrEqual(CACHE_TTL_BOOTSTRAP_MS);
  });
});

describe("preconnectMediaOrigin", () => {
  it("appends one <link rel=preconnect> per origin", () => {
    preconnectMediaOrigin("https://cdn.example.com/path/720.mp4");
    preconnectMediaOrigin("https://cdn.example.com/other/360.mp4");
    const links = document.head.querySelectorAll(
      "link[id^='suteki-media-preconnect-https://cdn.example.com']",
    );
    expect(links.length).toBe(1);
  });

  it("ignores non-http urls", () => {
    preconnectMediaOrigin("");
    preconnectMediaOrigin("data:text/plain,x");
    expect(document.head.querySelectorAll("link[id^='suteki-media-preconnect-']").length).toBe(0);
  });
});
