"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { shareUrl, intentUrl, nativeShare, type Platform } from "@/lib/share";
import { LinkDevicesPanel, VerifyEmailPanel } from "./LinkDeviceSection";

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "x", label: "X" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "telegram", label: "Telegram" },
  { id: "facebook", label: "Facebook" },
];

export default function ShareSection({ code, fpLabel }: { code: string; fpLabel: string }) {
  const url = shareUrl(code);
  const display = url.replace(/^https?:\/\//, "");
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: "#c4b5fd", light: "#0a0a0f" } })
      .then(setQr)
      .catch(() => {});
  }, [url]);

  const copy = async () => {
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section id="share" className="mx-auto w-full max-w-6xl overflow-x-clip px-6 py-24">
      <h2 className="text-4xl font-bold tracking-tight">Share &amp; account</h2>
      <p className="mt-3 max-w-2xl text-muted">
        Three separate things: invite <span className="text-fg">other people</span> with your share
        link, <span className="text-fg">verify</span> your identity by email, or{" "}
        <span className="text-fg">link devices</span> you own to merge your view.
      </p>

      {/* ── Invite others (referral / viral) ── */}
      <div className="mt-10">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-purple/40 text-purple">
            ↗
          </span>
          <h3 className="text-lg font-semibold">Invite others</h3>
        </div>
        <p className="max-w-2xl text-sm text-muted">
          Your public referral link — send it to anyone. Each new visitor adds a node to your chain.
        </p>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <div className="card p-6">
            <div className="label text-purple">Your share link</div>
            <div className="mt-3 flex gap-3">
              <div className="flex min-w-0 flex-1 items-center overflow-hidden rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm">
                <span className="truncate">{display}</span>
              </div>
              <button onClick={copy} className="btn-primary shrink-0 px-6 py-3 text-sm">
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => nativeShare(url)} className="btn-ghost px-4 py-2 text-sm">
                Share…
              </button>
              {PLATFORMS.map((p) => (
                <a
                  key={p.id}
                  href={intentUrl(p.id, url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-ghost px-4 py-2 text-sm"
                >
                  {p.label}
                </a>
              ))}
            </div>
          </div>

          <div className="card flex flex-col items-center justify-center p-6">
            {qr && <img src={qr} alt="Share link QR" className="h-44 w-44 rounded-xl" />}
            <p className="label mt-4 text-purple">For others — scan to join your web</p>
          </div>
        </div>
      </div>

      <p className="label mt-10 normal-case tracking-normal text-muted/80">
        This device · <span className="font-mono text-purple">{fpLabel}</span> · powered by
        FingerprintJS
      </p>

      <VerifyEmailPanel />
      <LinkDevicesPanel nodeCode={code} />
    </section>
  );
}
