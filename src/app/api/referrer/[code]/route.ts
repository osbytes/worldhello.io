import { NextResponse } from "next/server";
import { z } from "zod";
import { referrerCard } from "@/db/reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Code = z.string().min(4).max(16);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  if (!Code.safeParse(code).success) {
    return NextResponse.json({ error: "bad_code" }, { status: 400 });
  }
  const card = await referrerCard(code);
  if (!card) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(card);
}
