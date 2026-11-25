export async function readJsonResponse(
  response: Response
): Promise<Record<string, unknown>> {
  const rawText = await response.text();
  if (!rawText.trim()) {
    throw new Error(
      response.ok
        ? "El servidor devolvió una respuesta vacía."
        : `La solicitud falló sin detalles (HTTP ${response.status}).`
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawText);
  } catch {
    throw new Error(
      response.ok
        ? "El servidor devolvió una respuesta JSON no válida."
        : `El servidor devolvió una respuesta no válida (HTTP ${response.status}).`
    );
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("El servidor devolvió una respuesta JSON no válida.");
  }

  const result = payload as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : `No se pudo procesar la solicitud (HTTP ${response.status}).`
    );
  }
  return result;
}
