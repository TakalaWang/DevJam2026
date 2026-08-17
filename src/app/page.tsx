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
  type RoutePoint,
} from "../contracts";
import { routaAssistantLabel, routaBrand, routaSubtitle } from "../lib/brand";
import { composerKeyAction } from "../lib/composer";
import { formatItineraryTime } from "../lib/time";
import {
  JUDGE_DEMO_TOTAL_MS,
  JUDGE_DEMO_TIMELINE,
  isJudgeDemoRunning,
  judgeDemoNextPhase,
  type JudgeDemoPhase,
} from "../lib/judge-demo";
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

function judgeDemoPhaseLabel(phase: JudgeDemoPhase): string {
  if (phase === "idle") return "尚未開始";
  if (phase === "stopped") return "已停止";
  if (phase === "error") return "需要重試";
  return JUDGE_DEMO_TIMELINE.find((step) => step.phase === phase)?.label ?? "進行中";
}

function judgeDemoPhaseDescription(phase: JudgeDemoPhase): string {
  if (phase === "stopped") return "流程已停止，行程仍保留在目前狀態。";
  if (phase === "error") return "流程遇到問題，請查看下方錯誤並重試。";
  return (
    JUDGE_DEMO_TIMELINE.find((step) => step.phase === phase)?.description ??
    "Routa 正在準備評審流程。"
  );
}

function formatDemoElapsed(elapsedMs: number): string {
  const seconds = Math.min(Math.round(elapsedMs / 1000), JUDGE_DEMO_TOTAL_MS / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
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
  const polyline = drawablePoints
    .map((point) => mapPosition(point, points))
    .map(([x, y]) => `${x},${y}`)
    .join(" ");

  return (
    <div className="route-map" aria-label="完整一日行程路線圖" role="img">
      <div className="map-grid" aria-hidden="true" />
      <svg viewBox="0 0 400 280" aria-hidden="true">
        {polyline && <polyline className="map-route" points={polyline} />}
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
    <div className="route-map google-route-map" aria-label="Google Maps 一日行程路線圖" role="img">
      <div className="google-map-canvas" ref={mapElementRef} />
      {mapStatus === "loading" && <div className="map-loading">正在載入 Google Maps…</div>}
      <div className="map-caption">
        <span className="status-dot" /> Google Maps · {snapshot.legs.length} 段交通
      </div>
    </div>
  );
}

function LegLine({ leg }: { leg: DayItinerarySnapshot["legs"][number] }) {
  return (
    <div className={`leg-line ${leg.status}`}>
      <span>↳</span>
      <strong>{leg.status === "blocked" ? "路段受阻" : modeLabel(leg.route?.profile)}</strong>
      <span>
        {leg.status === "blocked" ? leg.reason : formatDuration(leg.route?.durationSeconds)}
      </span>
    </div>
  );
}

function StopTimeline({ snapshot }: { snapshot: DayItinerarySnapshot }) {
  const returnLeg = snapshot.legs.at(-1)?.toStopId === "home" ? snapshot.legs.at(-1) : undefined;
  const activityLegs = returnLeg ? snapshot.legs.slice(0, -1) : snapshot.legs;
  return (
    <div className="timeline">
      {snapshot.origin && (
        <div className="timeline-row origin-row">
          <span className="timeline-dot origin" />
          <div className="timeline-copy">
            <small>出發 · {formatItineraryTime(snapshot.startAt)}</small>
            <strong>{snapshot.origin.label}</strong>
          </div>
        </div>
      )}
      {snapshot.stops.map((stop, index) => (
        <div className="timeline-group" key={stop.id}>
          {activityLegs[index] && <LegLine leg={activityLegs[index]} />}
          <div className="timeline-row">
            <span className={`timeline-dot ${stop.constraint} ${stop.status}`} />
            <div className="timeline-copy">
              <small>
                {stop.constraint === "fixed" ? "固定活動" : "可調整"} ·{" "}
                {formatItineraryTime(stop.timeWindow?.startAt)}
              </small>
              <strong>{stop.title}</strong>
              <span>{stop.location.label}</span>
            </div>
            <span className={`constraint ${stop.constraint}`}>
              {stop.constraint === "fixed" ? "FIXED" : "FLEX"}
            </span>
          </div>
        </div>
      ))}
      {returnLeg && snapshot.origin && (
        <div className="timeline-group return-group">
          <LegLine leg={returnLeg} />
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
  const [judgeDemoPhase, setJudgeDemoPhase] = useState<JudgeDemoPhase>("idle");
  const [judgeDemoElapsedMs, setJudgeDemoElapsedMs] = useState(0);
  const nextMessageId = useRef(1);
  const isComposingRef = useRef(false);
  const judgeDemoRunRef = useRef(0);
  const judgeDemoTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const judgeDemoStartedAtRef = useRef<number | undefined>(undefined);

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

  function appendMessage(role: ChatMessage["role"], content: string) {
    setMessages((current) => [...current, { id: nextMessageId.current++, role, content }]);
  }

  function clearJudgeDemoTimers() {
    judgeDemoTimersRef.current.forEach((timer) => clearTimeout(timer));
    judgeDemoTimersRef.current = [];
  }

  useEffect(() => {
    if (!isJudgeDemoRunning(judgeDemoPhase) || judgeDemoStartedAtRef.current === undefined) {
      return;
    }
    const interval = setInterval(() => {
      setJudgeDemoElapsedMs(Date.now() - (judgeDemoStartedAtRef.current ?? Date.now()));
    }, 500);
    return () => clearInterval(interval);
  }, [judgeDemoPhase]);

  useEffect(() => {
    return () => {
      clearJudgeDemoTimers();
      judgeDemoRunRef.current += 1;
    };
  }, []);

  async function selectPlan(id: string) {
    resetJudgeDemo();
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
    const storedId = window.localStorage.getItem(sessionStorageKey);
    void getHistory()
      .then(async (items) => {
        setHistory(items);
        if (storedId && items.some((item) => item.id === storedId)) await selectPlan(storedId);
      })
      .catch((requestError: Error) => setError(requestError.message))
      .finally(() => setInitializing(false));
    // This runs once for the local workbench; selecting a plan is the only follow-up load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetJudgeDemo();
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
    resetJudgeDemo();
    setSelectedId(undefined);
    setItinerary(undefined);
    setMessages([starter]);
    setLatestNotification(undefined);
    setPlanDate(todayDate());
    setError("");
    window.localStorage.removeItem(sessionStorageKey);
  }

  async function deletePlan(id: string) {
    if (selectedId === id) resetJudgeDemo();
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

  function resetJudgeDemo() {
    judgeDemoRunRef.current += 1;
    clearJudgeDemoTimers();
    judgeDemoStartedAtRef.current = undefined;
    setJudgeDemoElapsedMs(0);
    setJudgeDemoPhase("idle");
  }

  async function startPlan() {
    if (!selectedId || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await postPlan(`/api/day-plans/${selectedId}/start`);
      applySnapshot(response.itinerary);
      if (response.assistantMessage) appendMessage("assistant", response.assistantMessage);
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
      if (response.assistantMessage) appendMessage("assistant", response.assistantMessage);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "無法完成行程");
    } finally {
      setLoading(false);
    }
  }

  function stopJudgeDemo() {
    if (!isJudgeDemoRunning(judgeDemoPhase)) return;
    judgeDemoRunRef.current += 1;
    clearJudgeDemoTimers();
    judgeDemoStartedAtRef.current = undefined;
    setJudgeDemoPhase("stopped");
    appendMessage("assistant", "評審 Demo 已停止；你仍然可以用右側控制列手動更新或完成行程。");
  }

  async function runJudgeDemo() {
    if (!selectedId || !readyToStart || loading || isJudgeDemoRunning(judgeDemoPhase)) return;
    const planId = selectedId;
    const runId = judgeDemoRunRef.current + 1;
    judgeDemoRunRef.current = runId;
    clearJudgeDemoTimers();
    judgeDemoStartedAtRef.current = Date.now();
    setJudgeDemoElapsedMs(0);
    setJudgeDemoPhase("confirming");
    setError("");
    appendMessage("user", "這個安排可以，請幫我開始導航；如果遇到突發狀況就直接幫我改路線。");

    const timeout = setTimeout(() => {
      if (judgeDemoRunRef.current !== runId) return;
      judgeDemoRunRef.current += 1;
      clearJudgeDemoTimers();
      setJudgeDemoPhase("error");
      setError("Demo 超過兩分鐘仍未完成，請檢查 API 連線後重試。");
      setLoading(false);
    }, JUDGE_DEMO_TOTAL_MS);
    judgeDemoTimersRef.current.push(timeout);

    try {
      appendMessage(
        "assistant",
        "收到。我會先確認各段交通，再啟動導航；途中如果偵測到災害或道路中斷，會即時通知並重新安排。",
      );
      setJudgeDemoPhase(judgeDemoNextPhase("confirming") ?? "starting");
      setLoading(true);

      const startResponse = await postPlan(`/api/day-plans/${planId}/start`);
      if (judgeDemoRunRef.current !== runId) return;
      applySnapshot(startResponse.itinerary);
      appendMessage(
        "assistant",
        startResponse.assistantMessage ?? "導航已啟動，Routa 開始監測你的行程。",
      );
      setJudgeDemoPhase(judgeDemoNextPhase("starting") ?? "navigating");

      appendMessage("assistant", "⚠️ 偵測到前方示範道路封閉。我先暫停原路線，重新評估下一段交通。");
      setJudgeDemoPhase(judgeDemoNextPhase("navigating") ?? "incident");
      const refreshResponse = await postPlan(`/api/day-plans/${planId}/demo`, {
        scenario: "road_closure",
      });
      if (judgeDemoRunRef.current !== runId) return;
      applySnapshot(refreshResponse.itinerary);
      if (refreshResponse.notification) setLatestNotification(refreshResponse.notification);
      let refreshedStatus = refreshResponse.itinerary.status;
      if (refreshResponse.itinerary.status === "update_pending") {
        appendMessage("user", "我確認這次改道安排，請繼續導航。");
        const confirmation = await postPlan(`/api/day-plans/${planId}/messages`, {
          message: "我確認這次改道安排，請繼續導航。",
        });
        if (judgeDemoRunRef.current !== runId) return;
        applySnapshot(confirmation.itinerary);
        refreshedStatus = confirmation.itinerary.status;
        if (confirmation.assistantMessage)
          appendMessage("assistant", confirmation.assistantMessage);
      }
      if (refreshedStatus === "update_pending") {
        throw new Error("改道路線仍等待確認，Demo 無法繼續完成。");
      }

      setJudgeDemoPhase(judgeDemoNextPhase("incident") ?? "rerouting");
      appendMessage(
        "assistant",
        "已完成重新規劃，受影響路段已標記並替換成可行路線；右側地圖與時間軸已同步更新。",
      );

      const completeResponse = await postPlan(`/api/day-plans/${planId}/complete`);
      if (judgeDemoRunRef.current !== runId) return;
      applySnapshot(completeResponse.itinerary);
      if (completeResponse.assistantMessage)
        appendMessage("assistant", completeResponse.assistantMessage);
      setJudgeDemoElapsedMs(Date.now() - (judgeDemoStartedAtRef.current ?? Date.now()));
      setJudgeDemoPhase(judgeDemoNextPhase("rerouting") ?? "completed");
      judgeDemoStartedAtRef.current = undefined;
      clearJudgeDemoTimers();
      appendMessage("assistant", "評審 Demo 完成：導航、災害通知與即時改道流程都已跑完。");
    } catch (requestError) {
      if (judgeDemoRunRef.current !== runId) return;
      const message = requestError instanceof Error ? requestError.message : "Demo 流程失敗";
      setError(message);
      setJudgeDemoPhase("error");
      appendMessage("assistant", `Demo 無法完成：${message}`);
    } finally {
      if (judgeDemoRunRef.current === runId) {
        clearJudgeDemoTimers();
      }
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
                  <p className="kicker">02 / ROUTA CONVERSATION</p>
                  <h2>{itinerary?.date} 的行程計劃</h2>
                </div>
                <span className="status-chip">
                  {itinerary ? statusLabel(itinerary.status) : "載入中"}
                </span>
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
                  <p className="kicker">03 / CURRENT ITINERARY</p>
                  <h2>{itinerary.date}</h2>
                </div>
                <span className="status-chip">
                  <span className="status-dot" />
                  {statusLabel(itinerary.status)}
                </span>
              </div>
              {judgeDemoPhase !== "idle" && (
                <div className={`judge-demo-panel ${judgeDemoPhase}`}>
                  <div className="judge-demo-heading">
                    <div>
                      <p className="kicker">JUDGE DEMO · 最長 02:00</p>
                      <strong>{judgeDemoPhaseLabel(judgeDemoPhase)}</strong>
                    </div>
                    <span className="judge-demo-clock">
                      {formatDemoElapsed(judgeDemoElapsedMs)} / 2:00
                    </span>
                  </div>
                  <div className="judge-demo-progress" aria-hidden="true">
                    <span
                      style={{
                        width: `${Math.min(100, (judgeDemoElapsedMs / JUDGE_DEMO_TOTAL_MS) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="judge-demo-copy">{judgeDemoPhaseDescription(judgeDemoPhase)}</p>
                  {isJudgeDemoRunning(judgeDemoPhase) && (
                    <button className="judge-demo-stop" onClick={stopJudgeDemo} type="button">
                      停止 Demo
                    </button>
                  )}
                </div>
              )}
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
              <RouteMap key={`${itinerary.id}-${itinerary.revision}`} snapshot={itinerary} />
              <StopTimeline snapshot={itinerary} />
              {readyToStart && (
                <div className="start-block">
                  {blockedLegCount > 0 ? (
                    <p className="start-blocked">
                      Routa 智旅已完成行程內容，但目前有 {blockedLegCount}{" "}
                      段交通沒有可用路線，請先確認 Google Routes API 設定。
                    </p>
                  ) : (
                    <>
                      <p>智旅判定從出門到回家的安排已經完整。</p>
                      <button
                        className="primary-action"
                        disabled={loading || !isToday}
                        onClick={() => void startPlan()}
                        type="button"
                      >
                        {isToday ? "開始今日行程" : `請於 ${itinerary.date} 當天開始`}{" "}
                        <span>→</span>
                      </button>
                      <button
                        className="judge-demo-launch"
                        disabled={
                          loading ||
                          !isToday ||
                          blockedLegCount > 0 ||
                          isJudgeDemoRunning(judgeDemoPhase)
                        }
                        onClick={runJudgeDemo}
                        type="button"
                      >
                        播放 2 分鐘評審 Demo <span>▶</span>
                      </button>
                    </>
                  )}
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
