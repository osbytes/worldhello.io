import { NextRequest, NextResponse } from "next/server";
import { deviceLinkStatus } from "@/lib/account-link";

export const runtime = "nodejs";

const COOKIE = "wh_lid";

/** Cross-device link status for the current device. */
export async function GET(req: NextRequest) {
  const localId = req.cookies.get(COOKIE)?.value;
  if (!localId) {
    return NextResponse.json({ error: "no_device" }, { status: 401 });
  }

  const status = await deviceLinkStatus(localId);
  if (!status) {
    return NextResponse.json({ error: "device_missing" }, { status: 404 });
  }

  return NextResponse.json(status);
}
