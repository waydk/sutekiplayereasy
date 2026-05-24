import { describe, expect, it } from "vitest";
import {
  isShikimoriPosterUrl,
  resolveCalendarPoster,
} from "../calendarPosterCache";
import type { CalendarAiringItem } from "../homeCalendar";

function item(partial: Partial<CalendarAiringItem> & { anime_id: number }): CalendarAiringItem {
  return {
    title: "Test",
    airs_at: "",
    airs_time: "12:00",
    airs_date: "2026-05-24",
    ...partial,
  };
}

describe("calendarPosterCache", () => {
  it("detects shikimori poster urls", () => {
    expect(isShikimoriPosterUrl("https://shikimori.one/system/animes/original/1.jpg")).toBe(true);
    expect(isShikimoriPosterUrl("/api/v1/assets/anime/1/poster.jpg")).toBe(false);
  });

  it("prefers shikimori poster from calendar item", () => {
    const url = "https://shikimori.one/system/animes/original/99.jpg";
    expect(
      resolveCalendarPoster(
        item({
          anime_id: 99,
          poster: url,
        }),
      ),
    ).toBe(url);
  });

  it("falls back to assets api when no shikimori url", () => {
    expect(
      resolveCalendarPoster(
        item({
          anime_id: 42,
          poster: "/api/v1/assets/anime/42/poster.jpg",
        }),
      ),
    ).toBe("/api/v1/assets/anime/42/poster.jpg?v=poster");
  });
});
