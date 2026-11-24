import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getOAuthClient } from "@/lib/google";

export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const oauth2Client = getOAuthClient();

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/drive.file",
    ],
  });

  return NextResponse.redirect(url);
}