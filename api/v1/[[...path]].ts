/** HTTPS edge → HTTP VPS (бэкенд без TLS). */
export const config = { runtime: "edge" };

const BACKEND = (process.env.BACKEND_ORIGIN ?? "http://103.74.92.49:8765").replace(/\/+$/, "");

function corsHeaders(origin: string | null): Record<string, string> {
  const o =
    origin &&
    (origin.endsWith(".vercel.app") ||
      origin.endsWith(".github.io") ||
      origin.includes("localhost") ||
      origin.includes("127.0.0.1"))
      ? origin
      : "*";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
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

export default async function handler(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const url = new URL(request.url);
  const target = `${BACKEND}${url.pathname}${url.search}`;

  const init: RequestInit = {
    method: request.method,
    headers: forwardHeaders(request.headers),
    redirect: "follow",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upstream error";
    return new Response(JSON.stringify({ detail: `VPS unreachable: ${msg}` }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  const headers = new Headers(upstream.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(upstream.body, { status: upstream.status, headers });
}
