import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { magicTokens } from "@/db/schema";
import { newNonce, signNonce, MAGIC_TTL_MS } from "@/lib/token";
import { emailHash } from "@/lib/crypto";
import { sendMail } from "@/lib/mailer";

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
    const nonce = newNonce();
    const token = signNonce(nonce);
    const expiresAt = new Date(Date.now() + MAGIC_TTL_MS);

    await db.insert(magicTokens).values({
      nonce,
      emailHash: emailHash(email), // store hashed; raw email never persisted
      localId,
      expiresAt,
    });

    const base = process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin;
    const link = `${base}/api/auth/verify?token=${encodeURIComponent(token)}`;

    await sendMail({
      to: email,
      subject: "Link your worldhello.io network",
      html: `<p>Click to keep your network across devices:</p><p><a href="${link}">Verify &amp; link</a></p><p>Expires in 30 minutes. If you didn't request this, ignore it.</p>`,
    }).catch(() => {
      /* swallow — never reveal send success/failure to the caller */
    });
  }

  // Pad to a floor so the success/skip paths look alike to a timing attacker.
  const elapsed = Date.now() - started;
  if (elapsed < 250) await new Promise((r) => setTimeout(r, 250 - elapsed));

  return NextResponse.json({ ok: true });
}
