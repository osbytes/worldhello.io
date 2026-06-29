/** Share intents per platform. DESIGN §8. */

import { siteBaseUrl, siteHost } from "@/lib/site";

function clientOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

export function shareUrl(code: string): string {
  return `${siteBaseUrl(clientOrigin())}/${code}`;
}

export function shareBlurb(): string {
  const host = siteHost(clientOrigin());
  return `I just joined the chain on ${host} — see how far our connection travels 🌍`;
}

export type Platform = "x" | "whatsapp" | "telegram" | "facebook" | "linkedin";

export function intentUrl(platform: Platform, url: string): string {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(shareBlurb());
  switch (platform) {
    case "x":
      return `https://twitter.com/intent/tweet?text=${t}&url=${u}`;
    case "whatsapp":
      return `https://wa.me/?text=${t}%20${u}`;
    case "telegram":
      return `https://t.me/share/url?url=${u}&text=${t}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
  }
}

export async function nativeShare(url: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title: siteHost(clientOrigin()), text: shareBlurb(), url });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
