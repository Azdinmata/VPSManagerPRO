import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

// Serves a QR PNG for a V2Ray share link (trojan://, vless://, vmess://).
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const data = url.searchParams.get("link") ?? url.searchParams.get("data") ?? "";
  if (!/^(trojan|vless|vmess):\/\//.test(data)) {
    return new NextResponse("invalid", { status: 400 });
  }
  if (data.length > 2048) {
    return new NextResponse("too long", { status: 400 });
  }
  try {
    const png = await QRCode.toBuffer(data, { width: 360, margin: 2, errorCorrectionLevel: "M" });
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