import { NextResponse } from "next/server";
import { globeData } from "@/db/reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Globe is read off this snapshot — write-side floods never degrade it (DESIGN §6.5 L4).
export async function GET() {
  const data = await globeData(2000);
  return NextResponse.json(data, {
    headers: { "cache-control": "public, s-maxage=10, stale-while-revalidate=30" },
  });
}
