import { NextResponse } from "next/server";
import { leaderboard } from "@/db/reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await leaderboard(20);
  return NextResponse.json({ rows });
}
