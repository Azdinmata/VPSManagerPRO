import { NextRequest } from "next/server";
import {
  disableDynamicBanner,
  installDynamicBanner,
  readBannerFile,
  readBannerState,
  updateStaticBanner,
} from "@/lib/banner";
import { audit } from "@/lib/audit";
import { guardMutation, guardRead, jsonErr, jsonOk } from "@/lib/req";

export async function GET(req: NextRequest) {
  const guard = guardRead(req);
  if ("status" in guard) return guard;

  const url = new URL(req.url);
  const user = url.searchParams.get("user");
  if (user) return jsonOk({ banner: readBannerFile(user) });

  return jsonOk({ state: readBannerState() });
}

export async function POST(req: NextRequest) {
  const guard = guardMutation(req);
  if ("status" in guard) return guard;

  const body = await req.json().catch(() => ({}));
  const { mode, entries, content } = body as {
    mode?: string;
    entries?: { user: string; text: string }[];
    content?: string;
  };

  if (mode === "dynamic") {
    // Merge with existing users so a partial update never drops banners.
    const existing = readBannerState().dynamicUsers;
    const merged: { user: string; text: string }[] = [...(entries ?? [])];
    for (const user of existing) {
      if (!merged.some((e) => e.user === user)) {
        merged.push({ user, text: readBannerFile(user) });
      }
    }
    const res = await installDynamicBanner(merged);
    if (!res.ok) return jsonErr(res.error ?? "install failed", 500);
    audit("admin", "banner_dynamic_install", undefined, JSON.stringify(merged.map((e) => e.user)));
    return jsonOk({ state: readBannerState() });
  }

  if (mode === "static") {
    const res = await updateStaticBanner(content ?? "");
    if (!res.ok) return jsonErr(res.error ?? "update failed", 500);
    audit("admin", "banner_static_update");
    return jsonOk({ state: readBannerState() });
  }

  return jsonErr("unknown mode");
}

export async function DELETE(req: NextRequest) {
  const guard = guardMutation(req);
  if ("status" in guard) return guard;

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  if (mode !== "dynamic") return jsonErr("only dynamic banner can be disabled");

  const res = await disableDynamicBanner();
  if (!res.ok) return jsonErr(res.error ?? "disable failed", 500);
  audit("admin", "banner_dynamic_disable");
  return jsonOk({ state: readBannerState() });
}