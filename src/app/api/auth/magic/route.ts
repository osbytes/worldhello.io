import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { magicTokens } from "@/db/schema";
import { newNonce, signNonce, MAGIC_TTL_MS } from "@/lib/token";
import { emailHash, hashKeyed } from "@/lib/crypto";
import { sendMail } from "@/lib/mailer";
import { logApiReject } from "@/lib/api-log";
import { admitMagic } from "@/lib/ratelimit";
import { clientIp } from "@/lib/geo";

export const runtime = "nodejs";

const Body = z.object({ email: z.string().email().max(254) });
const COOKIE = "wh_lid";

export async function POST(req: NextRequest) {
  const started = Date.now();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const localId = req.cookies.get(COOKIE)?.value;

  // Always run for a similar duration regardless of validity → no email/identity
  // enumeration via timing. Failures are silent; the response is always { ok: true }.
  if (parsed.success && localId) {
    const email = parsed.data.email;
    const hashed = emailHash(email);
    const ipHash = hashKeyed(clientIp(req.headers));

    const verdict = await admitMagic(ipHash, hashed);
    if (!verdict.ok) {
      logApiReject("auth/magic", "skipped", { reason: verdict.reason });
    } else {
      const nonce = newNonce();
      const token = signNonce(nonce);
      const expiresAt = new Date(Date.now() + MAGIC_TTL_MS);

      await db.insert(magicTokens).values({
        nonce,
        emailHash: hashed,
        localId,
        expiresAt,
      });

      const base = process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin;
      const link = `${base}/api/auth/verify?token=${encodeURIComponent(token)}`;

      await sendMail({
        to: email,
        subject: "Verify your worldhello.io account",
        html: `<p>Click below to verify your account on worldhello.io:</p><p><a href="${link}">Verify my account</a></p><p>Confirm on the same device that requested this email. This proves the network belongs to you — it is not for linking other devices. Expires in 30 minutes. If you didn't request this, ignore it.</p>`,
      }).catch((err) => {
        console.error("[auth/magic] send failed:", err);
      });
    }
  } else {
    logApiReject("auth/magic", "skipped", {
      bodyValid: parsed.success,
      hasCookie: !!localId,
    });
  }

  const elapsed = Date.now() - started;
  if (elapsed < 250) await new Promise((r) => setTimeout(r, 250 - elapsed));

  return NextResponse.json({ ok: true });
}
