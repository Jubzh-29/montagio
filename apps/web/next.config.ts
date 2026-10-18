import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The Comfy SDK reads files and hashes them with WebAssembly: load it with Node's own
  // module loader instead of bundling it into the route handlers.
  serverExternalPackages: ['@comfyorg/sdk'],
};

export default nextConfig;
