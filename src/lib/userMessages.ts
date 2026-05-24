/** Человекочитаемые сообщения для UI (технические детали — только в debug). */

export function formatVideoError(code: number): string {
  switch (code) {
    case 1:
      return "Воспроизведение прервано. Нажмите «Повторить» или выберите другую серию.";
    case 2:
      return "Не удалось загрузить видео. Проверьте интернет и нажмите «Повторить».";
    case 3:
      return "Ошибка декодирования. Попробуйте другое качество или озвучку.";
    case 4:
      return "Это видео не получилось загрузить. Попробуйте другую озвучку или серию.";
    default:
      return "Не удалось воспроизвести видео. Попробуйте другую озвучку или серию.";
  }
}

export function formatApiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim();
  if (/KODIK_UNAVAILABLE|not_in_kodik|kodik upstream/i.test(raw)) {
    return "Это аниме недоступно в Kodik. Попробуйте другую озвучку или тайтл.";
  }
  if (/KODIK_GEO|geo_block|region/i.test(raw)) {
    return "Контент недоступен в вашем регионе.";
  }
  if (/таймаут|timeout|abort/i.test(raw)) {
    return "Сервер не отвечает. Проверьте интернет и попробуйте позже.";
  }
  if (/HTTP 429|too many/i.test(raw)) {
    return "Слишком много запросов. Подождите немного и попробуйте снова.";
  }
  if (/HTTP 503/i.test(raw)) {
    return "Это аниме сейчас недоступно. Попробуйте другую озвучку или серию.";
  }
  if (/HTTP 502|VPS temporarily|VPS unreachable/i.test(raw)) {
    return "Сервер временно недоступен. Подождите и попробуйте снова.";
  }
  if (/HTTP 5\d{2}/.test(raw)) {
    return "Ошибка сервера. Попробуйте позже.";
  }
  if (/fetch failed|network|unreachable|failed to fetch/i.test(raw)) {
    return "Нет связи с сервером. Проверьте интернет.";
  }
  if (/HTTP 404|not found/i.test(raw)) {
    return "Не найдено. Попробуйте другую серию или озвучку.";
  }
  if (/HTTP 403/i.test(raw)) {
    return "Доступ запрещён. Попробуйте позже.";
  }
  return msg || "Не удалось выполнить запрос.";
}

export function tgHaptic(style: "light" | "medium" | "heavy" | "rigid" | "soft" = "light"): void {
  if (typeof window === "undefined") return;
  try {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.(style);
  } catch {
    /* */
  }
}
