/** Прокси /api/v1/* → VPS (Edge не принимает голый IP — BACKEND_ORIGIN через sslip.io). */
declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

export const config = {
  matcher: "/api/v1/:path*",
};

const ENV_BACKEND_ORIGIN = process?.env?.BACKEND_ORIGIN?.trim() || "";
/** Несколько имён и портов: Edge до VPS ходит нестабильно; прокси Vercel — обычно надёжнее. */
const BACKEND_CANDIDATES_RAW = [
  ENV_BACKEND_ORIGIN,
  "http://103-74-92-49.sslip.io:8000",
  "http://103-74-92-49.sslip.io:8765",
]
  .map((x) => x.replace(/\/+$/, ""))
  .filter(Boolean);
const seenBackends = new Set<string>();
const BACKEND_CANDIDATES = BACKEND_CANDIDATES_RAW.filter((b) => {
  if (seenBackends.has(b)) return false;
  seenBackends.add(b);
  return true;
});
const UPSTREAM_TIMEOUT_MS = 5_500;
const UPSTREAM_ATTEMPTS_PER_BACKEND = 1;
/** Короткий cooldown только для «битых» доменов; общий 25s загонял все origin в молчание. */
const UPSTREAM_COOLDOWN_BAD_MS = 45_000;
const UPSTREAM_COOLDOWN_SOFT_MS = 2500;
const upstreamCooldownUntil = new Map<string, number>();

function corsHeaders(origin: string | null): Record<string, string> {
  const o =
    origin &&
    (origin.endsWith(".vercel.app") ||
      origin.endsWith(".github.io") ||
      origin.includes("localhost") ||
      origin.includes("127.0.0.1") ||
      origin.includes("telegram.org") ||
      origin.endsWith(".t.me"))
      ? origin
      : "*";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
    "Access-Control-Allow-Headers": "Accept, Content-Type, X-Suteki-Client",
    "Access-Control-Max-Age": "86400",
  };
}

function forwardHeaders(incoming: Headers): Headers {
  const out = new Headers();
  incoming.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === "host" || k === "connection" || k === "content-length") return;
    out.set(key, value);
  });
  return out;
}

export default async function middleware(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const url = new URL(request.url);
  const init: RequestInit = {
    method: request.method,
    headers: forwardHeaders(request.headers),
    redirect: "follow",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  let acceptedUpstream: Response | null = null;
  let lastErr = "upstream error";
  const now = Date.now();
  const preferred = BACKEND_CANDIDATES.filter((backend) => (upstreamCooldownUntil.get(backend) || 0) <= now);
  const cooldownOnly = BACKEND_CANDIDATES.filter((backend) => (upstreamCooldownUntil.get(backend) || 0) > now);
  const orderedCandidates = preferred.length ? [...preferred, ...cooldownOnly] : BACKEND_CANDIDATES;
  for (const backend of orderedCandidates) {
    const target = `${backend}${url.pathname}${url.search}`;
    const attemptOnce = async (): Promise<Response | "fail"> => {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeoutId = setTimeout(() => ctrl?.abort(), UPSTREAM_TIMEOUT_MS);
      try {
        const res = await fetch(target, { ...init, signal: ctrl?.signal });
        const vercelErr = (res.headers.get("x-vercel-error") || "").toLowerCase();
        const isDeploymentMissing = vercelErr.includes("deployment_not_found");
        let isDirectIpBlocked = false;
        if (res.status === 403) {
          const textHint = (await res.clone().text().catch(() => "")).toLowerCase();
          isDirectIpBlocked = textHint.includes("direct ip access is not allowed");
        }
        /* 503 от VPS — это «Kodik unavailable for this title», legitimate ответ, не infra-сбой.
           Только 502/504 (gateway), deployment_not_found и direct_ip_blocked считаем retryable. */
        const isGatewayFailure = res.status === 502 || res.status === 504;
        const isRetryableStatus = isGatewayFailure || isDirectIpBlocked || isDeploymentMissing;
        if (isRetryableStatus) {
          const bad = isDeploymentMissing || isDirectIpBlocked;
          upstreamCooldownUntil.set(
            backend,
            Date.now() + (bad ? UPSTREAM_COOLDOWN_BAD_MS : UPSTREAM_COOLDOWN_SOFT_MS),
          );
          lastErr = `HTTP ${res.status}${isDeploymentMissing ? " deployment_not_found" : ""} (${backend})`;
          return "fail";
        }
        upstreamCooldownUntil.delete(backend);
        return res;
      } catch (e) {
        upstreamCooldownUntil.set(backend, Date.now() + UPSTREAM_COOLDOWN_SOFT_MS);
        if (e instanceof Error && e.name === "AbortError") {
          lastErr = `timeout ${Math.round(UPSTREAM_TIMEOUT_MS / 1000)}s (${backend})`;
        } else {
          const msg = e instanceof Error ? e.message : "fetch failed";
          lastErr = `${msg} (${backend})`;
        }
        return "fail";
      } finally {
        clearTimeout(timeoutId);
      }
    };

    for (let attempt = 0; attempt < UPSTREAM_ATTEMPTS_PER_BACKEND; attempt += 1) {
      const res = await attemptOnce();
      if (res !== "fail") {
        acceptedUpstream = res;
        break;
      }
    }
    if (acceptedUpstream) break;
  }
  if (!acceptedUpstream) {
    return new Response(JSON.stringify({ detail: "VPS temporarily unreachable. Please retry in a few seconds." }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  const headers = new Headers(acceptedUpstream.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(acceptedUpstream.body, { status: acceptedUpstream.status, headers });
}
