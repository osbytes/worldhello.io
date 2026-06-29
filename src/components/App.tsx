"use client";

import { useEffect, useRef, useState } from "react";
import { initBotId } from "botid/client/core";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateAfterLinkChange, useRegister, useMe, acceptLinkFromUrl } from "@/lib/queries";
import {
  messageForVerifyFailure,
  type VerifyFailureReason,
} from "@/lib/verify-feedback";
import Header from "./sections/Header";
import Hero from "./sections/Hero";
import Network from "./sections/Network";
import ShareSection from "./sections/ShareSection";
import Footer from "./sections/Footer";

export default function App({
  refCode,
  linkCode = null,
  emailVerified = false,
  verifyFailureReason = null,
}: {
  refCode: string | null;
  linkCode?: string | null;
  emailVerified?: boolean;
  verifyFailureReason?: VerifyFailureReason | null;
}) {
  useEffect(() => {
    // BotID challenge only in production (its client init can fail in private
    // windows locally and block node creation).
    if (process.env.NODE_ENV === "production") {
      initBotId({ protect: [{ path: "/api/node", method: "POST" }] });
    }
  }, []);

  const queryClient = useQueryClient();
  const { data: node } = useRegister(refCode);
  const { data: me } = useMe(node?.code);
  const linkAttempted = useRef(false);
  const verifyAttempted = useRef(false);
  const [linkBanner, setLinkBanner] = useState<"linked" | "failed" | null>(null);
  const [verifyBanner, setVerifyBanner] = useState<"verified" | "failed" | null>(null);
  const verifyFailureMessage = verifyFailureReason
    ? messageForVerifyFailure(verifyFailureReason)
    : null;

  useEffect(() => {
    if (emailVerified) setVerifyBanner("verified");
    else if (verifyFailureReason) setVerifyBanner("failed");
  }, [emailVerified, verifyFailureReason]);

  useEffect(() => {
    if (!emailVerified || !node || verifyAttempted.current) return;
    verifyAttempted.current = true;
    invalidateAfterLinkChange(queryClient, node.code);
  }, [emailVerified, node, queryClient]);

  useEffect(() => {
    if (!emailVerified && !verifyFailureReason) return;
    const url = new URL(window.location.href);
    if (emailVerified) url.searchParams.delete("verified");
    if (verifyFailureReason) url.searchParams.delete("verify");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    if (verifyFailureReason) {
      document.getElementById("verify")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [emailVerified, verifyFailureReason]);

  useEffect(() => {
    if (!linkCode || !node || linkAttempted.current) return;
    linkAttempted.current = true;
    acceptLinkFromUrl(linkCode).then((ok) => {
      setLinkBanner(ok ? "linked" : "failed");
      if (ok && node.code) invalidateAfterLinkChange(queryClient, node.code);
    });
  }, [linkCode, node, queryClient]);

  const fpLabel = node ? `fp_${node.code.slice(0, 6)}` : "fp_······";

  return (
    <>
      {linkBanner === "linked" && (
        <div className="fixed inset-x-0 top-16 z-50 mx-auto w-full max-w-lg px-4">
          <p className="rounded-xl border border-purple/30 bg-purple/10 px-4 py-3 text-center text-sm text-purple">
            Devices linked — your network is synced.
          </p>
        </div>
      )}
      {linkBanner === "failed" && (
        <div className="fixed inset-x-0 top-16 z-50 mx-auto w-full max-w-lg px-4">
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-300">
            Link code invalid or expired. Generate a new one on your other device.
          </p>
        </div>
      )}
      {verifyBanner === "verified" && (
        <div className="fixed inset-x-0 top-16 z-50 mx-auto w-full max-w-lg px-4">
          <p className="rounded-xl border border-purple/30 bg-purple/10 px-4 py-3 text-center text-sm text-purple">
            Email verified — your account is confirmed on this device.
          </p>
        </div>
      )}
      {verifyBanner === "failed" && verifyFailureMessage && (
        <div className="fixed inset-x-0 top-16 z-50 mx-auto w-full max-w-lg px-4">
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-300">
            {verifyFailureMessage}
          </p>
        </div>
      )}
      <Header fpLabel={fpLabel} />
      <Hero node={node ?? null} me={me ?? null} />
      <Network node={node ?? null} me={me ?? null} />
      {node && <ShareSection code={node.code} fpLabel={fpLabel} />}
      <Footer />
    </>
  );
}
