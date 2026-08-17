export type StopIntent = {
  name: string;
  time?: string;
  flexible: boolean;
  durationMinutes?: number;
};

export type ItineraryIntent = {
  date: string;
  start: { name: string; time: string };
  stops: StopIntent[];
  preference: string;
};

const PLACE_ALIASES: Record<string, string> = {
  "台北101": "台北 101",
  "台北 101": "台北 101",
  "101": "台北 101",
  "大稻埕": "大稻埕",
  "內湖": "內湖科技園區",
  "內科": "內湖科技園區",
  "內湖科技園區": "內湖科技園區",
  "台北車站": "台北車站",
};

const CHINESE_DIGITS: Record<string, number> = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function numberIn(text: string): number | undefined {
  if (/^\d+$/.test(text)) return Number(text);
  if (text === "十") return 10;
  if (text.startsWith("十")) return 10 + (CHINESE_DIGITS[text[1]] ?? 0);
  if (text.endsWith("十")) return (CHINESE_DIGITS[text[0]] ?? 0) * 10;
  if (text.length === 2) return (CHINESE_DIGITS[text[0]] ?? 0) * 10 + (CHINESE_DIGITS[text[1]] ?? 0);
  return CHINESE_DIGITS[text];
}

function parseTime(text: string): string | undefined {
  const matches = [...text.matchAll(/(上午|早上|中午|下午|傍晚|晚上)?\s*([0-9一二兩三四五六七八九十]{1,3})(?:[:：]([0-9]{2})|點半|點(?:\s*([0-9一二兩三四五六七八九十]{1,3})分?)?)/g)];
  const match = matches.at(-1);
  if (!match) return undefined;
  const rawHour = numberIn(match[2]);
  if (rawHour === undefined) return undefined;
  const minute = match[3] ? Number(match[3]) : match[0].includes("半") ? 30 : match[4] ? numberIn(match[4]) ?? 0 : 0;
  let hour = rawHour;
  if (["下午", "傍晚", "晚上"].includes(match[1] ?? "") && hour < 12) hour += 12;
  if (match[1] === "中午" && hour < 11) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseIntentFallback(message: string): ItineraryIntent {
  const places = Object.keys(PLACE_ALIASES).sort((a, b) => b.length - a.length);
  const found = new Map<string, number>();
  for (const alias of places) {
    const position = message.indexOf(alias);
    if (position >= 0 && !found.has(PLACE_ALIASES[alias])) found.set(PLACE_ALIASES[alias], position);
  }
  const positions = [...found.values()].sort((a, b) => a - b);
  const stops = [...found.entries()].map(([name, position]) => {
    const previous = positions.filter((candidate) => candidate < position).at(-1) ?? 0;
    const nearby = message.slice(previous, position);
    const time = parseTime(nearby);
    return { name, time, flexible: !time };
  });
  const timed = stops.filter((stop) => stop.time);
  const start = { name: "台北車站", time: timed[0]?.time ? "13:00" : "13:00" };
  return {
    date: new Date().toISOString().slice(0, 10),
    start,
    stops: stops.filter((stop) => stop.name !== start.name),
    preference: /大眾運輸|捷運|公車/.test(message) ? "優先大眾運輸，避開壅塞" : /開車|駕車/.test(message) ? "開車避開塞車" : "避開塞車",
  };
}

export function parseGeminiIntent(text: string): ItineraryIntent {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(cleaned) as ItineraryIntent;
  if (!parsed.start?.name || !Array.isArray(parsed.stops)) throw new Error("Gemini 回傳的行程格式不完整");
  return {
    date: parsed.date ?? new Date().toISOString().slice(0, 10),
    start: { name: parsed.start.name, time: parsed.start.time ?? "13:00" },
    stops: parsed.stops.map((stop) => ({ ...stop, ...(typeof stop.time === "string" ? { time: stop.time } : { time: undefined }), flexible: typeof stop.flexible === "boolean" ? stop.flexible : !stop.time })),
    preference: parsed.preference ?? "避開塞車",
  };
}
