import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@dungeons/rules", "@dungeons/srd"],
  turbopack: {
    resolveAlias: {
      clsx: "cn",
      "tailwind-merge": "cn",
    },
  },
};

export default nextConfig;
