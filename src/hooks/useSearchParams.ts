import { useMemo } from "react";

export function useSearchParams(): URLSearchParams {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}
