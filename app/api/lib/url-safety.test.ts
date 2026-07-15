import { describe, it, expect } from "vitest";
import { ssrfCheck, isPublicHttpUrl, isPrivateHost } from "./url-safety";

describe("url-safety (SSRF guard)", () => {
  it("allows public http(s) URLs", () => {
    expect(isPublicHttpUrl("https://github.com/org/repo")).toBe(true);
    expect(isPublicHttpUrl("http://export.arxiv.org/api/query?x=1")).toBe(true);
    expect(isPublicHttpUrl("https://8.8.8.8/dns")).toBe(true);
  });

  it("blocks loopback and localhost names", () => {
    expect(isPublicHttpUrl("http://127.0.0.1:3000/admin")).toBe(false);
    expect(isPublicHttpUrl("http://127.1/")).toBe(false);
    expect(isPublicHttpUrl("http://localhost/health")).toBe(false);
    expect(isPublicHttpUrl("http://foo.localhost/")).toBe(false);
    expect(isPublicHttpUrl("http://[::1]/")).toBe(false);
  });

  it("blocks private RFC1918 ranges", () => {
    expect(isPublicHttpUrl("http://10.0.0.5/")).toBe(false);
    expect(isPublicHttpUrl("http://172.16.0.1/")).toBe(false);
    expect(isPublicHttpUrl("http://172.31.255.255/")).toBe(false);
    expect(isPublicHttpUrl("http://192.168.1.1/router")).toBe(false);
  });

  it("blocks link-local / cloud metadata", () => {
    expect(isPublicHttpUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isPublicHttpUrl("http://169.254.0.1/")).toBe(false);
  });

  it("blocks CGNAT, this-host and IPv6 ULA", () => {
    expect(isPublicHttpUrl("http://100.64.0.1/")).toBe(false);
    expect(isPublicHttpUrl("http://0.0.0.0/")).toBe(false);
    expect(isPublicHttpUrl("http://[fd00::1]/")).toBe(false);
  });

  it("blocks non-http schemes and invalid URLs", () => {
    expect(ssrfCheck("file:///etc/passwd")).toMatch("scheme");
    expect(ssrfCheck("ftp://example.com/x")).toMatch("scheme");
    expect(ssrfCheck("not-a-url")).toBe("invalid URL");
  });

  it("normalizes decimal IPv4 obfuscation via WHATWG URL", () => {
    // 2130706433 == 127.0.0.1
    expect(isPublicHttpUrl("http://2130706433/")).toBe(false);
  });

  it("does not false-positive on public hosts containing blocked substrings", () => {
    expect(isPrivateHost("localhost.evil-example.com")).toBe(false);
    expect(isPrivateHost("172.32.0.1")).toBe(false); // just outside /12
    expect(isPrivateHost("news.ycombinator.com")).toBe(false);
  });
});
