import { GoogleGenAI } from "@google/genai";

type InteractionEvent = {
  event_type: string;
  interaction?: { id: string };
  interaction_id?: string;
  delta?: { type: string; text?: string };
  error?: { message?: string };
};

export const GEMINI_MODEL = "gemini-3.6-flash";
export const CHAT_SYSTEM_INSTRUCTION =
  "你是 Routecraft，一個協助使用者規劃台灣旅遊的聊天助理。請使用繁體中文，先理解使用者的需求，再以自然、簡潔的方式回覆。這一版只負責對話，不要輸出 JSON。";

export function createGeminiStream(apiKey: string, message: string, interactionId?: string) {
  const ai = new GoogleGenAI({ apiKey });

  return ai.interactions.create({
    model: GEMINI_MODEL,
    input: message,
    ...(interactionId ? { previous_interaction_id: interactionId } : {}),
    system_instruction: CHAT_SYSTEM_INSTRUCTION,
    stream: true,
  });
}

export function interactionIdFrom(event: InteractionEvent): string | undefined {
  if (event.event_type === "interaction.created" || event.event_type === "interaction.completed") {
    return event.interaction?.id;
  }
  if (event.event_type === "interaction.status_update") return event.interaction_id;
  return undefined;
}

export function textFrom(event: InteractionEvent): string | undefined {
  return event.event_type === "step.delta" && event.delta?.type === "text"
    ? event.delta.text
    : undefined;
}

export function errorFrom(event: InteractionEvent): string | undefined {
  return event.event_type === "error" ? (event.error?.message ?? "Gemini 互動失敗") : undefined;
}
