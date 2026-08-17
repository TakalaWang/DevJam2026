import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ItineraryIntent } from "../src/intent";
import { parseGeminiIntent } from "../src/intent";

const instruction = `你是行程規劃助理。從對話中抽取 JSON，不要輸出 Markdown。格式：
{"date":"YYYY-MM-DD","start":{"name":"地點","time":"HH:MM"},"stops":[{"name":"地點","time":"HH:MM","flexible":false,"durationMinutes":60}],"preference":"開車避開塞車"}
有明確抵達/會議/預約時間的 stop flexible=false；只有「想去、順路、途中」而沒有固定時間的 stop flexible=true。若使用者沒有明確說起點，start 請使用「台北車站」與「13:00」。不可捏造地點；不確定時保留使用者原文地點。`;

export async function extractIntent(apiKey: string, messages: Array<{ role: "user" | "assistant"; content: string }>): Promise<ItineraryIntent> {
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: "gemini-3.6-flash",
    systemInstruction: instruction,
    generationConfig: { responseMimeType: "application/json" },
  });
  const response = await model.generateContent({ contents: messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })) });
  return parseGeminiIntent(response.response.text());
}
