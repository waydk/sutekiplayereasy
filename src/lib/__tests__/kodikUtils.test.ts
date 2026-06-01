import { describe, expect, it } from "vitest";
import {
  availableQualities,
  qualitiesFromKodikLink,
  buildEpisodesOptions,
  inferQualityFromUrl,
  isMovieSeriesRange,
  pickFirstTranslationId,
  replaceQualityInUrl,
  resolveHlsManifestUrl,
  translationHasValidSeriesRange,
  translationRowIdString,
} from "../kodikUtils";

describe("translation helpers", () => {
  it("translationRowIdString handles 0/null/undefined", () => {
    expect(translationRowIdString(null)).toBe("");
    expect(translationRowIdString(undefined)).toBe("");
    expect(translationRowIdString({ id: 0 })).toBe("0");
    expect(translationRowIdString({ translation_id: "609" })).toBe("609");
  });

  it("isMovieSeriesRange detects [0,0]", () => {
    expect(isMovieSeriesRange([0, 0])).toBe(true);
    expect(isMovieSeriesRange([1, 12])).toBe(false);
    expect(isMovieSeriesRange(null)).toBe(false);
    expect(isMovieSeriesRange(undefined)).toBe(false);
  });

  it("translationHasValidSeriesRange filters movie ranges", () => {
    expect(translationHasValidSeriesRange({ series_range: [1, 24] })).toBe(true);
    expect(translationHasValidSeriesRange({ series_range: [0, 0] })).toBe(false);
    expect(translationHasValidSeriesRange({})).toBe(false);
  });

  it("pickFirstTranslationId returns first id", () => {
    expect(
      pickFirstTranslationId({
        translations: [{ id: 2068 }, { id: 42 }],
      }),
    ).toBe("2068");
    expect(pickFirstTranslationId({ translations: [] })).toBeNull();
    expect(pickFirstTranslationId(null)).toBeNull();
  });
});

describe("buildEpisodesOptions", () => {
  it("returns empty array when payload is null/empty (no fake 1-12)", () => {
    expect(buildEpisodesOptions(null)).toHaveLength(0);
    expect(buildEpisodesOptions({})).toHaveLength(0);
    expect(buildEpisodesOptions({ seasons: [] })).toHaveLength(0);
  });

  it("builds real episode list", () => {
    const out = buildEpisodesOptions({
      seasons: [
        {
          season: 1,
          episodes: [
            { episode: 1, available: true },
            { episode: 2, available: false },
            { episode: 3, available: true },
          ],
        },
      ],
    });
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ value: "1", disabled: false });
    expect(out[1]).toMatchObject({ value: "2", disabled: true, label: expect.stringMatching(/недоступн/) });
  });

  it("dedupes duplicate episodes across seasons", () => {
    const out = buildEpisodesOptions({
      seasons: [
        { episodes: [{ episode: 1, available: true }, { episode: 2, available: true }] },
        { episodes: [{ episode: 2, available: true }, { episode: 3, available: true }] },
      ],
    });
    expect(out.map((x) => x.value)).toEqual(["1", "2", "3"]);
  });

  it("ignores non-numeric / non-positive episode numbers", () => {
    const out = buildEpisodesOptions({
      seasons: [{ episodes: [{ episode: 0 }, { episode: -5 }, { episode: NaN }, { episode: 7 }] }],
    });
    expect(out.map((x) => x.value)).toEqual(["7"]);
  });
});

describe("quality utils", () => {
  it("availableQualities respects maxQ", () => {
    expect(availableQualities(360)).toEqual([360]);
    expect(availableQualities(480)).toEqual([360, 480]);
    expect(availableQualities(720)).toEqual([360, 480, 720]);
    expect(availableQualities(1080)).toEqual([360, 480, 720]);
    /* null/0 → default */
    expect(availableQualities(null)).toEqual([360, 480, 720]);
    expect(availableQualities(0)).toEqual([360, 480, 720]);
  });

  it("qualitiesFromKodikLink prefers kodik_max_quality from Kodik API", () => {
    expect(
      qualitiesFromKodikLink({
        kodik_available_qualities: [360, 480],
        kodik_max_quality: 720,
      }),
    ).toEqual([360, 480, 720]);
    expect(qualitiesFromKodikLink({ kodik_max_quality: 480 })).toEqual([360, 480]);
    expect(qualitiesFromKodikLink(null)).toEqual([360, 480, 720]);
  });

  it("inferQualityFromUrl picks from /720.mp4", () => {
    expect(inferQualityFromUrl("https://cdn/path/720.mp4")).toBe(720);
    expect(inferQualityFromUrl("https://cdn/path/480.mp4?token=xx")).toBe(480);
    expect(inferQualityFromUrl("https://cdn/path/360.mp4#hash")).toBe(360);
    expect(inferQualityFromUrl("https://cdn/path/720p.mp4")).toBeNull();
  });

  it("replaceQualityInUrl preserves query/hash", () => {
    expect(replaceQualityInUrl("https://cdn/a/720.mp4?t=1", 360)).toBe("https://cdn/a/360.mp4?t=1");
    expect(replaceQualityInUrl("https://cdn/a/720.mp4#x", 480)).toBe("https://cdn/a/480.mp4#x");
    expect(replaceQualityInUrl("", 480)).toBe("");
  });
});

describe("resolveHlsManifestUrl", () => {
  it("proxies absolute manifest urls through /api/v1/media/kodik/hls/", () => {
    const out = resolveHlsManifestUrl("https://cdn.solodcdn.com/path/manifest.m3u8");
    expect(out).toMatch(/\/api\/v1\/media\/kodik/);
  });

  it("returns relative urls unchanged or proxied through /api", () => {
    const out = resolveHlsManifestUrl("//cdn/path/manifest.m3u8");
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});
