import type { NextConfig } from "next";
import path from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Deploy ÚNICO Cloudflare (A-02 del plan 2026-11-12 — GitHub Pages retirado):
 *
 *  · Dev / servidor local: `bun run dev` (:3000) → standalone.
 *  · Cloudflare Pages (estático en la RAÍZ del dominio, digielect14.pages.dev):
 *    `BUILD_STATIC=1 bun run build` → `./out/`. SIN basePath — el sitio y los
 *    assets del motor (worker/OpenCV) se sirven desde `/`. El core y el código
 *    e14 siguen leyendo NEXT_PUBLIC_BASE_PATH con `?? ""` (inofensiva: sin
 *    definir produce rutas raíz correctas), pero la variable ya no fija
 *    basePath aquí: el único destino es la raíz.
 */
const isStatic = process.env.BUILD_STATIC === "1";

// ─── Ola 6 §6.5 (F9) — BUILD_ID DETERMINISTA ────────────────────────────
// Dos builds del mismo árbol producían IDs distintos (`2X4OpCXG…` vs
// `neH5n_ko…`): el BUILD_ID vive embebido en el HTML prerenderizado y sin
// determinismo no hay forma de verificar deploys por comparación.
// Fórmula del plan: sha256(git HEAD + ":" + sha256(bun.lock)) → 21 hex.
//   · En CI (checkout limpio): dos builds consecutivos → el MISMO ID.
//   · Local con árbol sucio: el ID sigue estable por HEAD (el contenido no
//     entra en el hash — propiedad documentada del bloque 6.5).
//   · Sin git (entorno raro/zip): hash del contenido de bun.lock con sufijo
//     `-nogit` — fallback HONESTO: el ID sigue siendo estable por lockfile y
//     declara en el propio ID que no viene de un checkout git.
function buildIdDeterminista(): string {
  try {
    const head = execSync("git rev-parse HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const lock = createHash("sha256").update(readFileSync(path.join(__dirname, "bun.lock"))).digest("hex");
    return createHash("sha256").update(`${head}:${lock}`).digest("hex").slice(0, 21);
  } catch {
    const lock = createHash("sha256")
      .update(readFileSync(path.join(__dirname, "bun.lock")))
      .digest("hex");
    return `${createHash("sha256").update(lock).digest("hex").slice(0, 21)}-nogit`;
  }
}

const nextConfig: NextConfig = {
  // §6.5 — misma entrada → mismo BUILD_ID (ver buildIdDeterminista arriba).
  generateBuildId: async () => buildIdDeterminista(),
  // Repo plano: la raíz del workspace ES la raíz del repo.
  turbopack: { root: path.resolve(__dirname) },
  // El motor vive en el PAQUETE (@jg-stevan/scanner-core, TypeScript fuente
  // vía bun workspaces) — se transpila junto a la app.
  transpilePackages: ["@jg-stevan/scanner-core"],
  // NOTA (eliminación del módulo masiva): la API route del ledger remoto
  // (src/app/api/e14/envios) se retiró con la cola MASIVA.
  ...(isStatic
    ? {
        output: "export" as const,
        trailingSlash: true,
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

// Solo en DEV: initOpenNextCloudflareForDev levanta miniflare para exponer las
// bindings de Workers. En `next build` no cumple nada (el móvil se sirve como
// export estático) y ese arranque intermitente corta el build con EPERM.
if (process.env.NODE_ENV === "development") {
  import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
}
