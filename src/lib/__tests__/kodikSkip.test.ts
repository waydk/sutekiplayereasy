import { describe, expect, it } from "vitest";
import {
  clampSeekSec,
  getPlayableEndSec,
  getPlayableStartSec,
  isInEndingSegment,
  KODIK_SKIP_SEEK,
  pickSkipMarkersFromKodikLink,
  resolveMediaDurationSec,
  shouldAutoSkipOpening,
} from "../kodikSkip";

describe("pickSkipMarkersFromKodikLink", () => {
  it("reads opening and ending aliases", () => {
    expect(
      pickSkipMarkersFromKodikLink({
        opening_end_sec: 90,
        ending_start_sec: 1320,
        ending_skip_to_sec: 1380,
      }),
    ).toEqual({
      openingEndSec: 90,
      endingStartSec: 1320,
      endingSkipToSec: 1380,
    });
  });
});

describe("KODIK_SKIP_SEEK", () => {
  it("uses 5s seek step", () => {
    expect(KODIK_SKIP_SEEK.seekStepSec).toBe(5);
  });
});

function mockVideo(partial: Partial<HTMLVideoElement> & { seekableRanges?: Array<{ start: number; end: number }> }): HTMLVideoElement {
  const ranges = partial.seekableRanges ?? [];
  const seekable = {
    length: ranges.length,
    start: (i: number) => ranges[i]?.start ?? 0,
    end: (i: number) => ranges[i]?.end ?? 0,
  };
  return {
    duration: Number.NaN,
    currentTime: 0,
    ...partial,
    seekable,
  } as HTMLVideoElement;
}

describe("seekable timeline", () => {
  it("uses seekable end when duration is Infinity (HLS)", () => {
    const v = mockVideo({ duration: Number.POSITIVE_INFINITY, seekableRanges: [{ start: 0, end: 1200 }] });
    expect(getPlayableEndSec(v)).toBe(1200);
    expect(resolveMediaDurationSec(v)).toBe(1200);
  });

  it("never reports duration below currentTime (Plyr clamp guard)", () => {
    const v = mockVideo({
      duration: Number.POSITIVE_INFINITY,
      currentTime: 900,
      seekableRanges: [{ start: 600, end: 800 }],
    });
    expect(resolveMediaDurationSec(v)).toBe(900);
  });

  it("clamps seek inside seekable range", () => {
    const v = mockVideo({
      duration: 1200,
      seekableRanges: [{ start: 10, end: 500 }],
      currentTime: 100,
    });
    expect(getPlayableStartSec(v)).toBe(10);
    expect(clampSeekSec(v, 5)).toBe(10);
    expect(clampSeekSec(v, 800)).toBeCloseTo(499.95, 2);
  });

  it("prefers min(duration, seekable.end)", () => {
    const v = mockVideo({
      duration: 900,
      seekableRanges: [{ start: 0, end: 1200 }],
    });
    expect(getPlayableEndSec(v)).toBe(900);
  });
});

describe("isInEndingSegment", () => {
  const markers = {
    openingEndSec: null,
    endingStartSec: 1320,
    endingSkipToSec: 1380,
  };

  it("is false before ending start", () => {
    expect(isInEndingSegment(markers, 1310)).toBe(false);
  });

  it("is true at ending start", () => {
    expect(isInEndingSegment(markers, 1320)).toBe(true);
  });

  it("uses skip-to window when only ending_skip_to is set", () => {
    expect(
      isInEndingSegment(
        { openingEndSec: null, endingStartSec: null, endingSkipToSec: 1380 },
        1200,
      ),
    ).toBe(true);
    expect(
      isInEndingSegment(
        { openingEndSec: null, endingStartSec: null, endingSkipToSec: 1380 },
        1190,
      ),
    ).toBe(false);
  });
});

describe("shouldAutoSkipOpening", () => {
  it("skips when before opening end", () => {
    expect(shouldAutoSkipOpening({ openingEndSec: 149, endingStartSec: null, endingSkipToSec: null }, null, 30)).toBe(
      true,
    );
  });

  it("does not skip when resume past opening", () => {
    expect(shouldAutoSkipOpening({ openingEndSec: 149, endingStartSec: null, endingSkipToSec: null }, 200, 0)).toBe(
      false,
    );
  });
});
