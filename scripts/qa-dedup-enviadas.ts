/**
 * QA headless — KIT e65-dedup-enviadas-v1 §6: NO reprocesar imágenes ya
 * enviadas (por defecto). Funciones PURAS + source-scan, sin red, sin DOM,
 * determinista (mismo estilo de scripts/qa-qr-identidad.ts).
 *
 *   bun scripts/qa-dedup-enviadas.ts
 *
 * Los 8 casos del kit §6 (mapa caso→bloque):
 *   F1 (bytes→YA-ENVIADA, cero OCR/decode) → Bloque 2 (orden CAPA BYTES
 *       primero en cadenaDedup + marcarYaEnviada con continue que salta el
 *       dhash) + Bloque 1 (hash EXACTO determinista).
 *   F2 (recarga) → Bloque 3 (filaDeRegistro restaura hashBytes SIEMPRE y
 *       enviadaDe SOLO-YA-ENVIADA; RegistroMasiva persiste ambos — D57).
 *   F3 (registro pre-kit sin hashBytes → dhash Hamming 0 → YA-ENVIADA) →
 *       Bloque 2 (índice admite hashDedup sin hashBytes + amplificación con
 *       el índice + decisión por lectura del registro).
 *   F4 (archivo nuevo → flujo intacto + hashBytes estampado) → Bloque 2
 *       (write #2 con hashBytes: bytes ?? registro.hashBytes) + Bloque 1
 *       (contenido distinto → hash distinto).
 *   F5 (PROCESAR IGUAL sobre YA-ENVIADA) → Bloque 3 (procesarIgual extiende:
 *       PENDIENTE + forzarDedupOff + enviadaDe fuera en memoria E IDB;
 *       botón en MasivaView habilitado).
 *   F6 (dhash 3-6 contra enviada → NO marca) → Bloque 2 (la banda 3..6
 *       APLAZADA se resuelve ANTES de la decisión YA-ENVIADA — cinta intacta).
 *   F7 (original en cola SIN enviar → DUPLICADA como hoy) → Bloque 2 (la
 *       decisión pregunta el estado del registro; sin ENVIADA → rama
 *       DUPLICADA byte a byte).
 *   F8 (vaciar → reprocesa todo + índice invalidado) → Bloque 3 (vaciar pone
 *       indiceEnviadas = null; el índice se reconstruye LIVIANO desde IDB).
 * Más: Bloque 4 — RED LINES §4 (RL-e65-1..8) + contrato D57 (aditivos AL
 * FINAL) + package.json/bun.lock INTOCABLES (RL-e65-8).
 *
 * Nota honesta: cadenaDedup/marcarYaEnviada viven dentro de store.ts
 * ("use client" + zustand + IndexedDB) y NO corren headless — su SEMÁNTICA
 * se verifica aquí por source-scan por SÍMBOLO (líneas reales de la rama) y
 * la CAPA BYTES (hashBytesDeArchivo — el único módulo nuevo) se ejercita
 * RUNTIME con vectores reales de SHA-256. El flujo end-to-end en navegador
 * (F1-F8 con IDB real) queda para la mini-Fase D del dueño (kit §6).
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { hashBytesDeArchivo } from "../src/lib/e14/masiva/dedup";

let pasadas = 0;
let fallos = 0;
function ok(cond: boolean, etiqueta: string): void {
  console.log(`${cond ? "OK" : "FAIL"} · ${etiqueta}`);
  pasadas++;
  if (!cond) fallos++;
}

const RUTA = "src/lib/e14/masiva/";
const store = await readFile(RUTA + "store.ts", "utf8");
const tipos = await readFile(RUTA + "tipos.ts", "utf8");
const runner = await readFile(RUTA + "runner.ts", "utf8");
const dedup = await readFile(RUTA + "dedup.ts", "utf8");
const cola = await readFile(RUTA + "cola.ts", "utf8");
const masiva = await readFile("src/components/e14/screens/MasivaView.tsx", "utf8");
const informe = await readFile("src/lib/e14/informe.ts", "utf8");
const pkg = await readFile("package.json", "utf8");

// ---------- Bloque 1 — CAPA BYTES runtime (hashBytesDeArchivo) ----------

console.log("\n── Bloque 1 · hashBytesDeArchivo (SHA-256 exacto, runtime) ──");

const B_A = new TextEncoder().encode("abc");
const B_B = new TextEncoder().encode("abd");
const f1 = new File([B_A], "a.jpg");
const f2 = new File([B_A.slice()], "copia.jpg"); // mismos bytes, otro File
const f3 = new File([B_B], "b.jpg");

const h1 = await hashBytesDeArchivo(f1);
const h2 = await hashBytesDeArchivo(f2);
const h3 = await hashBytesDeArchivo(f3);
const vector = createHash("sha256").update(B_A).digest("hex");

ok(h1 === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  "vector conocido: SHA-256('abc') EXACTO (64 hex)");
ok(h1 === vector, "hashBytes == node:crypto sha256 (misma semántica)");
ok(h1 === h2 && h1 !== null, "determinismo: mismos bytes → MISMO hash (dedup EXACTO)");
ok(h1 !== h3, "contenido distinto → hash distinto (F4 — sin falsos YA-ENVIADA)");
ok(!!h1 && h1.length === 64 && /^[0-9a-f]{64}$/.test(h1),
  "formato: hex minúsculas de 64 (igualdad EXACTA posible — RL-e65-5)");

// F4 — archivo grande (~8 MB, escala real del dueño): determinismo + coste.
const grande = new Uint8Array(8 * 1024 * 1024);
grande[0] = 0xff; grande[1] = 0xd8; // firma JPEG
const fg1 = new File([grande], "g1.jpg");
const fg2 = new File([grande.slice()], "g2.jpg");
const t0 = Date.now();
const hg1 = await hashBytesDeArchivo(fg1);
const ms = Date.now() - t0;
const hg2 = await hashBytesDeArchivo(fg2);
ok(hg1 !== null && hg1 === hg2 && ms < 2000,
  `8 MB: determinista y barato (${ms} ms < 2 s — kit ~50-200 ms, orden OK)`);

// Conservador — subtle ausente → null (RL-e65-3), sin throw.
let hSinSubtle: string | null | undefined;
const cryptoOrig = globalThis.crypto;
try {
  Object.defineProperty(globalThis, "crypto", {
    value: { ...cryptoOrig, subtle: undefined },
    configurable: true,
  });
  hSinSubtle = await hashBytesDeArchivo(new File([B_A], "x.jpg"));
} catch (e) {
  hSinSubtle = `THREW:${String(e)}`;
} finally {
  Object.defineProperty(globalThis, "crypto", {
    value: cryptoOrig,
    configurable: true,
  });
}
ok(hSinSubtle === null, "subtle ausente → null conservador (jamás tumba el encolado)");

// ---------- Bloque 2 — cadenaDedup: orden, índice, cinta (source-scan) ----------

console.log("\n── Bloque 2 · cadenaDedup ampliada (source-scan por símbolo) ──");

const iBytes = store.indexOf("const bytes = await hashBytesDeArchivo(entrada.archivo);");
const iDhash = store.indexOf("const hash = await dhashDeArchivo(entrada.archivo);");
ok(iBytes > -1 && iDhash > -1 && iBytes < iDhash,
  "F1: CAPA BYTES corre PRIMERO (SHA-256 sin decode antes del dhash — D-e65-5)");

ok(
  store.includes("if (await marcarYaEnviada(entrada.id, hitHistorico.id, \"bytes\", bytes)) continue;") &&
    store.includes("if (await marcarYaEnviada(entrada.id, viva.id, \"bytes\", bytes)) continue;"),
  "F1: match bytes (histórico o viva enviada) → YA-ENVIADA y continue SIN dhash (cero decode, cero OCR)",
);

ok(
  store.includes("regViva.acta?.status === \"ENVIADA\" ||\n                regViva.estado === \"YA-ENVIADA\""),
  "F7-guard: match bytes contra cola viva SOLO cuenta si el registro está ENVIADO (verificación por leerRegistro)",
);

ok(
  // e65b (ADENDA — kit e65b-historico-enviadas T-2b): la llave del índice se
  // amplió con `!r.qrPayload` (payload QR como tercera llave de dedup —
  // ADITIVO al final, D57). El intent del check es INTACTO: solo enviadas
  // CON llave entran; sin llave → fuera (jamás inventar).
  store.includes("if (!r.hashBytes && !r.hashDedup && !r.qrPayload) return null;") &&
    store.includes("r.acta?.status !== \"ENVIADA\" && r.estado !== \"YA-ENVIADA\""),
  "F3/D-e65-3: índice LIVIANO — solo enviadas CON llave; sin llave → fuera (jamás inventar) [e65b: llave ampliada con qrPayload]",
);

ok(
  store.includes("listarMapeados<EntradaHistorica>((r) => {") &&
    !store.includes("hashBytes: r.hashBytes, hashDedup: r.hashDedup, archivo"),
  "D-e65-3/lección L7: el mapper del índice NO retiene Blob ni acta (solo {id, hashBytes?, hashDedup?})",
);

ok(
  store.includes("if (d <= DEDUP_HAMMING_MAX && (original === null || d < hamming)) {") &&
    store.includes("original = { id: h.id, agregadaEn: 0 };"),
  "D-e65-6: amplificación del índice con la MISMA cinta (Hamming ≤ 6); gana solo si es estrictamente más cerca",
);

ok(
  store.includes("if (hamming > DEDUP_CINTA_CIERTA) {") &&
    store.indexOf("if (hamming > DEDUP_CINTA_CIERTA) {") <
      store.indexOf("let enviadaDeId: string | null = null;"),
  "F6/RL-e65-4: la banda 3..6 APLAZADA se resuelve ANTES de la decisión YA-ENVIADA (cinta cierta manda — e63k intacto)",
);

ok(
  store.includes("regOriginal.acta?.status === \"ENVIADA\" ||\n            regOriginal.estado === \"YA-ENVIADA\"") &&
    store.includes("enviadaDeId = null; // conservador → DUPLICADA como hoy"),
  "F7: cinta cierta pregunta el ESTADO del registro original; lectura que falla → DUPLICADA (conservador, hoy)",
);

ok(
  store.includes("if (originalDelIndice) {\n        enviadaDeId = original.id;"),
  "F3: original del ÍNDICE histórico → YA-ENVIADA por construcción (registros previos al kit cubiertos por dhash)",
);

ok(
  store.includes("{ ...registro, hashDedup: hash, hashBytes: bytes ?? registro.hashBytes, ...trazaDedup }"),
  "F4/D-e65-4: hashBytes estampado en el MISMO write del hashDedup (cero writes extra; próximo re-encolado matchea por bytes)",
);

ok(
  store.includes("estado: \"YA-ENVIADA\",\n      hashBytes: hashBytes ?? registro.hashBytes,\n      enviadaDe: enviadaDeId,\n      dedup: \"ya-enviada\","),
  "F1/F3: el write YA-ENVIADA lleva hashBytes + enviadaDe + dedup 'ya-enviada' (traza honesta del desenlace)",
);

const marcaDupIdx = store.indexOf('estado: "DUPLICADA", dupOf: original.id');
ok(marcaDupIdx > -1, "F7: la marca DUPLICADA sigue BYTE-IDÉNTICA (regresión cero)");

ok(
  store.includes("if (!filaViva || filaViva.estado !== \"PENDIENTE\") return false;") &&
    store.includes("registro = await leerRegistro(id);"),
  "Guards anti-zombi en marcarYaEnviada: fila viva + PENDIENTE + registro leíble (mismo patrón de la marca DUPLICADA)",
);

ok(
  !/marcarYaEnviada[\s\S]*?acta:\s*\{/.test(store.slice(store.indexOf("async function marcarYaEnviada"), store.indexOf("async function marcarYaEnviada") + 1800)),
  "RL-e65-2: YA-ENVIADA NO copia acta (SOLO-VISUAL — sin statusActa, sin envío)",
);

// ---------- Bloque 3 — recarga / escape / vaciar / vista / informe ----------

console.log("\n── Bloque 3 · recarga, PROCESAR IGUAL, vaciar, bandeja, informe ──");

ok(
  store.includes("hashBytes: r.hashBytes ?? null,") &&
    store.includes("...(r.estado === \"YA-ENVIADA\" ? { enviadaDe: r.enviadaDe ?? null } : {}),"),
  "F2: filaDeRegistro restaura hashBytes SIEMPRE y enviadaDe SOLO-YA-ENVIADA (la marca sobrevive la recarga)",
);

ok(
  store.includes("indiceEnviadas = null;") &&
    store.lastIndexOf("indiceEnviadas = null;") > store.indexOf("vaciar: async () => {") &&
    store.includes("if (indiceEnviadas) return indiceEnviadas;"),
  "F8/D-e65-8 + e64p: vaciar() invalida el índice (la ÚLTIMA invalidación vive en vaciar; cargarFilas modo pruebas también la reinicia — la recarga reconstruye)",
);

ok(
  store.includes("enviadaDe: null,\n      forzarDedupOff: true,") &&
    store.includes("enviadaDe: undefined,\n        forzarDedupOff: true,"),
  "F5: procesarIgual extiende a YA-ENVIADA — PENDIENTE + forzarDedupOff + enviadaDe FUERA (memoria e IDB — RL-e65-7)",
);

ok(
  runner.includes("(f.estado === \"PENDIENTE\" || f.estado === \"DUPLICADA\")") &&
    !runner.includes("\"YA-ENVIADA\""),
  "F5/D-e65-7: siguientePendiente solo toma PENDIENTE/DUPLICADA — YA-ENVIADA jamás entra al runner (cero reproceso)",
);

ok(
  masiva.includes("case \"YA-ENVIADA\":") &&
    masiva.includes("label: \"YA ENVIADA\", clases: \"border-emerald-500/60 text-emerald-300 bg-emerald-500/10\""),
  "T-7: píldora YA ENVIADA (esmeralda — paleta de estado del repo)",
);

ok(
  masiva.includes("f.estado === \"YA-ENVIADA\" && (") &&
    masiva.includes("<span className=\"text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/60 text-emerald-300 bg-emerald-500/10\">"),
  "T-7: chip YA ENVIADA junto al chip DUPLICADA",
);

ok(
  masiva.includes("const yaEnviadas = filas.filter((f) => f.estado === \"YA-ENVIADA\").length;") &&
    masiva.includes("{yaEnviadas > 0 && <> · YA ENVIADAS {yaEnviadas}</>}"),
  "T-7: contador YA ENVIADAS en la línea de resumen (solo si > 0)",
);

ok(
  masiva.includes("f.estado === \"LISTA\" || f.estado === \"ERROR\" || f.estado === \"YA-ENVIADA\""),
  "T-7: terminadas incluye YA-ENVIADA (cuenta como cerrada — cero pipeline)",
);

ok(
  masiva.includes("(f.estado === \"DUPLICADA\" || f.estado === \"YA-ENVIADA\") && ("),
  "F5/T-7: PROCESAR IGUAL habilitado sobre YA-ENVIADA (escape del dueño)",
);

ok(
  !masiva.includes("f.estado === \"YA-ENVIADA\" || f.estado === \"PENDIENTE\"") &&
    masiva.includes("(f.estado === \"PENDIENTE\" || f.estado === \"DUPLICADA\") &&"),
  "T-7: colaVida/enColaVida INTACTOS — YA-ENVIADA no entra al contador de cola (no se procesa nada)",
);

ok(
  informe.includes("| \"ya-enviada\" | null;") &&
    informe.includes('yaEnviadas: filas.filter((f) => f.statusActa === "ENVIADA").length,'),
  "T-8 + e71/P3.1: informe export-only — unión dedup con 'ya-enviada' intacta; contador yaEnviadas ahora cuenta statusActa === ENVIADA (kit e71: reportaba 0 porque YA-ENVIADA solo nace en re-subidas de la misma sesión)",
);

ok(!informe.includes("hashBytes"),
  "RL-e65-1: el informe JAMÁS exporta hashBytes (llave interna de dedup — cero contenido)");

// ---------- Bloque 4 — RED LINES + contrato D57 + dependencias ----------

console.log("\n── Bloque 4 · RED LINES e65 + contrato D57 + dependencias ──");

ok(
  tipos.includes("| \"YA-ENVIADA\"; // e65-dedup-enviadas-v1") &&
    tipos.indexOf("| \"YA-ENVIADA\"") > tipos.indexOf("\"DUPLICADA\""),
  "RL-e65-6/D57: YA-ENVIADA es valor NUEVO AL FINAL de EstadoEntrada (registros previos siguen leyéndose)",
);

ok(
  tipos.includes("| \"ya-enviada\"; // e65-dedup-enviadas-v1") &&
    tipos.indexOf("\"ya-enviada\"") > tipos.indexOf("\"qr\""),
  "RL-e65-6/D57: 'ya-enviada' AL FINAL de la unión dedup (RegistroMasiva)",
);

ok(
  tipos.includes("hashBytes?: string | null;\n  /** e65-dedup-enviadas-v1: id del registro YA ENVIADO") &&
    tipos.includes("enviadaDe?: string | null;\n}") &&
    tipos.includes("hashBytes?: string;\n  /** e65-dedup-enviadas-v1: id del registro enviado matcheado"),
  "RL-e65-6/D57: hashBytes/enviadaDe son los ÚLTIMOS campos de FilaMasiva y RegistroMasiva",
);

ok(
  dedup.includes("JAMÁS\n *  identidad del acta, JAMÁS viaja al envío") &&
    store.includes("f.hashBytes === bytes") &&
    store.includes("h.hashBytes === bytes"),
  "RL-e65-1/5: hashBytes SOLO llave de dedup con igualdad EXACTA (=== del hex completo — sin prefijos, sin fuzzy)",
);

ok(
  dedup.includes("DEDUP_HAMMING_MAX = 6") &&
    !dedup.includes("DEDUP_HAMMING_MAX = 7") &&
    store.includes("d <= DEDUP_HAMMING_MAX"),
  "RL-e65-5: DEDUP_HAMMING_MAX = 6 byte-idéntico (el dhash no cambia su umbral)",
);

ok(
  !store.includes("crypto.subtle.digest") ||
    store.indexOf("crypto.subtle.digest") === -1,
  "RL-e65-8/D-e65-1: el SHA-256 vive SOLO en dedup.ts (store.ts lo consume — cero duplicación del mecanismo)",
);

ok(
  !pkg.includes("sha.js") && !pkg.includes("crypto-js") && !pkg.includes("hash-wasm"),
  "RL-e65-8/D-e65-1: cero dependencias nuevas (crypto.subtle NATIVO — package.json intacto)",
);

ok(
  cola.includes("export async function vaciar(): Promise<void> {") &&
    !cola.includes("indiceEnviadas"),
  "D-e65-8: cola.ts INTACTO — la invalidación del índice vive en el store (la capa de datos no sabe del índice)",
);

ok(
  dedup.includes("e65-dedup-enviadas-v1 — CAPA BYTES (SHA-256 exacto)") &&
    dedup.includes("export async function hashBytesDeArchivo"),
  "T-1: hashBytesDeArchivo exportada al final de dedup.ts (funciones e63m/D65 intactas arriba)",
);

// ---------- resultado ----------

console.log(`\nQA dedup-enviadas: ${pasadas - fallos}/${pasadas} OK`);
if (fallos > 0) process.exit(1);
