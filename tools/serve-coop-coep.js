/**
 * Servidor estático COOP/COEP — infra de los bancos de tools/ (fuera de la
 * app; gates D58: el diff solo toca tools/ + docs/). Requisitos de los
 * benches: crossOriginIsolated (COOP/COEP → numThreads>1 de ORT) y resolución
 * de imports EXTENSIONLESS del core (@jg-stevan/scanner-core emite
 * `from "./types"` bundler-style — el navegador pide /types y este servidor
 * responde con /types.js; en la app lo resuelve el bundler).
 *
 * Uso: bun run tools/serve-coop-coep.js [puerto] [raiz]
 * Abrir: http://localhost:PORT/tools/(banco)/bench.html
 */
const puerto = Number(process.argv[2] || 8123);
const raiz = new URL(`.${process.argv[3] || ""}`, `file://${import.meta.dir}/../`).pathname.replace(/\/$/, "");
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
  ".md": "text/markdown; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".gitkeep": "text/plain",
};
const tipoDe = (ruta) => {
  const i = ruta.lastIndexOf(".");
  return i === -1 ? "application/octet-stream" : MIME[ruta.slice(i).toLowerCase()] ?? "application/octet-stream";
};
const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cache-Control": "no-store",
};
Bun.serve({
  port: puerto,
  async fetch(req) {
    const url = new URL(req.url);
    let ruta = decodeURIComponent(url.pathname);
    if (ruta.endsWith("/")) ruta += "index.html";
    const absoluta = (p) => Bun.file(`${raiz}${p}`);
    let f = absoluta(ruta);
    if (!(await f.exists())) {
      // Fallback extensionless del core (bundler-style): ./types → ./types.js
      const sinExt = !/\.[a-zA-Z0-9]+$/.test(ruta);
      if (sinExt) {
        const conJs = absoluta(`${ruta}.js`);
        if (await conJs.exists()) f = conJs;
      }
    }
    if (!(await f.exists())) return new Response("404", { status: 404, headers });
    return new Response(f, { headers: { ...headers, "Content-Type": tipoDe((await f).name ?? ruta) } });
  },
});
console.log(`COOP/COEP server en http://localhost:${puerto} raiz=${raiz}`);
