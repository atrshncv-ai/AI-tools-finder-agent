/**
 * url-safety.ts — SSRF guard for outbound fetches.
 *
 * Every external URL (from RSS feeds, GitHub/HN APIs, DB rows) MUST pass
 * ssrfCheck() before fetch(): a feed owner could otherwise smuggle in a
 * link to loopback / cloud metadata (169.254.169.254) / LAN services.
 *
 * WHATWG URL parsing normalizes decimal/hex/octal IPv4 notations
 * (e.g. http://2130706433/ -> 127.0.0.1), so literal-IP tricks are covered.
 * Residual limitation: DNS-rebinding (public hostname resolving to a
 * private IP) is out of scope — sources are curated feeds, not user input.
 */

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);

const BLOCKED_SUFFIXES = [".localhost", ".internal", ".local", ".lan"];

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = nums;
  return (
    a === 0 || // 0.0.0.0/8 "this host"
    a === 10 || // 10.0.0.0/8 private
    a === 127 || // 127.0.0.0/8 loopback
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
    (a === 192 && b === 168) || // 192.168.0.0/16 private
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local (cloud metadata)
    (a === 100 && b >= 64 && b <= 127) // 100.64.0.0/10 CGNAT
  );
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    h === "::" ||
    h === "::1" || // loopback
    h.startsWith("fe80:") || // fe80::/10 link-local
    h.startsWith("fc") || // fc00::/7 unique-local (fc.. / fd..)
    h.startsWith("fd")
  );
}

export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (BLOCKED_SUFFIXES.some((s) => h.endsWith(s))) return true;
  if (h.includes(":")) return isPrivateIpv6(h);
  return isPrivateIpv4(h);
}

/**
 * Returns null when the URL is safe to fetch, otherwise a human-readable
 * reason. Usage: `const blocked = ssrfCheck(url); if (blocked) ...`
 */
export function ssrfCheck(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return "invalid URL";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return `scheme not allowed: ${u.protocol}`;
  }
  if (isPrivateHost(u.hostname)) {
    return `private/internal host blocked: ${u.hostname}`;
  }
  return null;
}

export function isPublicHttpUrl(rawUrl: string): boolean {
  return ssrfCheck(rawUrl) === null;
}
