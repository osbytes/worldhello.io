/**
 * Email sending with graceful fallback:
 *   1. Resend          — if RESEND_API_KEY is set (preferred in prod)
 *   2. SMTP/nodemailer — if SMTP_HOST is set (self-hosted / local Mailpit etc.)
 *   3. dev console      — otherwise, log the message (local dev only)
 */
import { isProduction } from "@/lib/env";

type Mail = { to: string; subject: string; html: string };

const FROM = process.env.EMAIL_FROM || "hello@worldhello.io";

export async function sendMail(mail: Mail): Promise<void> {
  if (process.env.RESEND_API_KEY) {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({ from: FROM, to: mail.to, subject: mail.subject, html: mail.html });
    return;
  }

  if (process.env.SMTP_HOST) {
    const nodemailer = (await import("nodemailer")).default;
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });
    await transport.sendMail({ from: FROM, to: mail.to, subject: mail.subject, html: mail.html });
    return;
  }

  if (isProduction()) {
    throw new Error("No email provider configured — set RESEND_API_KEY or SMTP_HOST in production");
  }

  console.log(`[mailer:dev] to=${mail.to} subject="${mail.subject}"`);
  console.log(`[mailer:dev] html:\n${mail.html}`);
}

export function mailerMode(): "resend" | "smtp" | "dev" {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.SMTP_HOST) return "smtp";
  return "dev";
}
