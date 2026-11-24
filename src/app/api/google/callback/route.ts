import { NextResponse, type NextRequest } from "next/server";
import { getOAuthClient } from "@/lib/google";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const baseUrl = request.nextUrl.origin;

  if (!code) {
    return NextResponse.redirect(`${baseUrl}/?google_error=missing_code`);
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(`${baseUrl}/login`);
  }

  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);

  await query(
    `INSERT INTO google_tokens (user_id, access_token, refresh_token, expiry_date, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, google_tokens.refresh_token),
       expiry_date = EXCLUDED.expiry_date,
       updated_at = now()`,
    [
      user.id,
      tokens.access_token ?? "",
      tokens.refresh_token ?? null,
      tokens.expiry_date ?? null,
    ]
  );

  return NextResponse.redirect(`${baseUrl}/`);
}