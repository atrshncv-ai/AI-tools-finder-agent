import type { CookieOptions } from "hono/utils/cookie";

/**
 * Browsers silently drop `Secure` cookies delivered over plain HTTP, and
 * `SameSite=None` REQUIRES `Secure`. The dashboard is currently served over
 * HTTP (http://<ip>:3000), so these flags must follow the actual request
 * scheme — not the hostname. TLS termination (nginx) signals HTTPS via the
 * standard X-Forwarded-Proto header.
 */
function isHttpsRequest(headers: Headers): boolean {
  const proto = headers.get("x-forwarded-proto");
  return proto?.split(",")[0].trim().toLowerCase() === "https";
}

export function getSessionCookieOptions(headers: Headers): CookieOptions {
  const https = isHttpsRequest(headers);

  return {
    httpOnly: true,
    path: "/",
    sameSite: https ? "none" : "lax",
    secure: https,
  };
}
