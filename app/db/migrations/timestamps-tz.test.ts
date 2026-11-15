/**
 * Migration 0012 — every timestamp column becomes `timestamp with time zone`.
 *
 * Why the test exists: the legacy columns mixed two conventions (UTC wall
 * clock from JS `Date`, Moscow wall clock from `defaultNow()`), so a blanket
 * `SET DATA TYPE timestamp with time zone` silently picks the session TimeZone
 * and keeps the 3-hour shift. The migration must therefore pin the zone per
 * column, and the only way to keep that honest is to assert the zone of every
 * column here.
 *
 * Three layers:
 *   1. the journal / snapshot / SQL stay consistent (runs everywhere);
 *   2. the zone conversion restores the real event order (runs everywhere);
 *   3. the migration really applies to Postgres, on a clean database and on a
 *      database with legacy rows (runs when TEST_DATABASE_URL is set:
 *      `TEST_DATABASE_URL=postgresql://user:pass@host:5432/db npx vitest run
 *      db/migrations/timestamps-tz.test.ts`).
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "@db/schema";

const MIGRATIONS_DIR = import.meta.dirname;
const TARGET = "0012_timestamps_tz";

/** Columns written by JS `Date` were stored as UTC wall clock. */
const UTC_COLUMNS = new Set([
  "publishedAt",
  "platformPublishedAt",
  "digestArchiveSentAt",
  "readAt",
  "lastRun",
  "lastCheck",
  "lastSuccess",
  "startedAt",
  "completedAt",
  "lastVerifiedAt",
  "lastSignInAt",
]);

/** Columns written by `defaultNow()` were stored as Moscow wall clock. */
const MOSCOW_COLUMNS = new Set(["createdAt", "updatedAt"]);

function expectedZone(column: string): string {
  if (UTC_COLUMNS.has(column)) return "UTC";
  if (MOSCOW_COLUMNS.has(column)) return "Europe/Moscow";
  throw new Error(`no conversion rule for column ${column}`);
}

interface Statement {
  raw: string;
  sql: string;
}

function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function readStatements(file: string): Statement[] {
  return fs
    .readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8")
    .split("--> statement-breakpoint")
    .map((chunk) => chunk.trim())
    .filter((raw) => raw.length > 0 && raw !== "--")
    .map((raw) => ({
      raw,
      sql: raw
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    }));
}

const CONVERT =
  /^ALTER TABLE "(\w+)" ALTER COLUMN "(\w+)" SET DATA TYPE timestamp with time zone USING "(\w+)" AT TIME ZONE '([\w/]+)';?$/;

/** column key `table.column` → zone pinned by the migration. */
function conversionZones(): Map<string, string> {
  const zones = new Map<string, string>();
  for (const statement of readStatements(`${TARGET}.sql`)) {
    const match = CONVERT.exec(statement.sql);
    if (!match) continue;
    const [, table, column, used, zone] = match;
    // `USING` must read the column being converted.
    expect(used).toBe(column);
    zones.set(`${table}.${column}`, zone);
  }
  return zones;
}

function timestampColumnsOfSnapshot(snapshot: string): Map<string, string> {
  const data = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, "meta", snapshot), "utf-8")) as {
    tables: Record<string, { columns: Record<string, { type: string }> }>;
  };
  const columns = new Map<string, string>();
  for (const [table, definition] of Object.entries(data.tables)) {
    for (const [column, meta] of Object.entries(definition.columns)) {
      if (meta.type.startsWith("timestamp")) {
        columns.set(`${table.replace(/^public\./, "")}.${column}`, meta.type);
      }
    }
  }
  return columns;
}

/**
 * `timestamp without time zone` value interpreted as a wall clock in `zone`,
 * i.e. what `AT TIME ZONE zone` does. Implemented through ICU so a hardcoded
 * +03:00 could never pass.
 */
function naiveAtZone(naive: string, zone: string): Date {
  const wallClock = Date.parse(`${naive.replace(" ", "T")}Z`);

  const offsetMs = (instant: number): number => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(instant));
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
    const asUtc = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour") % 24,
      part("minute"),
      part("second"),
    );
    return asUtc - instant;
  };

  const firstGuess = wallClock - offsetMs(wallClock);
  return new Date(wallClock - offsetMs(firstGuess));
}

describe(`migration ${TARGET}`, () => {
  it("is registered in the journal after 0011", () => {
    const journal = JSON.parse(
      fs.readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf-8"),
    ) as { entries: { idx: number; tag: string }[] };
    const entry = journal.entries.find((item) => item.tag.startsWith("0012"));
    expect(entry).toBeDefined();
    expect(entry!.idx).toBe(11 + 1);
    expect(entry!.tag).toBe(TARGET);
    expect(journal.entries.at(-1)!.tag).toBe(TARGET);
  });

  it("converts every timestamp column with an explicit zone and nothing else", () => {
    const statements = readStatements(`${TARGET}.sql`);
    expect(statements.length).toBeGreaterThan(0);

    // No statement may convert a column without `USING ... AT TIME ZONE`:
    // that is exactly the form Postgres resolves through the session TimeZone.
    for (const statement of statements) {
      expect(statement.sql).toMatch(CONVERT);
    }

    const zones = conversionZones();
    const snapshotColumns = timestampColumnsOfSnapshot("0012_snapshot.json");

    expect([...zones.keys()].sort()).toEqual([...snapshotColumns.keys()].sort());
    expect(zones.size).toBe(27);

    for (const [key, zone] of zones) {
      const column = key.split(".")[1];
      expect({ key, zone }).toEqual({ key, zone: expectedZone(column) });
    }
  });

  it("leaves the Drizzle snapshot with time-zone-aware timestamps only", () => {
    const after = timestampColumnsOfSnapshot("0012_snapshot.json");
    const before = timestampColumnsOfSnapshot("0011_snapshot.json");
    expect(before.size).toBe(after.size);
    for (const type of before.values()) expect(type).toBe("timestamp");
    for (const [key, type] of after) {
      expect({ key, type }).toEqual({ key, type: "timestamp with time zone" });
    }
  });

  it("keeps the Drizzle schema in sync: every timestamp column is `withTimezone`", () => {
    const tables = Object.values(schema).filter((value) => is(value, PgTable)) as PgTable[];
    expect(tables.length).toBe(11);

    const columns: string[] = [];
    for (const table of tables) {
      const tableColumns = getTableColumns(table) as unknown as Record<
        string,
        { columnType: string; dataType: string; withTimezone?: boolean }
      >;
      for (const [name, column] of Object.entries(tableColumns)) {
        if (column.columnType !== "PgTimestamp") continue;
        columns.push(`${getTableName(table)}.${name}`);
        expect({ column: name, withTimezone: column.withTimezone }).toEqual({
          column: name,
          withTimezone: true,
        });
        // `mode: "date"` keeps handing JS `Date` objects to the application.
        expect({ column: name, dataType: column.dataType }).toEqual({
          column: name,
          dataType: "date",
        });
      }
    }

    expect(columns.sort()).toEqual([...conversionZones().keys()].sort());
  });

  it("restores the real event order: publication later than creation", () => {
    const zones = conversionZones();
    const createdAtZone = zones.get("news.createdAt")!;
    const publishedAtZone = zones.get("news.platformPublishedAt")!;

    // Legacy card from the report: created 17:33 Moscow wall clock
    // (= 14:33Z), published at 14:36Z stored as UTC wall clock 14:36.
    const createdAt = naiveAtZone("2026-11-14 17:33:00", createdAtZone);
    const platformPublishedAt = naiveAtZone("2026-11-14 14:36:00", publishedAtZone);

    expect(createdAt.toISOString()).toBe("2026-11-14T14:33:00.000Z");
    expect(platformPublishedAt.toISOString()).toBe("2026-11-14T14:36:00.000Z");

    // Real sequence: publication 3 minutes after creation — the gap is
    // positive in the direction of the events.
    expect(platformPublishedAt.getTime() - createdAt.getTime()).toBe(3 * 60_000);
    expect(createdAt.getTime()).toBeLessThan(platformPublishedAt.getTime());

    // The reported artifact: comparing both naive columns as if they were the
    // same base said "created 2h57m after publication".
    const artifact =
      Date.parse("2026-11-14T17:33:00Z") - Date.parse("2026-11-14T14:36:00Z");
    expect(artifact).toBe((2 * 60 + 57) * 60_000);
  });

  it("uses the Moscow offset of the date, not a hardcoded +03:00 in summer", () => {
    const zone = conversionZones().get("news.createdAt")!;
    expect(naiveAtZone("2026-07-01 15:00:00", zone).toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(naiveAtZone("2026-01-15 15:00:00", zone).toISOString()).toBe("2026-01-15T12:00:00.000Z");
  });
});

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("migration 0012 against a real Postgres", () => {
  async function withTempSchema(run: (sql: postgres.Sql, schemaName: string) => Promise<void>) {
    const admin = postgres(TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    const schemaName = `tz_migration_test_${process.pid}_${Date.now().toString(36)}`;
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`);
    const sql = postgres(TEST_DATABASE_URL!, {
      max: 1,
      connection: { search_path: schemaName },
    });
    try {
      await run(sql, schemaName);
    } finally {
      await sql.end({ timeout: 5 });
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.end({ timeout: 5 });
    }
  }

  async function apply(sql: postgres.Sql, files: string[]) {
    for (const file of files) {
      for (const statement of readStatements(file)) await sql.unsafe(statement.raw);
    }
  }

  async function timestampColumns(sql: postgres.Sql, schemaName: string) {
    return sql<{ table_name: string; column_name: string; data_type: string }[]>`
      select table_name, column_name, data_type
      from information_schema.columns
      where table_schema = ${schemaName} and data_type like 'timestamp%'
      order by table_name, column_name`;
  }

  it(
    "applies to a clean database and stores instants, not wall clocks",
    async () => {
      await withTempSchema(async (sql, schemaName) => {
        await apply(sql, migrationFiles());

        const columns = await timestampColumns(sql, schemaName);
        expect(columns).toHaveLength(27);
        expect(columns.filter((column) => column.data_type !== "timestamp with time zone")).toEqual(
          [],
        );

        const publishedAt = new Date("2026-11-14T14:36:00.000Z");
        await sql`insert into news (title, summary, "originalUrl", source, "publishedAt", "platformPublishedAt")
                  values ('t', 's', 'https://example.com/clean', 'src', ${publishedAt}, ${publishedAt})`;
        const [row] = await sql<{ publishedAt: Date; platformPublishedAt: Date }[]>`
          select "publishedAt", "platformPublishedAt" from news`;
        expect(row.publishedAt.toISOString()).toBe(publishedAt.toISOString());
        expect(row.platformPublishedAt.toISOString()).toBe(publishedAt.toISOString());

        // `defaultNow()` now records the real instant regardless of the
        // session TimeZone (the test container runs TZ=Europe/Moscow).
        await sql`insert into categories (name, slug) values ('c', 'c')`;
        const [skew] = await sql<{ seconds: number }[]>`
          select extract(epoch from (now() - "createdAt"))::float8 as seconds from categories`;
        expect(Math.abs(skew.seconds)).toBeLessThan(5);
      });
    },
    120_000,
  );

  it(
    "converts a database with legacy rows without keeping the 3-hour shift",
    async () => {
      await withTempSchema(async (sql, schemaName) => {
        const before = migrationFiles().filter((file) => file < TARGET);
        await apply(sql, before);

        // Legacy card: created 17:33 Moscow wall clock, published at 14:36Z
        // stored as UTC wall clock. Also a summer card, so a hardcoded offset
        // would fail.
        await sql`insert into news (title, summary, "originalUrl", source, "publishedAt", "platformPublishedAt", "createdAt", "updatedAt", "digestArchiveSentAt")
                  values ('t', 's', 'https://example.com/legacy', 'src',
                          '2026-11-14 14:33:00', '2026-11-14 14:36:00',
                          '2026-11-14 17:33:00', '2026-11-14 17:35:00', '2026-11-14 14:40:00')`;
        await sql`insert into news (title, summary, "originalUrl", source, "publishedAt", "platformPublishedAt", "createdAt", "updatedAt")
                  values ('t2', 's2', 'https://example.com/summer', 'src',
                          '2026-07-01 12:00:00', '2026-07-01 12:05:00',
                          '2026-07-01 15:00:00', '2026-07-01 15:00:00')`;

        const [artifact] = await sql<{ seconds: number }[]>`
          select extract(epoch from ("createdAt" - "platformPublishedAt"))::float8 as seconds
          from news where "originalUrl" = 'https://example.com/legacy'`;
        expect(artifact.seconds).toBeCloseTo((2 * 60 + 57) * 60, 6);

        await apply(sql, [`${TARGET}.sql`]);

        const columns = await timestampColumns(sql, schemaName);
        expect(columns.filter((column) => column.data_type !== "timestamp with time zone")).toEqual(
          [],
        );

        const [card] = await sql<
          { createdAt: Date; updatedAt: Date; platformPublishedAt: Date; publishedAt: Date }[]
        >`select "createdAt", "updatedAt", "platformPublishedAt", "publishedAt"
            from news where "originalUrl" = 'https://example.com/legacy'`;
        expect(card.createdAt.toISOString()).toBe("2026-11-14T14:33:00.000Z");
        expect(card.updatedAt.toISOString()).toBe("2026-11-14T14:35:00.000Z");
        expect(card.publishedAt.toISOString()).toBe("2026-11-14T14:33:00.000Z");
        expect(card.platformPublishedAt.toISOString()).toBe("2026-11-14T14:36:00.000Z");

        // Publication is later than creation again, by the real 3 minutes.
        const [gap] = await sql<{ seconds: number }[]>`
          select extract(epoch from ("platformPublishedAt" - "createdAt"))::float8 as seconds
          from news where "originalUrl" = 'https://example.com/legacy'`;
        expect(gap.seconds).toBeCloseTo(180, 6);
        expect(card.platformPublishedAt.getTime()).toBeGreaterThan(card.createdAt.getTime());

        const [summer] = await sql<{ createdAt: Date; platformPublishedAt: Date }[]>`
          select "createdAt", "platformPublishedAt" from news
          where "originalUrl" = 'https://example.com/summer'`;
        expect(summer.createdAt.toISOString()).toBe("2026-07-01T12:00:00.000Z");
        expect(summer.platformPublishedAt.toISOString()).toBe("2026-07-01T12:05:00.000Z");

        // The digest window compares through bound parameters: a 14:38Z cutoff
        // no longer catches a card published at 14:36Z.
        const [afterCutoff] = await sql<{ n: number }[]>`
          select count(*)::int as n from news
          where coalesce("platformPublishedAt", "updatedAt") >= ${"2026-11-14T14:38:00.000Z"}::timestamptz
            and "originalUrl" = 'https://example.com/legacy'`;
        const [beforeCutoff] = await sql<{ n: number }[]>`
          select count(*)::int as n from news
          where coalesce("platformPublishedAt", "updatedAt") >= ${"2026-11-14T14:30:00.000Z"}::timestamptz
            and "originalUrl" = 'https://example.com/legacy'`;
        expect(afterCutoff.n).toBe(0);
        expect(beforeCutoff.n).toBe(1);
      });
    },
    120_000,
  );
});
