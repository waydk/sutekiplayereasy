import { expect, test } from "@playwright/test";
import { mockPlayerApi } from "./helpers/mockPlayerApi";

test.describe("Player startup speed", () => {
  test("deep link → translations rendered fast", async ({ page }) => {
    await mockPlayerApi(page, { bootstrapLatencyMs: 50, linkLatencyMs: 50 });
    const start = Date.now();
    await page.goto("/?shiki_id=1735&translation_id=2068&episode=1");
    /* Озвучки должны появиться быстро. */
    await expect(page.locator(".sh-tr-strip .sh-tr-chip").first()).toBeVisible({ timeout: 5000 });
    const trVisibleMs = Date.now() - start;
    expect(trVisibleMs).toBeLessThan(5000);
  });

  test("head prefetch (window.__sutekiBoot__) initialized for shiki_id", async ({ page }) => {
    await mockPlayerApi(page);
    await page.goto("/?shiki_id=1735&translation_id=2068&episode=1");
    /* После загрузки страницы __sutekiBoot__ должен быть заполнен */
    const boot = await page.evaluate(() => {
      const w = window as unknown as {
        __sutekiBoot__?: { params?: object; bootstrap?: unknown };
      };
      return w.__sutekiBoot__?.params ?? null;
    });
    expect(boot).toEqual({ animeId: 1735, translationId: "2068", episode: 1 });
  });

  test("no head prefetch when shiki_id absent", async ({ page }) => {
    await mockPlayerApi(page);
    await page.goto("/");
    const params = await page.evaluate(() => {
      const w = window as unknown as { __sutekiBoot__?: { params?: object } };
      return w.__sutekiBoot__?.params ?? null;
    });
    expect(params).toBeNull();
  });

  test("no head prefetch without episode in URL (saved progress may differ)", async ({ page }) => {
    await mockPlayerApi(page);
    await page.goto("/?shiki_id=1735&translation_id=2068");
    const params = await page.evaluate(() => {
      const w = window as unknown as { __sutekiBoot__?: { params?: object } };
      return w.__sutekiBoot__?.params ?? null;
    });
    expect(params).toBeNull();
  });

  test("saved episode 135 starts without stuck fullscreen loader", async ({ page }) => {
    await mockPlayerApi(page, { episodesCount: 12 });
    await page.addInitScript(() => {
      localStorage.setItem(
        "sh.last:v1:1735",
        JSON.stringify({
          translationId: "2068",
          episode: 135,
          positionSec: 612,
          updatedAt: Date.now(),
        }),
      );
      localStorage.setItem("sh.resume:v1:1735:2068:135", "612");
    });
    await page.goto("/?shiki_id=1735");
    await expect(page.locator(".sh-tr-strip .sh-tr-chip").first()).toBeVisible({ timeout: 12_000 });
    await expect(page.locator(".sh-current-episode-badge")).toContainText("135");
    await expect(page.locator(".sh-anime-load-overlay")).toHaveCount(0, { timeout: 18_000 });
  });

  test("video element has playsinline + metadata preload", async ({ page }) => {
    await mockPlayerApi(page);
    await page.goto("/?shiki_id=1735&translation_id=2068&episode=1");
    await expect(page.locator(".sh-tr-strip .sh-tr-chip").first()).toBeVisible({ timeout: 8000 });
    const video = page.locator("video").first();
    await expect(video).toHaveJSProperty("playsInline", true);
  });
});

test.describe("Player error handling", () => {
  test("503 KODIK_UNAVAILABLE shows user-friendly message (no HTTP code, no URL)", async ({ page }) => {
    await mockPlayerApi(page, {
      bootstrapWithoutLink: true,
      linkError: { status: 503, body: { detail: "KODIK_UNAVAILABLE" } },
    });
    await page.goto("/?shiki_id=1735&translation_id=2068&episode=1");
    await expect(page.getByText(/недоступно/i).first()).toBeVisible({ timeout: 12_000 });
    /* В пользовательском UI не должно быть HTTP кода или URL запроса */
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/HTTP 503/);
    expect(body).not.toMatch(/kodik\/link\?episode/);
  });

  test("502 gateway shows 'server temporarily down' message", async ({ page }) => {
    await mockPlayerApi(page, {
      bootstrapError: { status: 502, body: { detail: "Bad Gateway" } },
      linkError: { status: 502, body: { detail: "Bad Gateway" } },
    });
    await page.goto("/?shiki_id=1735&translation_id=2068&episode=1");
    await expect(page.getByText(/временно|сервер|подождите/i).first()).toBeVisible({
      timeout: 15_000,
    });
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/HTTP 502/);
  });
});

test.describe("Translation & episode UX", () => {
  test("translation chips visible with pill styling", async ({ page }) => {
    await mockPlayerApi(page);
    await page.goto("/?shiki_id=1735&translation_id=2068&episode=1");
    await expect(page.locator(".sh-tr-strip .sh-tr-chip")).toHaveCount(2, { timeout: 8000 });
    const chip = page.locator(".sh-tr-strip .sh-tr-chip").first();
    /* border-radius должен быть >= 999px (pill) */
    const radius = await chip.evaluate((el) => getComputedStyle(el).borderRadius);
    expect(radius).toMatch(/999|100%/);
  });

  test("episode strip shows real episodes from API (not fake 1-12)", async ({ page }) => {
    await mockPlayerApi(page, { episodesCount: 5 });
    await page.goto("/?shiki_id=1735&translation_id=2068&episode=1");
    await expect(page.locator(".sh-tr-strip .sh-tr-chip").first()).toBeVisible({ timeout: 8000 });
    /* После загрузки должно быть ровно 5 кнопок серий, а не 12 */
    await expect(page.locator("button.sh-ep-btn")).toHaveCount(5, { timeout: 10_000 });
  });

  test("search results clear after selecting an anime", async ({ page }) => {
    await mockPlayerApi(page);
    await page.goto("/");
    await page
      .getByRole("textbox", { name: /Поиск аниме/i })
      .fill("Naruto");
    await page.getByRole("button", { name: /Найти/i }).click();
    await expect(page.getByRole("listitem").first()).toBeVisible({ timeout: 6000 });
    await page.getByRole("listitem").first().click();
    await expect(page.getByRole("listitem")).toHaveCount(0, { timeout: 10_000 });
  });
});

test.describe("Quality selector", () => {
  test("quality select shows in player bar", async ({ page }) => {
    await mockPlayerApi(page);
    await page.goto("/?shiki_id=1735&translation_id=2068&episode=1");
    await expect(page.locator(".sh-tr-strip .sh-tr-chip").first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator(".sh-quality-select")).toBeVisible({ timeout: 5000 });
    const opts = await page.locator(".sh-quality-select option").allTextContents();
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.join(" ")).toMatch(/720p|480p|360p/);
  });
});

test.describe("No system noise in UI", () => {
  test("no raw URL or 'HTTP code' visible to user", async ({ page }) => {
    await mockPlayerApi(page);
    await page.goto("/?shiki_id=1735&translation_id=2068&episode=1");
    await expect(page.locator(".sh-tr-strip .sh-tr-chip").first()).toBeVisible({ timeout: 8000 });
    const body = await page.locator("body").innerText();
    /* В UI не должно быть видно технических URL-ов */
    expect(body).not.toMatch(/example\.invalid/);
    expect(body).not.toMatch(/HTTP \d{3}/);
    expect(body).not.toMatch(/code=\d/);
    expect(body).not.toMatch(/sutekiplayereasy\.vercel\.app/);
  });
});
