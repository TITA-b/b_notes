import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const target = new URL("/", request.url);
  try {
    const form = await request.formData();
    const sharedFile = form.get("share_file");
    if (sharedFile && typeof sharedFile !== "string" && sharedFile.size > 0) {
      target.searchParams.set("share_error", "service_worker");
    } else {
      for (const [field, parameter] of [
        ["share_title", "share_title"],
        ["share_text", "share_text"],
        ["share_url", "share_url"],
      ]) {
        const value = form.get(field);
        if (typeof value === "string" && value.trim()) {
          target.searchParams.set(parameter, value.trim().slice(0, 10000));
        }
      }
    }
  } catch {
    target.searchParams.set("share_error", "service_worker");
  }
  return NextResponse.redirect(target, 303);
}
