"use client";

import { useEffect, useRef, useState } from "react";
import { initBotId } from "botid/client/core";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateAfterLinkChange, useRegister, useMe, acceptLinkFromUrl } from "@/lib/queries";
import Header from "./sections/Header";
import Hero from "./sections/Hero";
import Network from "./sections/Network";
import ShareSection from "./sections/ShareSection";
import Footer from "./sections/Footer";

export default function App({
  refCode,
  linkCode = null,
  emailVerified = false,
}: {
  refCode: string | null;
  linkCode?: string | null;
  emailVerified?: boolean;
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

  useEffect(() => {
    if (!emailVerified || !node || verifyAttempted.current) return;
    verifyAttempted.current = true;
    invalidateAfterLinkChange(queryClient, node.code);
    const url = new URL(window.location.href);
    url.searchParams.delete("verified");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }, [emailVerified, node, queryClient]);

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
      <Header fpLabel={fpLabel} />
      <Hero node={node ?? null} me={me ?? null} />
      <Network node={node ?? null} me={me ?? null} />
      {node && <ShareSection code={node.code} fpLabel={fpLabel} />}
      <Footer />
    </>
  );
}
