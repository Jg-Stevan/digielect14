/**
 * sincronizar-vendor.mjs — materializa en `public/` los binarios que ya vienen
 * dentro de los paquetes npm: runtime de ONNX Runtime, núcleos y worker de
 * Tesseract, y el wasm del lector de zxing.
 *
 * PROBLEMA: eran copia exacta de `node_modules/` y estaban COMMITEADOS. El repo
 * pesaba ~27 MB más por bytes que cualquier clon ya descarga al hacer
 * `bun install`, y además se volvían obsoletos en cuanto subía la versión del
 * paquete (el `.wasm` viejo servido con la librería nueva = fallo en runtime
 * del OCR, no en el build).
 *
 * SOLUCIÓN: el vendor se genera, no se versiona. Este script copia los
 * artefactos que el navegador necesita en build/dev y falla duro si el
 * paquete instalado no coincide con el que declara `package.json`.
 *
 * NO cubre lo que no está en npm (OpenCV y los modelos OCR): eso lo baja
 * `preparar-assets.mjs` con URL y SHA-256 fijados.
 *
 * Uso:  bun scripts/sincronizar-vendor.mjs
 * (corre solo: `preparar` → `predev`, `prebuild` y el step de CI)
 * Idempotente: bytes iguales ⇒ no reescribe; `next build` vuelve a copiar
 * `public/` a `out/` y por eso el export sigue trayendo el wasm.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf-8"));

// Cada entrada: paquete npm → archivo dentro del paquete → ruta servida.
// Los `.wasm` crudos de tesseract.js-core NO se copian: el worker solo importa
// los `.wasm.js` (wasm embebido en base64) — ver src/lib/e14/ocr/tesseract.ts.
const COPIAS = [
  {
    paquete: "onnxruntime-web",
    origen: "dist/ort-wasm-simd-threaded.mjs",
    destino: "public/vendor/onnxruntime/ort-wasm-simd-threaded.mjs",
  },
  {
    paquete: "onnxruntime-web",
    origen: "dist/ort-wasm-simd-threaded.wasm",
    destino: "public/vendor/onnxruntime/ort-wasm-simd-threaded.wasm",
  },
  { paquete: "tesseract.js", origen: "dist/worker.min.js", destino: "public/vendor/tesseract/worker.min.js" },
  {
    paquete: "tesseract.js-core",
    origen: "tesseract-core-lstm.wasm.js",
    destino: "public/vendor/tesseract/tesseract-core-lstm.wasm.js",
  },
  {
    paquete: "tesseract.js-core",
    origen: "tesseract-core-simd-lstm.wasm.js",
    destino: "public/vendor/tesseract/tesseract-core-simd-lstm.wasm.js",
  },
  {
    paquete: "zxing-wasm",
    origen: "dist/reader/zxing_reader.wasm",
    destino: "public/wasm/zxing_reader.wasm",
  },
];

// Rutas que versiones anteriores dejaron en clones viejos y que ya nadie pide
// (el worker importa los `.wasm.js`, no los `.wasm`).
const OBSOLETOS = [
  "public/vendor/tesseract/tesseract-core-lstm.wasm",
  "public/vendor/tesseract/tesseract-core-simd-lstm.wasm",
];

for (const paquete of new Set(COPIAS.map((c) => c.paquete))) {
  const dir = join(RAIZ, "node_modules", paquete);
  if (!existsSync(dir)) {
    console.error(`BLOQUEADA: no hay node_modules/${paquete} — corre \`bun install\` primero.`);
    process.exit(1);
  }
  // Un pin exacto en package.json es un contrato: si el árbol instalado no lo
  // cumple, el binario servido no es el que se probó.
  const declarada = pkg.dependencies?.[paquete] ?? pkg.devDependencies?.[paquete];
  const instalada = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")).version;
  if (declarada && /^\d/.test(declarada) && declarada !== instalada) {
    console.error(
      `BLOQUEADA: ${paquete} instalado ${instalada} ≠ declarado ${declarada} en package.json — ` +
        "hace falta `bun install` con el lockfile del repo.",
    );
    process.exit(1);
  }
}

let copiados = 0;
let omitidos = 0;
for (const { paquete, origen, destino } of COPIAS) {
  const src = join(RAIZ, "node_modules", paquete, origen);
  if (!existsSync(src)) {
    console.error(
      `BLOQUEADA: ${origen} no está en ${paquete} — la distribución del paquete cambió; ` +
        "revisa qué variante necesita ahora el pipeline antes de desplegar.",
    );
    process.exit(1);
  }
  const dst = join(RAIZ, destino);
  if (existsSync(dst) && statSync(dst).size === statSync(src).size) {
    omitidos++;
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  copiados++;
}

let borrados = 0;
for (const ruta of OBSOLETOS) {
  const dst = join(RAIZ, ruta);
  if (existsSync(dst)) {
    rmSync(dst);
    borrados++;
  }
}

const versiones = [...new Set(COPIAS.map((c) => c.paquete))]
  .map((n) => `${n}@${JSON.parse(readFileSync(join(RAIZ, "node_modules", n, "package.json"), "utf-8")).version}`)
  .join(" · ");
const totalMB = (
  COPIAS.reduce((acc, { destino }) => acc + statSync(join(RAIZ, destino)).size, 0) / 1048576
).toFixed(1);
console.log(
  `OK vendor npm (${versiones}) · ${COPIAS.length} archivos · ${totalMB} MB ` +
    `(${copiados} copiados, ${omitidos} ya estaban${borrados ? `, ${borrados} obsoletos borrados` : ""})`,
);
