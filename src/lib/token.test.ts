import { describe, it, expect, vi, beforeEach } from "vitest";

describe("token", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("APP_SECRET", "unit-test-secret-key-minimum-length");
    vi.resetModules();
  });

  it("round-trips a signed nonce", async () => {
    const { signNonce, verifyNonce, newNonce } = await import("./token");
    const nonce = newNonce();
    const token = signNonce(nonce);
    expect(verifyNonce(token)).toBe(nonce);
  });

  it("rejects tampered tokens", async () => {
    const { signNonce, verifyNonce, newNonce } = await import("./token");
    const token = signNonce(newNonce());
    expect(verifyNonce(token + "x")).toBeNull();
    expect(verifyNonce("not-a-valid-token")).toBeNull();
  });
});
