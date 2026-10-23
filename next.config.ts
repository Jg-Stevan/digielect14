import type { NextConfig } from "next";
import path from "node:path";

/**
 * Configuración DUAL para GitHub Pages (repo digielect14):
 *
 *  · Dev / servidor local: `bun run dev` (:3001) → standalone.
 *  · GitHub Pages (estático): `BUILD_STATIC=1 bunx next build` → `./out/`.
 *    El sitio vive en jg-stevan.github.io/digielect14/ → basePath condicional
 *    desde NEXT_PUBLIC_BASE_PATH (la fija el workflow de deploy: /digielect14).
 *    El core localiza sus assets (worker/OpenCV) con la misma variable.
 */
const isStatic = process.env.BUILD_STATIC === "1";
const basePath = isStatic
  ? process.env.NEXT_PUBLIC_BASE_PATH || "/digielect14"
  : undefined;

const nextConfig: NextConfig = {
  // Repo plano: la raíz del workspace ES la raíz del repo.
  turbopack: { root: path.resolve(__dirname) },
  // El motor viene de npm (@jg-stevan/scanner-core, ESM dist) — no hay
  // TS de workspace que transpilar.
  ...(isStatic
    ? {
        output: "export" as const,
        trailingSlash: true,
        basePath,
      }
    : { output: "standalone" as const }),
  allowedDevOrigins: [
    "ais-dev-xny3nt46h5fmgcss6g6ir2-462073476889.us-west2.run.app",
    "ais-pre-xny3nt46h5fmgcss6g6ir2-462073476889.us-west2.run.app",
    "*.run.app",
    "*.aistudio.google.com",
    "*.space-z.ai",
    "localhost",
    "127.0.0.1",
  ],
  images: { unoptimized: true },
  reactStrictMode: false,
};

export default nextConfig;
