import { createClient } from "@/lib/supabase/client";

export interface AiMessage {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  area: string | null;
  created_at: string;
}

async function getCurrentUserId(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw new Error(error.message);
  if (!user) throw new Error("No hay un usuario autenticado.");

  return user.id;
}

export async function getAiMessages(limit = 50): Promise<AiMessage[]> {
  const supabase = createClient();
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("ai_messages")
    .select("id, user_id, role, content, area, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []).reverse() as AiMessage[];
}

export async function saveAiMessage(
  role: "user" | "assistant",
  content: string,
  area?: string
): Promise<AiMessage> {
  const supabase = createClient();
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("ai_messages")
    .insert({ user_id: userId, role, content, area })
    .select("id, user_id, role, content, area, created_at")
    .single();

  if (error) throw new Error(error.message);
  return data as AiMessage;
}

export async function clearAiMessages(): Promise<void> {
  const supabase = createClient();
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from("ai_messages")
    .delete()
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}
