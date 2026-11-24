import { NextResponse } from "next/server";
import { getCurrentUser, type AuthenticatedUser } from "@/lib/auth";

export async function authenticateDataRequest(): Promise<
  { user: AuthenticatedUser; response?: never } | { user?: never; response: NextResponse }
> {
  const user = await getCurrentUser();
  return user
    ? { user }
    : {
        response: NextResponse.json({ error: "No autorizado." }, { status: 401 }),
      };
}

export function invalidRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 });
}
