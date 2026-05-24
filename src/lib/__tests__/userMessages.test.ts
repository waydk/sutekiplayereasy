import { describe, expect, it } from "vitest";
import { formatApiError, formatVideoError } from "../userMessages";

describe("formatVideoError", () => {
  it("explains MEDIA_ERR_SRC_NOT_SUPPORTED in Russian without code", () => {
    const msg = formatVideoError(4);
    expect(msg).toMatch(/загрузить|озвучку|серию/i);
    expect(msg).not.toMatch(/code=|HTTP /i);
  });

  it.each([
    [1, /прервано/i],
    [2, /интернет|загрузить/i],
    [3, /декод/i],
    [4, /загрузить|озвучку|серию/i],
    [99, /воспроизвести/i],
  ])("code=%i → human-readable message", (code, pattern) => {
    expect(formatVideoError(code)).toMatch(pattern);
  });
});

describe("formatApiError", () => {
  it("strips URLs and gives generic fallback", () => {
    const r = formatApiError(new Error("Failed at https://very.long.url/path?with=stuff"));
    expect(r).not.toMatch(/https?:/);
    expect(r.length).toBeGreaterThan(0);
  });

  it.each([
    ["KODIK_UNAVAILABLE", /недоступно в Kodik/i],
    ["kodik upstream timeout", /недоступно в Kodik/i],
    ["KODIK_GEO blocked", /регион/i],
    ["network timeout while fetching", /сервер не отвечает/i],
    ["request abort", /сервер не отвечает/i],
    ["HTTP 429 too many requests", /много запросов/i],
    ["HTTP 503 service unavailable", /сейчас недоступно/i],
    ["HTTP 502 bad gateway", /временно недоступен/i],
    ["HTTP 500 internal", /ошибка сервера/i],
    ["fetch failed", /связи с сервером|интернет/i],
    ["HTTP 404 not found", /не найдено/i],
    ["HTTP 403 forbidden", /доступ запрещён/i],
  ])("classifies %s", (input, expected) => {
    expect(formatApiError(new Error(input))).toMatch(expected);
  });

  it("never returns empty string", () => {
    expect(formatApiError(new Error(""))).toBeTruthy();
    expect(formatApiError("")).toBeTruthy();
    expect(formatApiError(null)).toBeTruthy();
    expect(formatApiError(undefined)).toBeTruthy();
  });

  it("does not leak the URL with original error", () => {
    const out = formatApiError(
      new Error("HTTP 500 from https://api.example.com/anime/1735/kodik/link?episode=1&translation_id=2068"),
    );
    expect(out).not.toMatch(/example\.com/);
    expect(out).not.toMatch(/translation_id=/);
  });
});
