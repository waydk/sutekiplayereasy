export function shouldShowDebugPanel(): boolean {
  const flag = import.meta.env.VITE_SHOW_DEBUG;
  if (import.meta.env.PROD) return flag === "1";
  return flag !== "0";
}
