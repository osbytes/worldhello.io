import { describe, it, expect } from "vitest";
import { resolveClass } from "./classify";

const CHROME_UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36";
const HUMAN_CTX = { hasFingerprint: true, ephemeral: false };

describe("resolveClass", () => {
  it("classifies clean Chrome mobile as human", () => {
    const r = resolveClass({ ua: CHROME_UA }, HUMAN_CTX);
    expect(r.class).toBe("human");
    expect(r.baseRisk).toBe(0);
    expect(r.verdict).toBe("human");
  });

  it("hard-bots missing UA", () => {
    const r = resolveClass({ ua: null }, HUMAN_CTX);
    expect(r.class).toBe("bot");
    expect(r.verdict).toBe("no_ua");
  });

  it("hard-bots known crawler UA", () => {
    const r = resolveClass(
      { ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
      HUMAN_CTX,
    );
    expect(r.class).toBe("bot");
    expect(r.verdict).toBe("isbot_ua");
  });

  it("hard-bots when BotID and BotD both fire", () => {
    const r = resolveClass({ ua: CHROME_UA, botIdIsBot: true, botdDetected: true }, HUMAN_CTX);
    expect(r.class).toBe("bot");
    expect(r.verdict).toBe("botid+botd");
  });

  it("hard-bots lone detector without fingerprint", () => {
    const r = resolveClass(
      { ua: CHROME_UA, botdDetected: true },
      { hasFingerprint: false, ephemeral: false },
    );
    expect(r.class).toBe("bot");
    expect(r.verdict).toBe("botd_no_fp");
  });

  it("overrides lone BotD when fingerprint present (Brave-style)", () => {
    const r = resolveClass({ ua: CHROME_UA, botdDetected: true }, HUMAN_CTX);
    expect(r.class).toBe("human");
    expect(r.baseRisk).toBe(40);
    expect(r.verdict).toBe("botd_override:human");
  });

  it("overrides lone BotID on privacy browser with fingerprint", () => {
    const r = resolveClass(
      { ua: CHROME_UA, botIdIsBot: true },
      { ...HUMAN_CTX, privacyBrowser: true },
    );
    expect(r.class).toBe("human");
    expect(r.baseRisk).toBe(45);
    expect(r.verdict).toBe("botid_override:human");
  });

  it("does not override lone BotID without privacy browser hint", () => {
    const r = resolveClass({ ua: CHROME_UA, botIdIsBot: true }, HUMAN_CTX);
    expect(r.class).toBe("bot");
    expect(r.verdict).toBe("botid_only");
  });

  it("does not override BotD in incognito even with fingerprint", () => {
    const r = resolveClass(
      { ua: CHROME_UA, botdDetected: true },
      { hasFingerprint: true, ephemeral: true },
    );
    expect(r.class).toBe("bot");
    expect(r.verdict).toBe("botd_only");
  });
});
