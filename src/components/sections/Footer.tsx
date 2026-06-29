import Link from "next/link";
import { siteHost } from "@/lib/site";

export default function Footer() {
  const site = siteHost();
  return (
    <footer className="border-t border-white/5 px-6 py-10">
      <div className="mx-auto w-full max-w-6xl">
        {/* the one small nod to six degrees of separation */}
        <p className="mx-auto max-w-xl text-center text-sm text-muted">
          Built on the old idea that everyone alive is just{" "}
          <span className="text-purple">six handshakes</span> apart. Every link you share is one of them.
        </p>
        <div className="mt-8 flex flex-col items-center justify-between gap-4 text-sm text-muted sm:flex-row">
          <div className="flex items-center gap-4">
            {site ? <span>{site}</span> : null}
            <Link href="/about" className="hover:text-fg">
              About &amp; privacy
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <span className="label normal-case tracking-normal">
              No names. No pixels. Just the shape of connection.
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <a
              href="https://www.osbytes.io"
              target="_blank"
              rel="noopener noreferrer"
              title="osbytes — open source bytes"
              className="opacity-80 transition-opacity hover:opacity-100"
            >
              <img
                src="https://www.osbytes.io/badge.svg"
                alt="osbytes — open source bytes"
                width={32}
                height={32}
              />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
