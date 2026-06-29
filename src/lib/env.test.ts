import { describe, it, expect, afterEach, vi } from "vitest";
import { validateProductionEnv, hasRedis, hasEmailProvider } from "./env";

describe("env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("skips validation in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "");
    expect(() => validateProductionEnv()).not.toThrow();
  });

  it("throws in production when required vars are missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("APP_SECRET", "");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");

    expect(() => validateProductionEnv()).toThrow(/Production environment validation failed/);
  });

  it("passes when all production vars are set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("DATABASE_URL", "postgres://localhost/test");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    vi.stubEnv("APP_SECRET", "test-secret-32-chars-minimum!!!!");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://worldhello.io");

    expect(() => validateProductionEnv()).not.toThrow();
    expect(hasRedis()).toBe(true);
    expect(hasEmailProvider()).toBe(true);
  });

  it("honors SKIP_ENV_VALIDATION", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SKIP_ENV_VALIDATION", "1");
    vi.stubEnv("DATABASE_URL", "");
    expect(() => validateProductionEnv()).not.toThrow();
  });
});
