/**
 * Node classification. DESIGN §2/§6: human | bot.
 * (bot collapses crawler/preview/automation — non-human nodes are excluded from
 *  metrics and dimmed/uncreated; we don't need to tell the sub-kinds apart.)
 *
 * Tiered: hard-bot signals always win; a single BotD/BotID flag with strong human
 * context (fingerprint + not incognito) stays human with elevated risk — privacy
 * browsers like Brave often trip lone client detectors.
 */
import { isbot } from "isbot";

export type NodeClass = "human" | "bot";

export type RawBotSignals = {
  ua: string | null;
  /** @fingerprintjs/botd client result: true if automation detected. */
  botdDetected?: boolean;
  /** Vercel BotID server verdict: true if classified a bot. */
  botIdIsBot?: boolean;
};

export type ClassifyContext = {
  hasFingerprint: boolean;
  ephemeral: boolean;
  /** Brave / other privacy-hardened browsers (client-reported). */
  privacyBrowser?: boolean;
};

export type ClassifyResult = {
  class: NodeClass;
  /** Detector-tier risk before ephemeral/fingerprint/IP modifiers (risk.ts). */
  baseRisk: number;
  reasons: string[];
  /** Compact audit string stored on node_signals.botid_verdict */
  verdict: string;
};

function hasHumanContext(ctx: ClassifyContext): boolean {
  return ctx.hasFingerprint && !ctx.ephemeral;
}

export function resolveClass(sig: RawBotSignals, ctx: ClassifyContext): ClassifyResult {
  const botId = !!sig.botIdIsBot;
  const botd = !!sig.botdDetected;

  if (!sig.ua) {
    return { class: "bot", baseRisk: 90, reasons: ["no_ua"], verdict: "no_ua" };
  }
  if (isbot(sig.ua)) {
    return { class: "bot", baseRisk: 80, reasons: ["isbot_ua"], verdict: "isbot_ua" };
  }

  if (botId && botd) {
    return { class: "bot", baseRisk: 85, reasons: ["botid_and_botd"], verdict: "botid+botd" };
  }

  if ((botId || botd) && !ctx.hasFingerprint) {
    const verdict = botId ? "botid_no_fp" : "botd_no_fp";
    return { class: "bot", baseRisk: 75, reasons: [verdict], verdict };
  }

  const humanCtx = hasHumanContext(ctx);

  if (botd && !botId && humanCtx) {
    return {
      class: "human",
      baseRisk: 40,
      reasons: ["botd_overridden"],
      verdict: "botd_override:human",
    };
  }

  if (botId && !botd && humanCtx && ctx.privacyBrowser) {
    return {
      class: "human",
      baseRisk: 45,
      reasons: ["botid_privacy_override"],
      verdict: "botid_override:human",
    };
  }

  if (botId || botd) {
    const verdict = botId ? "botid_only" : "botd_only";
    return { class: "bot", baseRisk: 70, reasons: [verdict], verdict };
  }

  return { class: "human", baseRisk: 0, reasons: [], verdict: "human" };
}

export function isHuman(c: NodeClass): boolean {
  return c === "human";
}
