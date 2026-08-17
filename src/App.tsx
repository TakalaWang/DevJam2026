import { FormEvent, useEffect, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import type { ItineraryIntent } from "./intent";
import type { OptimizedItinerary } from "./planner";
import { decodePolyline, pointFor } from "./map";
import "leaflet/dist/leaflet.css";
import "./styles.css";

type ChatMessage = { role: "user" | "assistant"; content: string };
type ApiResponse = { mode: "gemini" | "demo"; assistantMessage: string; intent: ItineraryIntent; plan: OptimizedItinerary };

const starter: ChatMessage = { role: "assistant", content: "告訴我今天想去哪裡、哪些事情有固定時間，以及你想怎麼移動。自然說就好，例如：\n\n「下午兩點到 101 開會，傍晚去內湖吃飯，途中想去大稻埕買茶，開車但不要塞車。」" };

function FitMap({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => { if (points.length > 1) map.fitBounds(points, { padding: [28, 28] }); }, [map, points]);
  return null;
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分` : `${minutes} 分鐘`;
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([starter]);
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || loading) return;
    const nextMessages = [...messages, { role: "user" as const, content }];
    setMessages(nextMessages);
    setDraft("");
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: nextMessages }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "行程解析失敗");
      setMessages([...nextMessages, { role: "assistant", content: data.assistantMessage }]);
      setResult(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "暫時無法連線");
    } finally { setLoading(false); }
  }

  const mapPoints = result?.plan ? result.plan.stops.map((stop) => pointFor(stop.name)) : [pointFor("台北車站")];

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">⌁</span><span>ROUTECRAFT</span><small>避塞車行程 Agent</small></div>
        <div className={`mode-pill ${result?.mode === "gemini" ? "live" : "demo"}`}><i />{result?.mode === "gemini" ? "GEMINI LIVE" : "DEMO MODE"}</div>
      </header>
      <section className="workspace">
        <aside className="chat-panel">
          <div className="panel-intro"><p className="eyebrow">01 / CONVERSATION</p><h1>把今天交給<br /><em>路線感知。</em></h1><p className="subcopy">說出你的行程，我會鎖住重要約會，再用即時路況排出順路版本。</p></div>
          <div className="chat-log">
            {messages.map((message, index) => <div className={`message ${message.role}`} key={`${message.role}-${index}`}><span className="message-label">{message.role === "assistant" ? "ROUTECRAFT" : "YOU"}</span><p>{message.content}</p></div>)}
            {loading && <div className="message assistant loading"><span className="message-label">ROUTECRAFT</span><p><span className="pulse" />正在讀取你的時間與路況…</p></div>}
          </div>
          <form className="chat-composer" onSubmit={sendMessage}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="像聊天一樣描述你的行程…" rows={3} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(event); } }} /><div className="composer-footer"><span>Enter 傳送 · Shift + Enter 換行</span><button type="submit" aria-label="傳送">↗</button></div></form>
          {error && <p className="error-text">{error}</p>}
        </aside>
        <section className="plan-panel">
          <div className="plan-header"><div><p className="eyebrow">02 / LIVING ITINERARY</p><h2>{result ? "你的避塞車版本" : "你的行程會出現在這裡"}</h2></div>{result && <span className="route-count">{result.plan.stops.length - 1} 段路線</span>}</div>
          {result ? <>
            <div className="reason-banner"><span className="spark">✦</span><span>{result.plan.reason}</span></div>
            <div className="timeline">{result.plan.stops.map((stop, index) => <div className={`timeline-row ${stop.fixed ? "fixed" : "flexible"}`} key={`${stop.name}-${index}`}><div className="time-col">{stop.arrivalTime}<span>{index === 0 ? "出發" : stop.fixed ? "固定" : "彈性"}</span></div><div className="node-col"><span className="node" /><span className="rail" /></div><div className="stop-card"><div><strong>{stop.name}</strong><p>{stop.fixed ? "已鎖定的時間點" : "依路況安排的順路景點"}</p></div>{stop.leaveBy && index > 0 && <span className="leave-by">最晚 {stop.leaveBy} 出發</span>}</div></div>)}</div>
            <div className="map-wrap"><div className="map-label"><span>ROUTE OVERVIEW</span><span>● traffic-aware</span></div><MapContainer center={mapPoints[0]} zoom={12} scrollWheelZoom className="map"><TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />{result.plan.stops.map((stop, index) => <Marker position={pointFor(stop.name)} key={`${stop.name}-marker-${index}`} />)}{result.plan.routes.map((route, index) => { const points = decodePolyline(route.encodedPolyline); const line = points.length ? points : [pointFor(route.origin), pointFor(route.destination)]; const congested = route.trafficSeconds > route.normalSeconds * 1.2; return <Polyline key={`${route.origin}-${route.destination}`} positions={line} pathOptions={{ color: congested ? "#f2ae63" : "#71e0c0", weight: 5, opacity: 0.9 }} />; })}<FitMap points={mapPoints} /></MapContainer><div className="map-stats">{result.plan.routes.map((route) => <div key={`${route.origin}-${route.destination}`}><span>{route.origin} → {route.destination}</span><strong>{formatDuration(route.trafficSeconds)}</strong><small>{formatDistance(route.distanceMeters)}</small></div>)}</div></div>
          </> : <div className="empty-plan"><div className="empty-orbit">⌁</div><p>還沒有路線。</p><span>左側先告訴我你的目的地和約會時間，地圖會跟著你的對話長出來。</span></div>}
        </section>
      </section>
    </main>
  );
}

export default App;
