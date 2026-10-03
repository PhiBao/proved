import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The Stellar SDK and the contract spec parser are ESM-only.
  transpilePackages: ["@stellar/stellar-sdk"],
};

export default nextConfig;
