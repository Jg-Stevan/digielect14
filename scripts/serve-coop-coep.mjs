/**
 * Servidor estático con COOP/COEP.
 *
 * Para qué sirve: el OCR multihilo (onnxruntime-web `numThreads > 1`) solo se
 * activa con `crossOriginIsolated`, y eso exige las cabeceras
 * Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy. `next dev` no las
 * emite, así que para medir el comportamiento real de hilos hay que servir el
 * build estático (`bunx next build` → `out/`) con este servidor.
 *
 * Uso:   bun run scripts/serve-coop-coep.mjs [puerto] [directorio]
 *        (directorio por defecto: out/)
 * Abrir: http://localhost:8123/
 *
 * También resuelve imports extensionless (`./types` → `./types.js`). Hacía
 * falta cuando el motor venía como dist de npm con imports bundler-style; con
 * el core vendorizado (`src/lib/e14/core/`, lo compila Next) ya no se dispara,
 * pero se deja: es inofensivo y sirve si algún asset suelto vuelve a traerlos.
 *
 * KIT e14-remediacion-movil-v1 (D2 — #14): caché de estáticos alineada con
 * public/_headers — no-store ya no es global; segunda recarga debe dar
 * transferSize=0 en modelos/wasm (Resource Timing).
 */
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ_PROYECTO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const puerto = Number(process.argv[2] || 8123);
const raiz = resolve(RAIZ_PROYECTO, process.argv[3] || "out");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".onnx": "application/octet-stream",
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** COOP/COEP en TODAS las respuestas — mismo bloque `/*` de public/_headers. */
const HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/**
 * Cache-Control por ruta — MISMAS reglas que public/_headers (fuente de verdad:
 * Cloudflare Pages copia ese archivo tal cual). Antes esto era `no-store`
 * global: ~17 MB de modelos/wasm re-descargados en cada recarga y mediciones
 * de carga contaminadas (#14).
 *
 *   /_next/static/*           → public, max-age=31536000, immutable (hash de contenido)
 *   /wasm/* /models/* /vendor/* → public, max-age=86400           (versionados a mano)
 *   HTML (index.html y páginas) y /sw.js → no-cache               (siempre revalidar:
 *                                evita la app vieja/en blanco tras un deploy)
 *   404                       → no-store (nada cacheable)
 *   resto de estáticos        → SIN Cache-Control, igual que en producción
 *                               (_headers no define regla para ellos)
 *
 * `rutaRelativa` es la del ARCHIVO RESUELTO (tras el fallback `index.html` y
 * el extensionless), con separadores `/`: clasifica bien `/foo/` →
 * `foo/index.html` como HTML y `/types` → `types.js` como JS.
 */
function cacheControlPara(rutaRelativa) {
  if (rutaRelativa.startsWith("_next/static/")) {
    return "public, max-age=31536000, immutable";
  }
  if (
    rutaRelativa.startsWith("wasm/") ||
    rutaRelativa.startsWith("models/") ||
    rutaRelativa.startsWith("vendor/")
  ) {
    return "public, max-age=86400";
  }
  if (rutaRelativa === "sw.js" || rutaRelativa.endsWith(".html")) return "no-cache";
  return null;
}

/** Ruta pedida → archivo dentro de `raiz`, o null si intenta salir de ella. */
function dentroDeRaiz(pedido) {
  const absoluta = normalize(join(raiz, pedido));
  return absoluta === raiz || absoluta.startsWith(raiz + sep) ? absoluta : null;
}

Bun.serve({
  port: puerto,
  async fetch(req) {
    const url = new URL(req.url);
    let ruta = decodeURIComponent(url.pathname);
    if (ruta.endsWith("/")) ruta += "index.html";

    let camino = dentroDeRaiz(ruta.slice(1));
    if (camino && !(await Bun.file(camino).exists())) {
      // Fallback extensionless: ./types → ./types.js
      if (!/\.[a-zA-Z0-9]+$/.test(ruta)) {
        const conJs = dentroDeRaiz(`${ruta.slice(1)}.js`);
        if (conJs && (await Bun.file(conJs).exists())) camino = conJs;
      }
    }
    if (!camino)
      return new Response("404", {
        status: 404,
        headers: { ...HEADERS, "Cache-Control": "no-store" },
      });

    const archivo = Bun.file(camino);
    if (!(await archivo.exists()))
      return new Response("404", {
        status: 404,
        headers: { ...HEADERS, "Cache-Control": "no-store" },
      });
    const ext = (camino.match(/\.[a-zA-Z0-9]+$/) || [""])[0].toLowerCase();
    // D2 (#14): clasificar por la ruta del archivo resuelto, relativa a la raíz
    // y con `/` como separador, para aplicar las reglas de public/_headers.
    const relativa = relative(raiz, camino).split(sep).join("/");
    const cacheControl = cacheControlPara(relativa);
    const headers = { ...HEADERS, "Content-Type": MIME[ext] ?? "application/octet-stream" };
    if (cacheControl) headers["Cache-Control"] = cacheControl;
    return new Response(archivo, { headers });
  },
});

console.log(`COOP/COEP en http://localhost:${puerto} servido desde ${raiz}`);
