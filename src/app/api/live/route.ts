import { subscribe } from "@/lib/live-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * SSE live-join stream. Subscribes to the shared broadcaster (one DB poll loop per
 * instance, not one per connection — see live-bus.ts / DESIGN §7).
 */
export async function GET(req: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      const unsub = subscribe((country) => send("join", { country }));

      // Keep-alive comment every 25s so proxies don't drop idle connections.
      const ping = setInterval(() => controller.enqueue(encoder.encode(`: ping\n\n`)), 25_000);

      const close = () => {
        clearInterval(ping);
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
