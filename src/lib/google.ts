import { google } from "googleapis";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";

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

async function getAuthenticatedOAuthClient() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { rows } = await query<{
    access_token: string;
    refresh_token: string | null;
    expiry_date: string | number | null;
  }>(
    "SELECT access_token, refresh_token, expiry_date FROM google_tokens WHERE user_id = $1",
    [user.id]
  );
  const tokenRow = rows[0];
  if (!tokenRow) return null;

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token ?? undefined,
    expiry_date: tokenRow.expiry_date ? Number(tokenRow.expiry_date) : undefined,
  });

  oauth2Client.on("tokens", async (tokens) => {
    try {
      await query(
        `UPDATE google_tokens
         SET access_token = $1, refresh_token = $2, expiry_date = $3, updated_at = now()
         WHERE user_id = $4`,
        [
          tokens.access_token ?? tokenRow.access_token,
          tokens.refresh_token ?? tokenRow.refresh_token,
          tokens.expiry_date ?? tokenRow.expiry_date,
          user.id,
        ]
      );
    } catch (error) {
      console.error(
        "No se pudo guardar la renovación de credenciales de Google:",
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  return oauth2Client;
}

export async function getAuthenticatedCalendar() {
  const oauth2Client = await getAuthenticatedOAuthClient();
  return oauth2Client
    ? google.calendar({ version: "v3", auth: oauth2Client })
    : null;
}

export async function getAuthenticatedDrive() {
  const oauth2Client = await getAuthenticatedOAuthClient();
  return oauth2Client
    ? google.drive({ version: "v3", auth: oauth2Client })
    : null;
}