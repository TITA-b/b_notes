import { apiRequest, jsonBody } from "@/services/apiClient";

export interface AiMessage {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  area: string | null;
  created_at: string;
}

export async function getAiMessages(limit = 50): Promise<AiMessage[]> {
  const messages = await apiRequest<AiMessage[]>(
    `/api/data/ai-messages?limit=${encodeURIComponent(String(limit))}`
  );
  return messages.reverse();
}

export async function saveAiMessage(
  role: "user" | "assistant",
  content: string,
  area?: string
): Promise<AiMessage> {
  return apiRequest<AiMessage>("/api/data/ai-messages", {
    method: "POST",
    body: jsonBody({ role, content, area }),
  });
}

export async function clearAiMessages(): Promise<void> {
  await apiRequest<void>("/api/data/ai-messages", { method: "DELETE" });
}
