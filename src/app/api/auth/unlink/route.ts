import { NextRequest, NextResponse } from "next/server";
import { unlinkDevice } from "@/lib/account-link";
import { logApiReject } from "@/lib/api-log";

export const runtime = "nodejs";

const COOKIE = "wh_lid";

/** Detach this device from its linked account. */
export async function POST(req: NextRequest) {
  const localId = req.cookies.get(COOKIE)?.value;
  if (!localId) {
    logApiReject("auth/unlink", "no_device", { hasCookie: false });
    return NextResponse.json({ error: "no_device" }, { status: 401 });
  }

  const result = await unlinkDevice(localId);
  if (!result.ok) {
    const status = result.reason === "device_missing" ? 404 : 400;
    logApiReject("auth/unlink", result.reason);
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ ok: true });
}
