/**
 * Node classification. DESIGN §2/§6: human | bot.
 * (bot collapses crawler/preview/automation — non-human nodes are excluded from
 *  metrics and dimmed/uncreated; we don't need to tell the sub-kinds apart.)
 *
 * Layered, cheapest → strongest, stronger overrides weaker:
 *   1. isbot(ua)            — maintained UA cull (cheap, runs first)
 *   2. botd verdict         — client headless/automation signal (Puppeteer/etc.)
 *   3. Vercel BotID verdict — authoritative server signal, immune to UA spoofing
 */
import { isbot } from "isbot";

export type NodeClass = "human" | "bot";

/** Verdicts gathered from stronger detectors (any true ⇒ bot). */
export type BotSignals = {
  ua: string | null;
  /** @fingerprintjs/botd client result: true if automation detected. */
  botdDetected?: boolean;
  /** Vercel BotID server verdict: true if classified a bot. */
  botIdIsBot?: boolean;
};

export function classify(sig: BotSignals): NodeClass {
  if (sig.botIdIsBot) return "bot"; // authoritative
  if (sig.botdDetected) return "bot";
  if (!sig.ua) return "bot"; // no UA = scripted
  if (isbot(sig.ua)) return "bot";
  return "human";
}

export function isHuman(c: NodeClass): boolean {
  return c === "human";
}
