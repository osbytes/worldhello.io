import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { magicTokens } from "@/db/schema";
import { newNonce, signNonce, MAGIC_TTL_MS } from "@/lib/token";
import { emailHash, hashKeyed } from "@/lib/crypto";
import { sendMail } from "@/lib/mailer";
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
    if (verdict.ok) {
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
        subject: "Link your worldhello.io network",
        html: `<p>Click to keep your network across devices:</p><p><a href="${link}">Verify &amp; link</a></p><p>You must confirm on the same device that requested this email. Expires in 30 minutes. If you didn't request this, ignore it.</p>`,
      }).catch((err) => {
        console.error("[auth/magic] send failed:", err);
      });
    }
  }

  const elapsed = Date.now() - started;
  if (elapsed < 250) await new Promise((r) => setTimeout(r, 250 - elapsed));

  return NextResponse.json({ ok: true });
}
