"use client";

import { useEffect } from "react";
import { initBotId } from "botid/client/core";
import { useRegister, useMe } from "@/lib/queries";
import Header from "./sections/Header";
import Hero from "./sections/Hero";
import Network from "./sections/Network";
import ShareSection from "./sections/ShareSection";
import Footer from "./sections/Footer";

export default function App({ refCode }: { refCode: string | null }) {
  useEffect(() => {
    // BotID challenge only in production (its client init can fail in private
    // windows locally and block node creation).
    if (process.env.NODE_ENV === "production") {
      initBotId({ protect: [{ path: "/api/node", method: "POST" }] });
    }
  }, []);

  const { data: node } = useRegister(refCode);
  const { data: me } = useMe(node?.code);

  const fpLabel = node ? `fp_${node.code.slice(0, 6)}` : "fp_······";

  return (
    <>
      <Header fpLabel={fpLabel} />
      <Hero node={node ?? null} me={me ?? null} />
      <Network node={node ?? null} me={me ?? null} />
      {node && <ShareSection code={node.code} fpLabel={fpLabel} />}
      <Footer />
    </>
  );
}
