export function formatItineraryTime(value: string | undefined): string {
  if (!value) return "待討論";
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}
