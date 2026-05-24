import { describe, expect, it, vi } from "vitest";
import {
  formatStartupTrace,
  getStartupNetworkHints,
  shouldDirectMp4Url,
  shouldMp4FirstStart,
  shouldPreloadHlsJs,
  shouldTryHlsStart,
  startupClientLabel,
  pickKodikMp4Quality,
  shouldAutoplayMuted,
  startupMp4Quality,
} from "../startupPolicy";

describe("startupClientLabel", () => {
  it.each([
    [true, "tg"],
    [false, "desktop"],
  ])("inTelegram=%s → %s", (tg, expected) => {
    if (expected === "desktop") {
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        configurable: true,
      });
    }
    expect(startupClientLabel(tg)).toBe(expected);
  });
});

describe("getStartupNetworkHints", () => {
  const orig = navigator;

  it("returns defaults when no connection info", () => {
    Object.defineProperty(window, "navigator", {
      value: { ...orig, connection: undefined, userAgent: "" },
      configurable: true,
    });
    const r = getStartupNetworkHints();
    expect(r.abrEstimate).toBeGreaterThan(0);
  });

  it("downgrades for 2g / save-data", () => {
    Object.defineProperty(window, "navigator", {
      value: { ...orig, connection: { effectiveType: "2g", saveData: true, downlink: 0.2 }, userAgent: "" },
      configurable: true,
    });
    const r = getStartupNetworkHints();
    expect(r.maxStartHeight).toBe(360);
    expect(r.label).toMatch(/save-data|2g/);
  });

  it("3g picks 480p", () => {
    Object.defineProperty(window, "navigator", {
      value: { ...orig, connection: { effectiveType: "3g", saveData: false, downlink: 1.0 }, userAgent: "" },
      configurable: true,
    });
    const r = getStartupNetworkHints();
    expect(r.maxStartHeight).toBe(480);
  });
});

describe("startup policy decisions", () => {
  it("shouldMp4FirstStart off in Telegram (HLS like desktop)", () => {
    expect(shouldMp4FirstStart(true, { abrEstimate: 0, maxStartHeight: 360, label: "tg" })).toBe(false);
    expect(shouldMp4FirstStart(false, { abrEstimate: 0, maxStartHeight: 360, label: "2g" })).toBe(false);
  });

  it("shouldPreloadHlsJs enabled in Telegram too", () => {
    expect(shouldPreloadHlsJs(true)).toBe(true);
    expect(shouldPreloadHlsJs(false)).toBe(true);
  });

  it("shouldTryHlsStart requires non-empty manifest and no mp4-first", () => {
    expect(shouldTryHlsStart("https://cdn/m.m3u8", false)).toBe(true);
    expect(shouldTryHlsStart("", false)).toBe(false);
    expect(shouldTryHlsStart("https://cdn/m.m3u8", true)).toBe(false);
  });

  it("shouldDirectMp4Url defaults to true unless VITE_DIRECT_MP4=0", () => {
    /* default env in vitest = no VITE_DIRECT_MP4 → true */
    expect(shouldDirectMp4Url()).toBe(true);
  });

  it("pickKodikMp4Quality uses kodik_max_quality (max 720)", () => {
    expect(
      pickKodikMp4Quality(
        { player_url: "https://cdn/x/720.mp4", kodik_max_quality: 720 },
        { abrEstimate: 0, maxStartHeight: null, label: "tg" },
      ),
    ).toBe(720);
    expect(
      pickKodikMp4Quality(
        { player_url: "https://cdn/x/480.mp4", kodik_max_quality: 480 },
        { abrEstimate: 0, maxStartHeight: null, label: "default" },
      ),
    ).toBe(480);
    expect(pickKodikMp4Quality(null, { abrEstimate: 0, maxStartHeight: null, label: "tg" })).toBe(720);
    expect(
      pickKodikMp4Quality(
        { player_url: "https://cdn/x/720.mp4", kodik_max_quality: 720 },
        { abrEstimate: 0, maxStartHeight: 360, label: "tg-2g" },
      ),
    ).toBe(360);
  });

  it("startupMp4Quality delegates to pickKodikMp4Quality", () => {
    expect(startupMp4Quality({ abrEstimate: 0, maxStartHeight: 360, label: "2g" })).toBe(360);
    expect(
      startupMp4Quality(
        { abrEstimate: 0, maxStartHeight: null, label: "tg" },
        true,
        { kodik_max_quality: 720, player_url: "https://cdn/720.mp4" },
      ),
    ).toBe(720);
  });

  it("shouldAutoplayMuted on mobile UA", () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      configurable: true,
    });
    expect(shouldAutoplayMuted()).toBe(true);
  });
});

describe("formatStartupTrace", () => {
  it("compact one-liner with all fields", () => {
    const s = formatStartupTrace({
      bootstrapMs: 120,
      linkMs: 80,
      manifestMs: 200,
      firstFrameMs: 450,
      firstPlayMs: 460,
      mode: "HLS",
      net: "4g",
      client: "tg",
    });
    expect(s).toMatch(/mode=HLS/);
    expect(s).toMatch(/bootstrap=120ms/);
    expect(s).toMatch(/frame=450ms/);
    expect(s).toMatch(/client=tg/);
  });

  it("uses seconds for ms ≥ 1000", () => {
    const s = formatStartupTrace({
      bootstrapMs: 1200,
      linkMs: 0,
      manifestMs: 0,
      firstFrameMs: 1500,
      firstPlayMs: 1600,
      mode: "MP4",
      net: "3g",
      client: "mobile",
    });
    expect(s).toMatch(/1\.20s|1\.20 s/);
  });
});
