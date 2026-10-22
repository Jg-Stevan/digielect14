/**
 * Wrapper ESM sobre el UMD de heic2any — SOLO para este banco (NUNCA
 * producción). El core (`@jg-stevan/scanner-core/dist/image-processor.js`
 * L163) hace `import("heic2any")` — especificador bare que el navegador no
 * resuelve sin import map. Este módulo carga el UMD vía <script> y re-exporta
 * un `default` ASYNC compatible: el core guarda `mod.default` y lo invoca
 * esperando una Promesa de Blob — la delegación interna mantiene ese contrato.
 *
 * En Next.js/producción esto NO existe: el bundler resuelve el bare specifier
 * y el archivo queda FUERA del bundle de la app (0 diff en src/ — gates D58).
 */
let promesaCarga = null;
function cargarUmd() {
  if (promesaCarga) return promesaCarga;
  promesaCarga = new Promise((resolve, reject) => {
    if (typeof window !== "undefined" && typeof window.heic2any === "function") {
      resolve(window.heic2any);
      return;
    }
    const s = document.createElement("script");
    s.src = new URL("../../node_modules/heic2any/dist/heic2any.min.js", import.meta.url).href;
    s.onload = () => {
      if (typeof window.heic2any === "function") resolve(window.heic2any);
      else reject(new Error("heic2any UMD cargó sin exponer window.heic2any"));
    };
    s.onerror = () => reject(new Error("heic2any UMD no cargó (ruta node_modules no servida)"));
    document.head.appendChild(s);
  });
  return promesaCarga;
}
export default async function heic2any(...args) {
  const fn = await cargarUmd();
  return fn(...args);
}
