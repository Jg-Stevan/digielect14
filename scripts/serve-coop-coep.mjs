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
 * También resuelve imports extensionless (`./types` → `./types.js`) porque el
 * core `@jg-stevan/scanner-core` emite imports bundler-style.
 */
import { dirname, join, normalize, resolve, sep } from "node:path";
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

const HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cache-Control": "no-store",
};

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
    if (!camino) return new Response("404", { status: 404, headers: HEADERS });

    const archivo = Bun.file(camino);
    if (!(await archivo.exists())) return new Response("404", { status: 404, headers: HEADERS });
    const ext = (camino.match(/\.[a-zA-Z0-9]+$/) || [""])[0].toLowerCase();
    return new Response(archivo, {
      headers: { ...HEADERS, "Content-Type": MIME[ext] ?? "application/octet-stream" },
    });
  },
});

console.log(`COOP/COEP en http://localhost:${puerto} servido desde ${raiz}`);
