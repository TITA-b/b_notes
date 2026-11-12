import { NextResponse, type NextRequest } from "next/server";
import { getOAuthClient } from "@/lib/google";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const baseUrl = request.nextUrl.origin;

  if (!code) {
    return NextResponse.redirect(`${baseUrl}/?google_error=missing_code`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${baseUrl}/login`);
  }

  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);

  const { error: dbError } = await supabase.from("google_tokens").upsert(
    {
      user_id: user.id,
      access_token: tokens.access_token ?? "",
      refresh_token: tokens.refresh_token ?? null,
      expiry_date: tokens.expiry_date ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (dbError) {
    return NextResponse.redirect(
      `${baseUrl}/?google_error=${encodeURIComponent(dbError.message)}`
    );
  }

  return NextResponse.redirect(`${baseUrl}/`);
}