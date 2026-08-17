import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The in-app preview uses 127.0.0.1 while Next serves the dev app on localhost.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
