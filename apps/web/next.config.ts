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
      // No next/image here: /_next/image, which fetches what its URL names, stays closed.
      images: { unoptimized: true },
      async headers() {
        const page = [
          // Another site cannot show the app in a frame and have the user click in it unseen.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // A link followed out of the app (a trend's sound, a model's page) does not say where it was clicked.
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ];
        // The answers and the files are for this app's pages only: another site cannot even embed them.
        const own = [{ key: 'Cross-Origin-Resource-Policy', value: 'same-origin' }];
        return [
          { source: '/:path*', headers: page },
          { source: '/api/:path*', headers: own },
          { source: '/media/:path*', headers: own },
        ];
      },
    };

export default nextConfig;
