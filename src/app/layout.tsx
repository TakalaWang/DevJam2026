import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Routecraft · 避塞車行程",
  description: "用自然語言規劃台灣旅程的聊天助理。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
