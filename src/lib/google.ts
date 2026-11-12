import { google } from "googleapis";
import { createClient } from "@/lib/supabase/server";

export function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/google/callback";

  if (!clientId || !clientSecret) {
    throw new Error("Faltan GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET en .env.local");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function getAuthenticatedCalendar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: tokenRow } = await supabase
    .from("google_tokens")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!tokenRow) return null;

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token ?? undefined,
    expiry_date: tokenRow.expiry_date ?? undefined,
  });

  // Si Google renueva el token automáticamente, lo actualizamos en Supabase
  oauth2Client.on("tokens", async (tokens) => {
    await supabase
      .from("google_tokens")
      .update({
        access_token: tokens.access_token ?? tokenRow.access_token,
        refresh_token: tokens.refresh_token ?? tokenRow.refresh_token,
        expiry_date: tokens.expiry_date ?? tokenRow.expiry_date,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);
  });

  return google.calendar({ version: "v3", auth: oauth2Client });
}