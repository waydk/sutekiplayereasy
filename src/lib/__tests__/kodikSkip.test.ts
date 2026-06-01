import { describe, expect, it } from "vitest";
import {
  isInEndingSegment,
  KODIK_SKIP_SEEK,
  pickSkipMarkersFromKodikLink,
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
