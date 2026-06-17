import { describe, expect, it } from "vitest";
import { isCinemaLaunch } from "../cinemaMode";

describe("isCinemaLaunch", () => {
  it("returns true when cinema=1", () => {
    const p = new URLSearchParams("cinema=1&shiki_id=1");
    expect(isCinemaLaunch(p, false)).toBe(true);
  });

  it("returns true in Telegram with episode and translation_id", () => {
    const p = new URLSearchParams("episode=3&translation_id=737&shiki_id=1");
    expect(isCinemaLaunch(p, true)).toBe(true);
  });

  it("returns false in browser without cinema flag", () => {
    const p = new URLSearchParams("episode=3&translation_id=737&shiki_id=1");
    expect(isCinemaLaunch(p, false)).toBe(false);
  });

  it("returns false in Telegram without episode params", () => {
    const p = new URLSearchParams("shiki_id=1");
    expect(isCinemaLaunch(p, true)).toBe(false);
  });
});
