import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: repositoryRoot })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

describe("public repository hygiene", () => {
  it("does not track environment files, private keys, logs, or databases", () => {
    const unsafeNames = trackedFiles().filter((path) =>
      /(^|\/)\.env$|\.pem$|\.key$|\.p12$|\.log$|\.sqlite3?$|\.db$/i.test(path),
    );
    expect(unsafeNames).toEqual([]);
  });

  it("does not contain production infrastructure or fixed credentials", () => {
    const forbidden = [
      ["159", "194", "236", "68"].join("."),
      "admin" + "123",
      ["science", "agent"].join("-") + ".ru",
      "/var/www/" + "news-agent",
    ];
    const offenders: string[] = [];

    for (const path of trackedFiles()) {
      const content = readFileSync(resolve(repositoryRoot, path), "utf8");
      if (forbidden.some((value) => content.includes(value))) offenders.push(path);
      if (/POSTGRES_PASSWORD:-postgres/.test(content)) offenders.push(path);
    }

    expect([...new Set(offenders)]).toEqual([]);
  });
});
