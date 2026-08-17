export type ItineraryStop = {
  time: string;
  title: string;
  detail: string;
  kind: "fixed" | "flexible";
};

export const itineraryStops: ItineraryStop[] = [
  { time: "14:00", title: "台北 101", detail: "會議", kind: "fixed" },
  { time: "15:20", title: "大稻埕", detail: "買茶", kind: "flexible" },
  { time: "18:30", title: "內湖科技園區", detail: "晚餐", kind: "fixed" },
];

export const routeSummary = {
  title: "台北・一日順路版",
  stops: itineraryStops.length,
  fixedStops: itineraryStops.filter((stop) => stop.kind === "fixed").length,
  status: "路況最佳化中",
  source: "Gemini + Google Routes",
} as const;
