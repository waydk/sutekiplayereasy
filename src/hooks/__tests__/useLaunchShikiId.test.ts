import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pushLaunchShikiId } from "../useLaunchShikiId";
import { parseLaunchShikiId } from "../../telegramWebApp";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("pushLaunchShikiId", () => {
  it("keeps shiki_id in the URL after opening an anime", () => {
    pushLaunchShikiId(16498);
    expect(window.location.search).toContain("shiki_id=16498");
    expect(parseLaunchShikiId()).toBe(16498);
  });

  it("clears launch params when returning home", () => {
    pushLaunchShikiId(16498);
    pushLaunchShikiId(null);
    expect(window.location.search).not.toContain("shiki_id");
    expect(parseLaunchShikiId()).toBeNull();
  });
});
