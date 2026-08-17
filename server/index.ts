import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import dotenv from "dotenv";
import { parseIntentFallback } from "../src/intent";
import { optimizeItinerary } from "../src/planner";
import { demoRouteProvider, googleRouteProvider } from "./routes";
import { extractIntent } from "./gemini";

dotenv.config();
const app = express();
app.use(express.json());

app.post("/api/chat", async (request, response) => {
  const messages = request.body.messages as Array<{ role: "user" | "assistant"; content: string }>;
  if (!Array.isArray(messages) || !messages.length) return response.status(400).json({ error: "請輸入一段行程描述" });
  const key = process.env.GEMINI_API_KEY;
  let mode: "gemini" | "demo" = key ? "gemini" : "demo";
  let intent;
  try {
    intent = key ? await extractIntent(key, messages) : parseIntentFallback(messages.at(-1)?.content ?? "");
  } catch (error) {
    mode = "demo";
    intent = parseIntentFallback(messages.at(-1)?.content ?? "");
  }
  try {
    const provider = process.env.GOOGLE_MAPS_API_KEY && mode === "gemini" ? googleRouteProvider(process.env.GOOGLE_MAPS_API_KEY) : demoRouteProvider;
    const plan = await optimizeItinerary(intent, provider);
    const fixedNames = plan.stops.filter((stop) => stop.fixed).map((stop) => stop.name).join("、");
    const assistantMessage = mode === "gemini" ? `我已用 Gemini 解析你的需求，並用 Google 路況驗證。${plan.reason}\n固定行程：${fixedNames}` : `目前是 Demo mode：我先解析出行程骨架。${plan.reason}\n設定 GEMINI_API_KEY 後，我會改用自然語言理解。`;
    return response.json({ mode, assistantMessage, intent, plan });
  } catch (error) {
    return response.status(422).json({ error: error instanceof Error ? error.message : "無法安排這段行程" });
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.NODE_ENV === "production") app.use(express.static(path.resolve(__dirname, "../dist")));

app.listen(Number(process.env.PORT ?? 8787), () => console.log("Routecraft API listening on http://localhost:8787"));
