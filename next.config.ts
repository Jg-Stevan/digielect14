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
 *  · Cloudflare Pages (estático en raíz): `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=
 *    bunx next build` → basePath desactivado (servido en la raíz del dominio,
 *    ej. digielect14.pages.dev). El string vacío explícito = a propósito.
 */
const isStatic = process.env.BUILD_STATIC === "1";
// "" explícito → deploy en raíz (Cloudflare Pages). Sin definir → fallback
// histórico /digielect14 (GH Pages). El core y el código e14 usan `?? ""`,
// así que el string vacío ya produce rutas raíz correctas en el cliente.
const basePath = isStatic
  ? process.env.NEXT_PUBLIC_BASE_PATH === ""
    ? undefined
    : process.env.NEXT_PUBLIC_BASE_PATH || "/digielect14"
  : undefined;

const nextConfig: NextConfig = {
  // Repo plano: la raíz del workspace ES la raíz del repo.
  turbopack: { root: path.resolve(__dirname) },
  // El motor viene de npm (@jg-stevan/scanner-core, ESM dist) — no hay
  // TS de workspace que transpilar.
  // WAVE3 §A.2 — ORDEN-WAVE3-remoto-rescate-obs-v1: la API route del ledger
  // remoto (src/app/api/e14/envios/route.ts) es compatible con AMBOS builds
  // SIN config extra: el export estático (BUILD_STATIC=1 — GH Pages / out/)
  // la OMITE sin error (Next 16 marca POST/DELETE como ƒ Dynamic y no la
  // exporta — verificado empíricamente; el out/ no trae /api), y el build
  // de servidor (opennext Worker) la incluye (app-paths-manifest).
  // NOTA: `export const dynamic = "force-dynamic"` en la route ROMPE el
  // export («cannot be used with output: export») y un valor condicional
  // no es parseable («needs to be a static string») — la route va SIN
  // segment config (POST/DELETE ya son dinámicos por naturaleza).
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

import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
