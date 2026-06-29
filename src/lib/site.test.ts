import { describe, it, expect, afterEach, vi } from "vitest";
import { siteBaseUrl, siteHost } from "./site";

describe("site", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads base URL from env", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://example.com");
    expect(siteBaseUrl()).toBe("https://example.com");
    expect(siteHost()).toBe("example.com");
  });

  it("falls back when env is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    expect(siteBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(siteHost("http://localhost:3000")).toBe("localhost:3000");
  });
});
