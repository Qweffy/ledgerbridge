import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ["@ledgerbridge/shared"],
};

export default nextConfig;
