class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

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
  let result: { error?: string } & T;
  try {
    result = (await response.json()) as { error?: string } & T;
  } catch (error) {
    if (!response.ok) {
      throw new ApiRequestError(
        `La solicitud falló (${response.status}).`,
        response.status
      );
    }
    throw error;
  }
  if (!response.ok) {
    throw new ApiRequestError(
      result.error ?? `La solicitud falló (${response.status}).`,
      response.status
    );
  }
  return result;
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}
