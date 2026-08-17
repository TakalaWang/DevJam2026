"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiErrorResponseSchema,
  DayItineraryListResponseSchema,
  DayItineraryResponseSchema,
  DeleteDayItineraryResponseSchema,
  type ConversationRun,
  type DayItinerarySnapshot,
  type DayItinerarySummary,
  type ItineraryNotification,
  type PlanningField,
  type RoutePoint,
} from "../contracts";
import { routaAssistantLabel, routaBrand, routaSubtitle } from "../lib/brand";
import { composerKeyAction } from "../lib/composer";
import { assessPlanningReadiness } from "../lib/itinerary/readiness";
import {
  hasGoogleMapsKey,
  loadGoogleMaps,
  type GoogleLatLngLiteral,
  type GoogleMapInstance,
  type GoogleMarkerInstance,
  type GooglePolylineInstance,
} from "../lib/google-maps";

type ChatMessage = { id: number; role: "assistant" | "user"; content: string };
type DemoScenario = "flood" | "road_closure" | "station_disruption" | "bike_unavailable";

const userId = "local-demo-user";
const sessionStorageKey = "routecraft.local-day-plan";
const starter: ChatMessage = {
  id: 0,
  role: "assistant",
  content:
    "先告訴我今天想去哪裡、哪些活動有固定時間，以及你從哪裡出發、最後要不要回家。我會把出門到回家的交通過程一起排進去。",
};

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(value: string | undefined): string {
  if (!value) return "待討論";
  return new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return "待計算";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes} 分鐘` : `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分鐘`;
}

function modeLabel(profile: string | undefined): string {
  return profile === "bike" ? "YouBike" : profile === "foot" ? "步行" : "開車";
}

function statusLabel(status: DayItinerarySnapshot["status"]): string {
  return status === "discussing"
    ? "討論中"
    : status === "ready"
      ? "可以出發"
      : status === "active"
        ? "執行中"
        : status === "update_pending"
          ? "等待確認"
          : "已完成";
}

const planningFieldLabels: Record<PlanningField, string> = {
  origin: "出發位置",
  destinations: "想去的地點",
  departure_at: "出門時間",
  end_at: "結束／回家時間",
  fixed_activities: "固定時間的活動",
  transport_preference: "交通偏好",
  return_plan: "回程安排",
  constraints: "其他限制",
  user_confirmation: "你的確認",
};

function planningPhaseLabel(phase: DayItinerarySnapshot["planningPhase"]): string {
  return phase === "collecting"
    ? "先了解你的需求"
    : phase === "awaiting_confirmation"
      ? "等待你確認需求"
      : phase === "scheduling"
        ? "正在建立完整行程"
        : "可以繼續微調行程";
}

function summaryFromSnapshot(snapshot: DayItinerarySnapshot): DayItinerarySummary {
  return {
    id: snapshot.id,
    userId: snapshot.userId,
    status: snapshot.status,
    revision: snapshot.revision,
    date: snapshot.date,
    stopCount: snapshot.stops.length,
    updatedAt: snapshot.updatedAt,
  };
}

function messagesFromRuns(runs: ConversationRun[]): ChatMessage[] {
  const messages: ChatMessage[] = [starter];
  for (const run of runs) {
    if (run.userMessage.startsWith("system:")) continue;
    messages.push({ id: messages.length, role: "user", content: run.userMessage });
    if (run.output?.message) {
      messages.push({ id: messages.length, role: "assistant", content: run.output.message });
    }
  }
  return messages;
}

async function readError(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch(() => null);
  const parsed = ApiErrorResponseSchema.safeParse(payload);
  return new Error(parsed.success ? parsed.data.error : fallback);
}

async function getHistory(): Promise<DayItinerarySummary[]> {
  const response = await fetch(`/api/day-plans?userId=${encodeURIComponent(userId)}`);
  if (!response.ok) throw await readError(response, "無法讀取行程紀錄");
  return DayItineraryListResponseSchema.parse(await response.json()).itineraries;
}

async function getPlan(id: string) {
  const response = await fetch(`/api/day-plans/${id}`);
  if (!response.ok) throw await readError(response, "找不到這個行程");
  return DayItineraryResponseSchema.parse(await response.json());
}

async function postPlan(path: string, body?: object) {
  const response = await fetch(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw await readError(response, "行程服務暫時無法使用");
  return DayItineraryResponseSchema.parse(await response.json());
}

function mapPosition(point: RoutePoint, points: RoutePoint[]): [number, number] {
  const longitudes = points.map((item) => item.coordinate.longitude);
  const latitudes = points.map((item) => item.coordinate.latitude);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const x =
    maxLongitude === minLongitude
      ? 200
      : 24 + ((point.coordinate.longitude - minLongitude) / (maxLongitude - minLongitude)) * 352;
  const y =
    maxLatitude === minLatitude
      ? 140
      : 24 + ((maxLatitude - point.coordinate.latitude) / (maxLatitude - minLatitude)) * 232;
  return [x, y];
}

function SvgRouteMap({
  snapshot,
  caption = "Google Routes",
}: {
  snapshot: DayItinerarySnapshot;
  caption?: string;
}) {
  const points = useMemo(() => {
    const stops = snapshot.stops.map((stop) => stop.location);
    return snapshot.origin ? [snapshot.origin, ...stops] : stops;
  }, [snapshot.origin, snapshot.stops]);
  const coordinates = snapshot.legs.flatMap((leg) => leg.route?.coordinates ?? []);
  const routePoints = coordinates.map((coordinate) => ({ label: "route", coordinate }));
  const drawablePoints = routePoints.length ? routePoints : points;
  const routePath = drawablePoints
    .map((point, index) => {
      const [x, y] = mapPosition(point, points);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  const isNavigating = snapshot.status === "active";

  return (
    <div
      className={`route-map ${isNavigating ? "is-navigating" : ""}`}
      aria-label={isNavigating ? "導航中的一日行程路線圖" : "完整一日行程路線圖"}
      role="img"
    >
      <div className="map-grid" aria-hidden="true" />
      <svg viewBox="0 0 400 280" aria-hidden="true">
        {routePath && <path className="map-route" d={routePath} id="svg-route-path" />}
        {isNavigating && routePath && (
          <g className="map-traveler">
            <circle className="map-traveler-halo" r="13" />
            <circle className="map-traveler-dot" r="7" />
            <path d="M -2 -1 L 5 0 L 0 5 Z" />
            <animateMotion dur="5.5s" repeatCount="indefinite" rotate="auto">
              <mpath href="#svg-route-path" />
            </animateMotion>
          </g>
        )}
        {points.map((point, index) => {
          const [x, y] = mapPosition(point, points);
          return (
            <circle
              className={index === 0 ? "map-stop origin" : "map-stop"}
              cx={x}
              cy={y}
              key={`${point.label}-${index}`}
              r={index === 0 ? 8 : 6}
            />
          );
        })}
      </svg>
      {isNavigating && (
        <div className="map-navigation-badge">
          <span className="status-dot" /> 導航中
        </div>
      )}
      <div className="map-caption">
        <span className="status-dot" /> {caption} · {snapshot.legs.length} 段交通
      </div>
    </div>
  );
}

function RouteMap({ snapshot }: { snapshot: DayItinerarySnapshot }) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const overlaysRef = useRef<{
    markers: GoogleMarkerInstance[];
    polyline?: GooglePolylineInstance;
  } | null>(null);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [mapError, setMapError] = useState("");
  const points = useMemo(() => {
    const stops = snapshot.stops.map((stop) => stop.location);
    return snapshot.origin ? [snapshot.origin, ...stops] : stops;
  }, [snapshot.origin, snapshot.stops]);
  const routeCoordinates = useMemo(
    () => snapshot.legs.flatMap((leg) => leg.route?.coordinates ?? []),
    [snapshot.legs],
  );

  useEffect(() => {
    let disposed = false;
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!hasGoogleMapsKey(apiKey) || !mapElementRef.current || points.length === 0) {
      setMapStatus("fallback");
      return () => {
        disposed = true;
      };
    }

    setMapStatus("loading");
    setMapError("");
    void loadGoogleMaps(apiKey)
      .then((maps) => {
        if (disposed || !mapElementRef.current) return;

        overlaysRef.current?.polyline?.setMap(null);
        overlaysRef.current?.markers.forEach((marker) => marker.setMap(null));

        const map =
          mapRef.current ??
          new maps.Map(mapElementRef.current, {
            center: { lat: points[0].coordinate.latitude, lng: points[0].coordinate.longitude },
            zoom: 12,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            clickableIcons: false,
            gestureHandling: "greedy",
          });
        const bounds = new maps.LatLngBounds();
        const path = routeCoordinates.map<GoogleLatLngLiteral>((coordinate) => ({
          lat: coordinate.latitude,
          lng: coordinate.longitude,
        }));
        path.forEach((point) => bounds.extend(point));
        points.forEach((point) =>
          bounds.extend({ lat: point.coordinate.latitude, lng: point.coordinate.longitude }),
        );

        const polyline =
          path.length >= 2
            ? new maps.Polyline({
                map,
                path,
                geodesic: true,
                strokeColor: "#dd775a",
                strokeOpacity: 0.92,
                strokeWeight: 5,
              })
            : undefined;
        const markers = points.map(
          (point) =>
            new maps.Marker({
              map,
              position: { lat: point.coordinate.latitude, lng: point.coordinate.longitude },
              title: point.label,
            }),
        );
        map.fitBounds(bounds, 44);
        mapRef.current = map;
        overlaysRef.current = { markers, ...(polyline ? { polyline } : {}) };
        setMapStatus("ready");
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setMapError(error instanceof Error ? error.message : "Google Maps 載入失敗");
        setMapStatus("fallback");
      });

    return () => {
      disposed = true;
    };
  }, [points, routeCoordinates]);

  if (mapStatus === "fallback") {
    return (
      <div className="map-fallback-wrap">
        <SvgRouteMap snapshot={snapshot} caption="Google Routes · 示意圖" />
        {mapError && <p className="map-fallback-note">{mapError}</p>}
      </div>
    );
  }

  return (
    <div
      className={`route-map google-route-map ${snapshot.status === "active" ? "is-navigating" : ""}`}
      aria-label={
        snapshot.status === "active"
          ? "Google Maps 導航中的一日行程路線圖"
          : "Google Maps 一日行程路線圖"
      }
      role="img"
    >
      <div className="google-map-canvas" ref={mapElementRef} />
      {mapStatus === "loading" && <div className="map-loading">正在載入 Google Maps…</div>}
      {snapshot.status === "active" && (
        <div className="map-navigation-badge">
          <span className="status-dot" /> 導航中
        </div>
      )}
      <div className="map-caption">
        <span className="status-dot" /> Google Maps · {snapshot.legs.length} 段交通
      </div>
    </div>
  );
}

function LegLine({
  leg,
  active = false,
}: {
  leg: DayItinerarySnapshot["legs"][number];
  active?: boolean;
}) {
  return (
    <div className={`leg-line ${leg.status} ${active ? "current" : ""}`}>
      <span>↳</span>
      <strong>{leg.status === "blocked" ? "路段受阻" : modeLabel(leg.route?.profile)}</strong>
      <span>
        {leg.status === "blocked" ? leg.reason : formatDuration(leg.route?.durationSeconds)}
      </span>
    </div>
  );
}

function activeNavigation(snapshot: DayItinerarySnapshot) {
  if (snapshot.status !== "active") return undefined;
  const leg = snapshot.legs.find((candidate) => candidate.status === "active");
  if (!leg) return undefined;
  const destination = snapshot.stops.find((stop) => stop.id === leg.toStopId);
  return { leg, destination };
}

function NavigationStatus({ snapshot }: { snapshot: DayItinerarySnapshot }) {
  const navigation = activeNavigation(snapshot);
  if (!navigation) return null;
  const from =
    navigation.leg.fromStopId === "origin"
      ? snapshot.origin?.label
      : snapshot.stops.find((stop) => stop.id === navigation.leg.fromStopId)?.title;

  return (
    <section className="navigation-status" aria-label="目前導航狀態">
      <div className="navigation-heading">
        <div>
          <span className="navigation-live">
            <span className="status-dot" /> 正在導航
          </span>
          <strong>前往 {navigation.destination?.title ?? "下一站"}</strong>
        </div>
        <span className="navigation-mode">{modeLabel(navigation.leg.route?.profile)}</span>
      </div>
      <div className="navigation-track" aria-hidden="true">
        <span className="navigation-track-start" />
        <span className="navigation-track-line">
          <span className="navigation-track-progress" />
        </span>
        <span className="navigation-traveler" />
        <span className="navigation-track-end" />
      </div>
      <div className="navigation-details">
        <span>{from ?? "目前位置"}</span>
        <strong>約 {formatDuration(navigation.leg.route?.durationSeconds)}</strong>
        <span>{navigation.destination?.location.label ?? "下一站"}</span>
      </div>
    </section>
  );
}

function StopTimeline({ snapshot }: { snapshot: DayItinerarySnapshot }) {
  const returnLeg = snapshot.legs.at(-1)?.toStopId === "home" ? snapshot.legs.at(-1) : undefined;
  const activityLegs = returnLeg ? snapshot.legs.slice(0, -1) : snapshot.legs;
  const navigation = activeNavigation(snapshot);
  return (
    <div className="timeline">
      {snapshot.origin && (
        <div className="timeline-row origin-row">
          <span className="timeline-dot origin" />
          <div className="timeline-copy">
            <small>出發</small>
            <strong>{snapshot.origin.label}</strong>
          </div>
        </div>
      )}
      {snapshot.stops.map((stop, index) => (
        <div className="timeline-group" key={stop.id}>
          {activityLegs[index] && (
            <LegLine leg={activityLegs[index]} active={activityLegs[index].status === "active"} />
          )}
          <div
            aria-current={stop.id === snapshot.currentStopId ? "step" : undefined}
            className={`timeline-row ${stop.id === snapshot.currentStopId ? "current" : ""}`}
          >
            <span className={`timeline-dot ${stop.constraint} ${stop.status}`} />
            <div className="timeline-copy">
              <small>
                {stop.constraint === "fixed" ? "固定活動" : "可調整"} ·{" "}
                {formatTime(stop.timeWindow?.startAt)}
              </small>
              <strong>{stop.title}</strong>
              <span>{stop.location.label}</span>
            </div>
            <span className={`constraint ${stop.constraint}`}>
              {stop.id === navigation?.leg.toStopId
                ? "NEXT"
                : stop.constraint === "fixed"
                  ? "FIXED"
                  : "FLEX"}
            </span>
          </div>
        </div>
      ))}
      {returnLeg && snapshot.origin && (
        <div className="timeline-group return-group">
          <LegLine leg={returnLeg} active={returnLeg.status === "active"} />
          <div className="timeline-row">
            <span className="timeline-dot origin" />
            <div className="timeline-copy">
              <small>結束行程</small>
              <strong>回到 {snapshot.origin.label}</strong>
              <span>所有行程完成後返回起點</span>
            </div>
            <span className="constraint home">HOME</span>
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationCard({ notification }: { notification: ItineraryNotification }) {
  return (
    <section className={`notification-card ${notification.severity}`}>
      <div className="notification-kicker">
        <span className="status-dot" /> 城市狀況更新
      </div>
      <h3>{notification.title}</h3>
      <p>{notification.message}</p>
      <small>已更新受影響路段與後續交通安排</small>
    </section>
  );
}

export default function Page() {
  const [history, setHistory] = useState<DayItinerarySummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [itinerary, setItinerary] = useState<DayItinerarySnapshot>();
  const [messages, setMessages] = useState<ChatMessage[]>([starter]);
  const [draft, setDraft] = useState("");
  const [planDate, setPlanDate] = useState(todayDate);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState("");
  const [demoScenario, setDemoScenario] = useState<DemoScenario>("flood");
  const [latestNotification, setLatestNotification] = useState<ItineraryNotification>();
  const nextMessageId = useRef(1);
  const isComposingRef = useRef(false);

  function applySnapshot(snapshot: DayItinerarySnapshot) {
    setItinerary(snapshot);
    setPlanDate(snapshot.date);
    setHistory((current) => {
      const next = summaryFromSnapshot(snapshot);
      return [next, ...current.filter((item) => item.id !== next.id)].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
    });
  }

  async function selectPlan(id: string) {
    setLoading(true);
    setError("");
    try {
      const response = await getPlan(id);
      setSelectedId(id);
      window.localStorage.setItem(sessionStorageKey, id);
      applySnapshot(response.itinerary);
      setMessages(messagesFromRuns(response.runs));
      nextMessageId.current = response.runs.length * 2 + 1;
      setLatestNotification(response.itinerary.notifications.at(-1));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "無法開啟行程");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void getHistory()
      .then(async (items) => {
        setHistory(items);
        const storedId = window.localStorage.getItem(sessionStorageKey);
        if (storedId && items.some((item) => item.id === storedId)) await selectPlan(storedId);
      })
      .catch((requestError: Error) => setError(requestError.message))
      .finally(() => setInitializing(false));
    // This runs once for the local workbench; selecting a plan is the only follow-up load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await postPlan("/api/day-plans", { userId, date: planDate });
      setSelectedId(response.itinerary.id);
      window.localStorage.setItem(sessionStorageKey, response.itinerary.id);
      setMessages([starter]);
      setLatestNotification(undefined);
      applySnapshot(response.itinerary);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "無法建立行程");
    } finally {
      setLoading(false);
    }
  }

  function newPlan() {
    setSelectedId(undefined);
    setItinerary(undefined);
    setMessages([starter]);
    setLatestNotification(undefined);
    setPlanDate(todayDate());
    setError("");
    window.localStorage.removeItem(sessionStorageKey);
  }

  async function deletePlan(id: string) {
    setError("");
    try {
      const response = await fetch(`/api/day-plans/${id}/delete`, { method: "DELETE" });
      if (!response.ok) throw await readError(response, "刪除行程失敗");
      DeleteDayItineraryResponseSchema.parse(await response.json());
      const nextHistory = history.filter((item) => item.id !== id);
      setHistory(nextHistory);
      if (selectedId === id) {
        setSelectedId(undefined);
        setItinerary(undefined);
        setMessages([starter]);
        window.localStorage.removeItem(sessionStorageKey);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "刪除行程失敗");
    }
  }

  async function sendMessage(content: string) {
    if (!content || !selectedId || loading) return;
    setMessages((current) => [...current, { id: nextMessageId.current++, role: "user", content }]);
    setDraft("");
    setError("");
    setLoading(true);
    try {
      const response = await postPlan(`/api/day-plans/${selectedId}/messages`, {
        message: content,
      });
      applySnapshot(response.itinerary);
      const assistantMessage = response.assistantMessage;
      if (assistantMessage) {
        setMessages((current) => [
          ...current,
          { id: nextMessageId.current++, role: "assistant", content: assistantMessage },
        ]);
      }
      if (response.lastRun?.status === "failed")
        throw new Error(response.lastRun.error?.message ?? "行程對話失敗");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "暫時無法連線");
    } finally {
      setLoading(false);
    }
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isComposingRef.current) return;
    void sendMessage(draft.trim());
  }

  async function startPlan() {
    if (!selectedId || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await postPlan(`/api/day-plans/${selectedId}/start`);
      applySnapshot(response.itinerary);
      if (response.assistantMessage)
        setMessages((current) => [
          ...current,
          {
            id: nextMessageId.current++,
            role: "assistant",
            content: response.assistantMessage ?? "",
          },
        ]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "無法開始行程");
    } finally {
      setLoading(false);
    }
  }

  async function simulateEvent() {
    if (!selectedId || itinerary?.status !== "active" || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await postPlan(`/api/day-plans/${selectedId}/demo`, {
        scenario: demoScenario,
      });
      applySnapshot(response.itinerary);
      if (response.notification) setLatestNotification(response.notification);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Demo 更新失敗");
    } finally {
      setLoading(false);
    }
  }

  async function completePlan() {
    if (!selectedId || itinerary?.status !== "active" || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await postPlan(`/api/day-plans/${selectedId}/complete`);
      applySnapshot(response.itinerary);
      if (response.assistantMessage)
        setMessages((current) => [
          ...current,
          {
            id: nextMessageId.current++,
            role: "assistant",
            content: response.assistantMessage ?? "",
          },
        ]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "無法完成行程");
    } finally {
      setLoading(false);
    }
  }

  const readyToStart = itinerary?.status === "ready";
  const blockedLegCount = itinerary?.legs.filter((leg) => leg.status === "blocked").length ?? 0;
  const isToday = itinerary?.date === todayDate();
  const notification = latestNotification ?? itinerary?.notifications.at(-1);

  return (
    <main className="workbench">
      <header className="workbench-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <strong>{routaBrand}</strong>
          <span>{routaSubtitle}</span>
        </div>
      </header>
      <div className="workbench-grid">
        <aside className="history-sidebar" aria-label="行程紀錄">
          <div className="sidebar-heading">
            <div>
              <p className="kicker">MY DAY PLANS</p>
              <h1>行程紀錄</h1>
            </div>
            <button className="icon-button" onClick={newPlan} type="button">
              ＋ 新增
            </button>
          </div>
          <div className="history-list">
            {history.length ? (
              history.map((item) => (
                <div
                  className={`history-item ${item.id === selectedId ? "selected" : ""}`}
                  key={item.id}
                >
                  <button
                    className="history-select"
                    onClick={() => void selectPlan(item.id)}
                    type="button"
                  >
                    <strong>{item.date}</strong>
                    <span>
                      {statusLabel(item.status)} · {item.stopCount} 個目的地
                    </span>
                  </button>
                  <button
                    aria-label={`刪除 ${item.date} 行程`}
                    className="delete-button"
                    onClick={() => void deletePlan(item.id)}
                    type="button"
                  >
                    刪除
                  </button>
                </div>
              ))
            ) : (
              <p className="history-empty">還沒有行程。先選日期，建立第一個行程計劃。</p>
            )}
          </div>
        </aside>

        <section className="conversation-panel" aria-label="Routa 智旅行程討論">
          {!selectedId ? (
            <div className="create-plan">
              <h2>
                聊出你的行程，<em>隨時給你最佳路線。</em>
              </h2>
              <form onSubmit={createPlan}>
                <label htmlFor="plan-date">出遊日期</label>
                <input
                  id="plan-date"
                  onChange={(event) => setPlanDate(event.target.value)}
                  required
                  type="date"
                  value={planDate}
                />
                <button className="primary-action" disabled={loading} type="submit">
                  建立行程計劃 <span>→</span>
                </button>
              </form>
            </div>
          ) : (
            <>
              <div className="conversation-heading">
                <div>
                  <h2>{itinerary?.date} 的行程計劃</h2>
                </div>
              </div>
              <div className="conversation-log" aria-live="polite">
                {messages.map((message) => (
                  <div className={`message ${message.role}`} key={message.id}>
                    <span className="message-label">
                      {message.role === "assistant" ? routaAssistantLabel : "YOU"}
                    </span>
                    <p>{message.content}</p>
                  </div>
                ))}
                {loading && (
                  <div className="message assistant">
                    <span className="message-label">{routaAssistantLabel}</span>
                    <p>
                      <span className="typing-dot" />
                      正在重新檢查今天的安排…
                    </p>
                  </div>
                )}
              </div>
              <form className="composer" onSubmit={submitMessage}>
                <textarea
                  aria-label="輸入行程討論"
                  disabled={loading}
                  onChange={(event) => setDraft(event.target.value)}
                  onCompositionStart={() => {
                    isComposingRef.current = true;
                  }}
                  onCompositionEnd={() => {
                    isComposingRef.current = false;
                  }}
                  onKeyDown={(event) => {
                    const action = composerKeyAction(event, isComposingRef.current);
                    if (event.key === "Enter" && action === "ignore") {
                      event.preventDefault();
                      return;
                    }
                    if (action === "send") {
                      event.preventDefault();
                      void sendMessage(draft.trim());
                    }
                  }}
                  placeholder="繼續告訴智旅你的想法…"
                  rows={3}
                  value={draft}
                />
                <button disabled={loading || !draft.trim()} type="submit">
                  送出 <span>↗</span>
                </button>
              </form>
              <div className="conversation-note">
                <span>可以在開始行程後繼續討論並優化</span>
                <span>{itinerary?.revision ?? 0} revisions</span>
              </div>
            </>
          )}
        </section>

        <section className="itinerary-panel" aria-label="目前行程安排">
          {initializing ? (
            <div className="empty-state">正在讀取本機行程紀錄…</div>
          ) : !itinerary ? (
            <div className="empty-state">
              <span className="empty-mark">＋</span>
              <strong>右側會顯示完整行程</strong>
              <span>建立日期並開始對話後，這裡會列出每一段交通。</span>
            </div>
          ) : (
            <>
              <div className="itinerary-heading">
                <div>
                  <h2>{itinerary.date}</h2>
                </div>
                {readyToStart && blockedLegCount === 0 && (
                  <button
                    className="heading-action"
                    disabled={loading || !isToday}
                    onClick={() => void startPlan()}
                    type="button"
                  >
                    {isToday ? "開始行程" : `請於 ${itinerary.date} 開始`} <span>→</span>
                  </button>
                )}
              </div>
              {notification && <NotificationCard notification={notification} />}
              <div className="route-summary">
                <div>
                  <strong>{itinerary.stops.length} 個目的地</strong>
                  <span>
                    {itinerary.legs.length} 段交通 ·{" "}
                    {itinerary.returnHome ? "包含回家" : "不返回起點"}
                  </span>
                </div>
                <span className="route-source">GOOGLE ROUTES</span>
              </div>
              {itinerary.status === "discussing" && (
                <div className="planning-checklist">
                  <div>
                    <p className="kicker">01 / PLANNING STATUS</p>
                    <strong>{planningPhaseLabel(itinerary.planningPhase)}</strong>
                  </div>
                  <ul>
                    {assessPlanningReadiness(itinerary.planningFacts).missingFields.map((field) => (
                      <li key={field}>{planningFieldLabels[field]}</li>
                    ))}
                  </ul>
                  <span>
                    {itinerary.planningPhase === "awaiting_confirmation"
                      ? "請在左側對話確認摘要，確認後才會計算完整交通。"
                      : "我會先把必要資訊問清楚，不會先替你猜測完整行程。"}
                  </span>
                </div>
              )}
              <NavigationStatus snapshot={itinerary} />
              <RouteMap key={`${itinerary.id}-${itinerary.revision}`} snapshot={itinerary} />
              <StopTimeline snapshot={itinerary} />
              {readyToStart && blockedLegCount > 0 && (
                <div className="start-block">
                  <p className="start-blocked">
                    Routa 智旅已完成行程內容，但目前有 {blockedLegCount}{" "}
                    段交通沒有可用路線，請先確認 Google Routes API 設定。
                  </p>
                </div>
              )}
              {itinerary.status === "active" && (
                <div className="monitor-block">
                  <div>
                    <p className="kicker">LIVE MONITOR AGENT</p>
                    <strong>持續監測城市狀況</strong>
                    <span>路況、淹水、車站與 YouBike 更新會從這裡重新規劃。</span>
                  </div>
                  <div className="demo-controls">
                    <label htmlFor="demo-scenario">Demo 事件</label>
                    <select
                      id="demo-scenario"
                      onChange={(event) => setDemoScenario(event.target.value as DemoScenario)}
                      value={demoScenario}
                    >
                      <option value="flood">淹水</option>
                      <option value="road_closure">道路封閉</option>
                      <option value="station_disruption">車站中斷</option>
                      <option value="bike_unavailable">YouBike 無車</option>
                    </select>
                    <button
                      className="secondary-action"
                      disabled={loading}
                      onClick={() => void simulateEvent()}
                      type="button"
                    >
                      模擬更新並通知
                    </button>
                  </div>
                  <button
                    className="complete-action"
                    disabled={loading}
                    onClick={() => void completePlan()}
                    type="button"
                  >
                    完成今日行程
                  </button>
                </div>
              )}
              {itinerary.status === "completed" && (
                <div className="completed-block">
                  <span className="status-dot" /> 行程已完成，所有安排已回到起點。
                </div>
              )}
            </>
          )}
        </section>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
