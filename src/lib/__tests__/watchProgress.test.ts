import { beforeEach, describe, expect, it } from "vitest";
import {
  flushWatchProgress,
  formatClockSec,
  formatResumeHint,
  readLastWatch,
  readResumeSec,
  resolveLaunchWatch,
  writeLastWatch,
  writeResumeSec,
} from "../watchProgress";

beforeEach(() => {
  localStorage.clear();
});

describe("formatClockSec", () => {
  it("formats minutes and seconds", () => {
    expect(formatClockSec(125)).toBe("2:05");
  });

  it("formats hours", () => {
    expect(formatClockSec(3661)).toBe("1:01:01");
  });
});

describe("formatResumeHint", () => {
  it("includes episode and time", () => {
    expect(formatResumeHint(5, 125)).toBe("Серия 5 · продолжаем с 2:05");
  });
});

describe("resume per episode", () => {
  it("round-trips seconds", () => {
    writeResumeSec(21, "2068", 3, 90.7);
    expect(readResumeSec(21, "2068", 3)).toBe(90);
  });

  it("clears on zero", () => {
    writeResumeSec(21, "2068", 1, 10);
    writeResumeSec(21, "2068", 1, 0);
    expect(readResumeSec(21, "2068", 1)).toBeNull();
  });
});

describe("last watch", () => {
  it("stores episode and position", () => {
    writeLastWatch(21, { translationId: "2068", episode: 7, positionSec: 612 });
    const last = readLastWatch(21);
    expect(last?.episode).toBe(7);
    expect(last?.positionSec).toBe(612);
    expect(last?.translationId).toBe("2068");
  });
});

describe("resolveLaunchWatch", () => {
  it("uses URL episode when explicit", () => {
    writeLastWatch(21, { translationId: "1", episode: 9, positionSec: 100 });
    const r = resolveLaunchWatch(21, { explicitEpisode: true, urlEpisode: 2, urlTranslationId: "2068" });
    expect(r.episode).toBe(2);
    expect(r.usedSavedEpisode).toBe(false);
  });

  it("restores last episode when URL has no episode", () => {
    writeLastWatch(21, { translationId: "2068", episode: 9, positionSec: 480 });
    writeResumeSec(21, "2068", 9, 480);
    const r = resolveLaunchWatch(21, { explicitEpisode: false, urlEpisode: 1 });
    expect(r.episode).toBe(9);
    expect(r.translationId).toBe("2068");
    expect(r.savedResumeSec).toBe(480);
    expect(r.usedSavedEpisode).toBe(true);
  });
});

describe("flushWatchProgress", () => {
  it("advances last episode near end", () => {
    flushWatchProgress(21, "2068", 4, 1196, 1200);
    expect(readResumeSec(21, "2068", 4)).toBeNull();
    expect(readLastWatch(21)?.episode).toBe(5);
    expect(readLastWatch(21)?.positionSec).toBe(0);
  });
});
