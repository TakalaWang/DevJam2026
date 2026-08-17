import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Routa 智旅 · 智慧旅遊規劃",
  description: "用自然語言規劃台灣旅程與避塞車路線的聊天助理。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
