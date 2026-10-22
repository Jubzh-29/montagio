import type { NextConfig } from "next";

// The showcase (the free demo link) is a static export: no server, so every
// route.ts handler is left out (pageExtensions) and the pages call an in-page
// router instead of /api (src/showcase). See docs/VITRINE.md.
const showcaseExport = process.env.MONTAGIO_SHOWCASE_EXPORT === '1';
const basePath = process.env.NEXT_PUBLIC_MONTAGIO_BASE_PATH || undefined;

const nextConfig: NextConfig = showcaseExport
  ? {
      output: 'export',
      trailingSlash: true,
      pageExtensions: ['tsx'],
      basePath,
      images: { unoptimized: true },
      // cacheComponents turns on partial prerendering, which a static export refuses
      // ("PPR cannot be enabled in export mode"); the showcase pages are client components.
    }
  : {
      /* config options here */
      cacheComponents: true,
      // In development, Next's indicator sits over the canvas, not over the composer's hints.
      devIndicators: { position: 'bottom-right' },
      partialPrefetching: true,
      // The Comfy SDK reads files and hashes them with WebAssembly: load it with Node's own
      // module loader instead of bundling it into the route handlers.
      serverExternalPackages: ['@comfyorg/sdk'],
    };

export default nextConfig;
