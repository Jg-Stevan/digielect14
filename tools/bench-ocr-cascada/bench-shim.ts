/**
 * Shim SOLO-BANCO (patrón tools/bench-dedup-tolerancia/bench.html): los
 * módulos de producción capturan `process.env.NEXT_PUBLIC_BASE_PATH` a nivel
 * de módulo (el bundler de la app lo inyecta; aquí lo arma el banco ANTES de
 * que los módulos del bundle evalúen — este módulo es el PRIMER import de
 * entry-bench.ts, y esbuild preserva el orden de evaluación).
 *
 * DOS CONTEXTOS ejecutan este bundle (ORT 1.30 re-ejecuta el MISMO archivo
 * como module worker para su proxy worker y sus pthreads em-pthread —
 * `self.name === "ort-wasm-proxy-worker" | "em-pthread…"`):
 *  · PÁGINA (main thread, `document` existe): base ABSOLUTA
 *    (`document.baseURI` + ../../public/) — onnxruntime-web resuelve
 *    `wasmPaths` contra el documento; absoluto es inmune a la página desde
 *    la que se sirva. Overridable con `window.__BENCH_BASE`.
 *  · WORKER ORT (sin `document`): base NEUTRA "" — el worker NO hace fetch
 *    de assets (el main le pasa el wasm en el mensaje init); lo único que
 *    necesita es que los consts a nivel de módulo evalúen SIN
 *    ReferenceError (`process` definido).
 *
 * Fuera de este banco esto NO existe — 0 diff en src/ (gates D58).
 */
// Cast por unknown: los tipos de Node tipan `globalThis.process` como
// Process NO-opcional — el banco solo necesita la forma mínima del objeto.
const g = globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
  __BENCH_BASE?: string;
};

if (!g.process) g.process = {};
if (!g.process.env) g.process.env = {};
if (typeof document !== "undefined") {
  // PÁGINA — base absoluta sin slash final (los módulos interpolan `${PUBLIC_BASE}/…`).
  if (!g.process.env.NEXT_PUBLIC_BASE_PATH) {
    const base = g.__BENCH_BASE ?? "../../public/";
    g.process.env.NEXT_PUBLIC_BASE_PATH = new URL(base, document.baseURI).href.replace(/\/$/, "");
  }
} else if (g.process.env.NEXT_PUBLIC_BASE_PATH === undefined) {
  // WORKER ORT (proxy/pthreads) — base neutra; evaluar módulos sin fallo.
  g.process.env.NEXT_PUBLIC_BASE_PATH = "";
}
