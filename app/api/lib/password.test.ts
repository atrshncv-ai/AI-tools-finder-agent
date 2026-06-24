import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";

describe("password hashing", () => {
  it("hashes and verifies a password", async () => {
    const password = "secure-password-123";
    const hash = await bcrypt.hash(password, 12);

    expect(hash).not.toBe(password);
    expect(await bcrypt.compare(password, hash)).toBe(true);
    expect(await bcrypt.compare("wrong-password", hash)).toBe(false);
  });
});
