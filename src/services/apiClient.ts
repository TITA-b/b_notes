export async function apiRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (response.status === 204) return undefined as T;
  const result = (await response.json()) as { error?: string } & T;
  if (!response.ok) {
    throw new Error(result.error ?? `La solicitud falló (${response.status}).`);
  }
  return result;
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}
