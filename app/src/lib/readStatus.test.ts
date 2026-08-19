import { describe, expect, it } from "vitest";
import { shouldMarkRead } from "./readStatus";

describe("read status marking", () => {
  it("marks an authenticated, loaded detail exactly once per news id", () => {
    expect(shouldMarkRead(null, 42, true, true)).toBe(true);
    expect(shouldMarkRead(42, 42, true, true)).toBe(false);
    expect(shouldMarkRead(42, 42, true, true)).toBe(false);
  });

  it("does not mark before the article loads or for unauthenticated users", () => {
    expect(shouldMarkRead(null, 42, false, true)).toBe(false);
    expect(shouldMarkRead(null, 42, true, false)).toBe(false);
    expect(shouldMarkRead(null, Number.NaN, true, true)).toBe(false);
  });
});
