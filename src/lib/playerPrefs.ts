/** Настройки плеера в localStorage. */

const AUTO_SKIP_OP_KEY = "sh.pref:autoSkipOp:v1";
const AUTO_NEXT_KEY = "sh.pref:autoNext:v1";
const THEATER_KEY = "sh.pref:theater:v1";

function readBool(key: string, defaultOn = true): boolean {
  if (typeof window === "undefined") return defaultOn;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "0" || raw === "false") return false;
    if (raw === "1" || raw === "true") return true;
    return defaultOn;
  } catch {
    return defaultOn;
  }
}

function writeBool(key: string, on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* */
  }
}

export function readAutoSkipOpPref(): boolean {
  return readBool(AUTO_SKIP_OP_KEY, true);
}

export function writeAutoSkipOpPref(on: boolean): void {
  writeBool(AUTO_SKIP_OP_KEY, on);
}

export function readAutoNextPref(): boolean {
  return readBool(AUTO_NEXT_KEY, true);
}

export function writeAutoNextPref(on: boolean): void {
  writeBool(AUTO_NEXT_KEY, on);
}

export function readTheaterPref(): boolean {
  return readBool(THEATER_KEY, false);
}

export function writeTheaterPref(on: boolean): void {
  writeBool(THEATER_KEY, on);
}
