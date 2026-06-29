import { NextRequest, NextResponse } from "next/server";
import { unlinkDevice } from "@/lib/account-link";

export const runtime = "nodejs";

const COOKIE = "wh_lid";

/** Detach this device from its linked account. */
export async function POST(req: NextRequest) {
  const localId = req.cookies.get(COOKIE)?.value;
  if (!localId) {
    return NextResponse.json({ error: "no_device" }, { status: 401 });
  }

  const result = await unlinkDevice(localId);
  if (!result.ok) {
    const status = result.reason === "device_missing" ? 404 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ ok: true });
}
