import { cookies } from "next/headers";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";

export const SESSION_COOKIE_NAME = "bnotes_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;

export interface AuthenticatedUser {
  id: string;
  email: string;
}

function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET debe estar configurado con al menos 32 caracteres.");
  }
  return new TextEncoder().encode(secret);
}

export function assertAuthConfiguration(): void {
  getAuthSecret();
}

export async function createSessionToken(
  user: AuthenticatedUser
): Promise<string> {
  return new SignJWT({ userId: user.id, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getAuthSecret());
}

export async function verifySessionToken(
  token: string
): Promise<AuthenticatedUser | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    if (
      typeof payload.userId !== "string" ||
      typeof payload.email !== "string"
    ) {
      return null;
    }
    return { id: payload.userId, email: payload.email };
  } catch (error) {
    if (error instanceof joseErrors.JOSEError) return null;
    throw error;
  }
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return token ? verifySessionToken(token) : null;
}

export async function setSessionCookie(user: AuthenticatedUser): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, await createSessionToken(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE_NAME);
}
