import type Plyr from "plyr";
import { KODIK_SKIP_SEEK, resolveMediaDurationSec } from "./kodikSkip";

const PLYR_QUALITY_WHITELIST = [4320, 2880, 2160, 1440, 1080, 720, 576, 480, 360, 240] as const;

type PlyrInternals = Plyr & {
  config: { quality: { options: number[] } };
  options: { quality: number[] };
  elements?: {
    settings?: {
      panels?: { quality?: HTMLElement };
      buttons?: { quality?: HTMLElement };
    };
  };
};

/** Обновляет пункт «Качество» в меню настроек Plyr (шестерёнка в контролах). */
export function syncPlyrQualityMenu(player: Plyr, qualities: number[], selected?: number): void {
  const p = player as PlyrInternals;
  p.config.quality.options = [...PLYR_QUALITY_WHITELIST];
  p.options.quality = qualities;

  const panel = p.elements?.settings?.panels?.quality;
  const tabBtn = p.elements?.settings?.buttons?.quality;
  const list = panel?.querySelector('[role="menu"]');
  if (!panel || !list) return;

  const show = qualities.length > 1;
  if (tabBtn) tabBtn.hidden = !show;
  panel.hidden = !show;
  if (!show) return;

  list.innerHTML = "";
  const sorted = [...qualities].sort((a, b) => b - a);
  for (const q of sorted) {
    const item = document.createElement("button");
    item.type = "button";
    item.role = "menuitemradio";
    item.className = "plyr__control";
    item.value = String(q);
    item.setAttribute("aria-checked", selected === q ? "true" : "false");
    item.innerHTML = `<span>${q}p</span>`;
    item.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      for (const sib of list.querySelectorAll('[role="menuitemradio"]')) {
        sib.setAttribute("aria-checked", "false");
      }
      item.setAttribute("aria-checked", "true");
      p.quality = q;
    });
    list.appendChild(item);
  }

  const valueEl = tabBtn?.querySelector(".plyr__menu__value");
  if (valueEl && selected != null) {
    valueEl.textContent = `${selected}p`;
  }
}

export const PLYR_QUALITY_CONFIG = {
  default: 720,
  options: [...PLYR_QUALITY_WHITELIST],
  forced: true as const,
};

/** Шаг перемотки в Plyr (кнопки / стрелки при фокусе на плеере). */
export const PLYR_SEEK_TIME_SEC = KODIK_SKIP_SEEK.seekStepSec;

type PlyrWithDurationConfig = Plyr & {
  config: { duration?: number };
};

/**
 * Plyr не умеет seek при duration === Infinity (типичный HLS до полного манифеста).
 * Подставляем длительность из seekable (не меньше currentTime — иначе Plyr откатывает назад).
 */
export function syncPlyrTimeline(player: Plyr | null, video: HTMLVideoElement | null): void {
  if (!player || !video) return;
  const p = player as PlyrWithDurationConfig;
  const raw = video.duration;
  const needsFaux =
    !Number.isFinite(raw) ||
    raw <= 0 ||
    raw === Number.POSITIVE_INFINITY ||
    raw >= 2 ** 32 ||
    Number.isNaN(raw);

  if (needsFaux) {
    const timelineEnd = resolveMediaDurationSec(video);
    if (timelineEnd == null) return;
    const rounded = Math.round(timelineEnd * 100) / 100;
    if (p.config.duration === rounded) return;
    p.config.duration = rounded;
    video.dispatchEvent(new Event("durationchange"));
    return;
  }

  if (p.config.duration != null) {
    delete p.config.duration;
    video.dispatchEvent(new Event("durationchange"));
  }
}
