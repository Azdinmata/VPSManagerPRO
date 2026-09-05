import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

// Serves a QR PNG for TOTP provisioning URIs. Used during first-run 2FA
// enrollment only (kept in-memory; the token never hits logs).
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const data = url.searchParams.get("data") ?? "";
  if (!data.startsWith("otpauth://totp/")) {
    return new NextResponse("invalid", { status: 400 });
  }
  try {
    const png = await QRCode.toBuffer(data, { width: 360, margin: 2 });
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "Content-Length": String(png.length),
      },
    });
  } catch {
    return new NextResponse("error", { status: 500 });
  }
}