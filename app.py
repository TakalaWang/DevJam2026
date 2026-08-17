"""Streamlit entry point for the traffic-aware itinerary demo."""

import os
from datetime import datetime

import folium
import streamlit as st
from dotenv import load_dotenv
from streamlit_folium import st_folium

from traffic_planner.itinerary import Stop, leave_by, parse_stops
from traffic_planner.presentation import decode_polyline, format_duration
from traffic_planner.routes import DemoRouteProvider, GoogleRoutesProvider, is_congested


DEFAULT_STOPS = "14:00 | 台北 101\n16:00 | 大稻埕\n18:30 | 內湖科技園區"
TAIPEI_CENTER = [25.0478, 121.5319]
DEMO_POINTS = {
    "台北車站": [25.0478, 121.5170],
    "台北 101": [25.0339, 121.5645],
    "大稻埕": [25.0567, 121.5101],
    "內湖科技園區": [25.0806, 121.5720],
}


def point_for(name: str):
    return DEMO_POINTS.get(name, TAIPEI_CENTER)


def main() -> None:
    load_dotenv()
    st.set_page_config(page_title="避塞車行程 Agent", page_icon="🚦", layout="wide")
    st.title("🚦 智慧避塞車行程 Agent")
    st.caption("Google Maps Routes API 負責路況與路徑；程式負責把每段行程排進時間軸。")

    api_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if api_key:
        st.success("Live mode：使用 Google Maps Routes API 的交通感知路線。")
        provider = GoogleRoutesProvider(api_key)
    else:
        st.warning("Demo mode：尚未設定 GOOGLE_MAPS_API_KEY，顯示固定示範路況，不是即時資料。")
        provider = DemoRouteProvider()

    with st.form("itinerary"):
        start_name = st.text_input("起點", "台北車站")
        start_time = st.time_input("起點出發時間", value=datetime.strptime("13:00", "%H:%M").time())
        day = st.date_input("日期")
        stops_text = st.text_area("每行一站（格式：HH:MM | 地點）", DEFAULT_STOPS, height=130)
        submitted = st.form_submit_button("分析路況與路線", type="primary")

    if not submitted:
        return

    try:
        stops = parse_stops(stops_text, day)
        if not stops:
            raise ValueError("請至少輸入一個目的地")
        start = Stop(start_name.strip(), datetime.combine(day, start_time))
        itinerary = [start, *stops]
        routes = [provider.get_route(origin, destination) for origin, destination in zip(itinerary, itinerary[1:])]
    except Exception as error:
        st.error(f"無法產生行程：{error}")
        return

    st.subheader("建議時間軸")
    columns = st.columns(len(routes))
    for column, route, destination in zip(columns, routes, stops):
        delayed = is_congested(route)
        delay = route.traffic_seconds - route.normal_seconds
        with column:
            st.markdown(f"**{route.origin} → {route.destination}**")
            st.metric("交通預估", format_duration(route.traffic_seconds), f"+{format_duration(delay)} 延誤" if delay else "順暢")
            st.caption(f"建議最晚 {leave_by(destination.arrival_at, route.traffic_seconds):%H:%M} 出發，{destination.arrival_at:%H:%M} 前抵達")
            if delayed:
                st.warning("延誤超過 20%，建議預留時間或改搭大眾運輸。")
            else:
                st.success("交通狀況相對順暢。")

    st.subheader("推薦路線")
    route_map = folium.Map(location=TAIPEI_CENTER, zoom_start=12, tiles="CartoDB positron")
    for stop in itinerary:
        folium.Marker(point_for(stop.name), tooltip=stop.name).add_to(route_map)
    for route in routes:
        points = decode_polyline(route.encoded_polyline) if route.encoded_polyline else [point_for(route.origin), point_for(route.destination)]
        folium.PolyLine(points, color="#ef8b36" if is_congested(route) else "#159f6b", weight=6, opacity=0.85, tooltip=f"{route.origin} → {route.destination}").add_to(route_map)
    st_folium(route_map, width=None, height=460, returned_objects=[])


if __name__ == "__main__":
    main()
