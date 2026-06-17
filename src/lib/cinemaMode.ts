/** Cinema launch from bot: theater UI + auto fullscreen, no dub/episode panels. */

export function isCinemaLaunch(params: URLSearchParams, inTelegram: boolean): boolean {
  if (params.get("cinema") === "1") return true;
  return (
    inTelegram &&
    params.has("episode") &&
    Boolean(params.get("translation_id")?.trim())
  );
}
