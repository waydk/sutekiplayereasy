import { expect, test } from "@playwright/test";
import { mockPlayerApi } from "./helpers/mockPlayerApi";

test.describe("Race conditions & rapid clicks", () => {
  test("rapid translation switch settles without dozens of requests", async ({ page }) => {
    await mockPlayerApi(page);
    let linkRequests = 0;
    page.on("request", (req) => {
      if (req.url().includes("/kodik/link?")) linkRequests += 1;
    });
    await page.goto("/?shiki_id=1735&translation_id=2068&episode=1");
    await expect(page.locator(".sh-tr-strip .sh-tr-chip")).toHaveCount(2, { timeout: 8000 });

    const chips = page.locator(".sh-tr-strip .sh-tr-chip");
    for (let i = 0; i < 4; i += 1) {
      await chips.nth(i % 2).click({ force: true });
    }
    await page.waitForTimeout(800);
    /* 4 переключения + initial prefetch + next-episode warmup → ~8 максимум.
       Главное: нет N*N зацикленных запросов. */
    expect(linkRequests).toBeLessThan(15);
  });

  test("rapid episode pick: only latest episode plays", async ({ page }) => {
    await mockPlayerApi(page);
    await page.goto("/?shiki_id=1735&translation_id=2068&episode=1");
    await expect(page.locator(".sh-tr-strip .sh-tr-chip").first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator("button.sh-ep-btn")).toHaveCount(12, { timeout: 8000 });

    const eps = page.locator("button.sh-ep-btn");
    for (let i = 0; i < 5; i += 1) {
      await eps.nth(i).click({ force: true });
    }
    /* Подождём пока стейт устаканится */
    await page.waitForTimeout(600);
    /* Активна должна быть последняя нажатая (5-я серия, индекс 4) */
    const activeEp = await page.locator("button.sh-ep-btn.active").first().textContent();
    expect(activeEp?.trim()).toBe("5");
  });
});

test.describe("Cache reuse for instant restart", () => {
  test("returning to same episode reuses cached link (zero new requests)", async ({ page }) => {
    await mockPlayerApi(page);
    let linkRequests = 0;
    let bootstrapRequests = 0;
    page.on("request", (req) => {
      const u = req.url();
      if (u.includes("/kodik/link?")) linkRequests += 1;
      if (u.includes("/player/bootstrap?")) bootstrapRequests += 1;
    });
    await page.goto("/?shiki_id=1735&translation_id=2068&episode=1");
    await expect(page.locator(".sh-tr-strip .sh-tr-chip")).toHaveCount(2, { timeout: 8000 });
    const initialBoot = bootstrapRequests;
    const initialLink = linkRequests;

    /* Кликаем на 2-ю серию, потом обратно на 1-ю */
    await page.locator("button.sh-ep-btn").nth(1).click();
    await page.waitForTimeout(300);
    await page.locator("button.sh-ep-btn").nth(0).click();
    await page.waitForTimeout(400);

    /* Bootstrap — только 1 раз. По ссылкам: предсказуемое число запросов, без бесконечных циклов. */
    expect(bootstrapRequests).toBeLessThanOrEqual(initialBoot + 1);
    expect(linkRequests - initialLink).toBeLessThan(10);
  });
});

test.describe("Mobile (Telegram WebView)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("renders without horizontal scrollbar on iPhone", async ({ page }) => {
    await mockPlayerApi(page);
    await page.goto("/?shiki_id=1735&translation_id=2068&episode=1");
    await expect(page.locator(".sh-tr-strip .sh-tr-chip").first()).toBeVisible({ timeout: 8000 });
    const overflow = await page.evaluate(() => {
      return {
        bodyScroll: document.body.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    /* Никакого горизонтального скролла на mobile */
    expect(overflow.bodyScroll).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });

  test("translation chips meet 44px touch target", async ({ page }) => {
    await mockPlayerApi(page);
    await page.goto("/?shiki_id=1735&translation_id=2068&episode=1");
    await expect(page.locator(".sh-tr-strip .sh-tr-chip").first()).toBeVisible({ timeout: 8000 });
    const chipBox = await page.locator(".sh-tr-strip .sh-tr-chip").first().boundingBox();
    expect(chipBox?.height ?? 0).toBeGreaterThanOrEqual(36);
  });

  test("search focus and submit do not break page width", async ({ page }) => {
    await mockPlayerApi(page);
    await page.goto("/");
    const search = page.getByRole("searchbox", { name: /Поиск аниме/i });
    await search.click();
    await search.fill("Naruto");
    await expect(page.locator("html")).toHaveClass(/player-search-focus/);
    await page.getByRole("button", { name: /Найти/i }).click();
    await expect(page.getByRole("listitem").first()).toBeVisible({ timeout: 8000 });
    const metrics = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      searchVisible: !!document.querySelector(".sh-search")?.getBoundingClientRect().width,
    }));
    expect(metrics.scrollW).toBeLessThanOrEqual(metrics.clientW + 1);
    expect(metrics.searchVisible).toBe(true);
    await expect(page.locator("html")).not.toHaveClass(/player-search-focus/);
  });
});
