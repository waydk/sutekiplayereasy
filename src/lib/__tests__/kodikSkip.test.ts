import { describe, expect, it } from "vitest";
import { shouldAutoSkipOpening } from "../kodikSkip";

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
