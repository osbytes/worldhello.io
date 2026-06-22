/** Share intents per platform. DESIGN §8. */

export function shareUrl(code: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/${code}`;
}

const TEXT = "I just joined the chain on worldhello.io — see how far our connection travels 🌍";

export type Platform = "x" | "whatsapp" | "telegram" | "facebook" | "linkedin";

export function intentUrl(platform: Platform, url: string): string {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(TEXT);
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
      await navigator.share({ title: "worldhello.io", text: TEXT, url });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
