import { useCallback, useEffect } from "react";

const FOCUS_CLASS = "player-search-focus";

function setSearchFocusClass(on: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(FOCUS_CLASS, on);
  document.body.classList.toggle(FOCUS_CLASS, on);
}

/** Снимает класс и закрывает клавиатуру после «Найти» — иначе на мобилке ломается layout. */
export function usePlayerSearchFocus() {
  const onSearchFocus = useCallback(() => {
    setSearchFocusClass(true);
  }, []);

  const onSearchBlur = useCallback(() => {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && active.classList.contains("sh-input")) return;
      setSearchFocusClass(false);
    }, 0);
  }, []);

  const dismissSearchKeyboard = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    setSearchFocusClass(false);
  }, []);

  useEffect(() => () => setSearchFocusClass(false), []);

  return { onSearchFocus, onSearchBlur, dismissSearchKeyboard };
}
