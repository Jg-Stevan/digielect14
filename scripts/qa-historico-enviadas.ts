/**
 * QA headless — KIT e65b-historico-enviadas-v1 §5: LEDGER PERSISTENTE de
 * enviadas («el histórico que sobrevive a la cola»). Funciones PURAS +
 * source-scan, sin red, sin DOM (mismo estilo de scripts/qa-dedup-enviadas.ts).
 *
 *   bun scripts/qa-historico-enviadas.ts
 *
 * Los 8 factores del kit §5 (mapa factor→bloque):
 *   F1 (misma sesión: re-subir → YA-ENVIADA por bytes) → Bloque 3 (T-3a
 *       alimenta el ledger en CADA envío + registrarEnviadaHistorico
 *       actualiza el índice EN MEMORIA al instante — mismo gesto) + Bloque 2
 *       (capa bytes consulta el índice fusionado — e65 intacto).
 *   F2 (sobrevive VACIAR — la prueba EXACTA del dueño: 46 re-subidos) →
 *       Bloque 5 (vaciar NO toca el ledger: cola.clear() solo «archivos»,
 *       store sin borrarHistorico; el índice reconstruye fusionando ledger).
 *       ADENDA e64p (kit C-2): con COLA_PERSISTENTE=false (MODO PRUEBAS) el
 *       ledger SÍ muere con vaciar()/carga — reversa declarada; el scan
 *       verifica el cableo CONDICIONAL (producción intacta).
 *   F3 (sobrevive RECARGA) → Bloque 2/5 (indiceEnviadasDe fusiona
 *       listarHistorico + cola; DB separada e14-masiva-historico-v1).
 *   F4 (re-foto sin OCR: bytes distintos, MISMO payload QR) → Bloque 4 (capa
 *       0: enviadaPorPayload ANTES de registrarQrPayload, marcarYaEnviada
 *       via "payload", return — OCR jamás se paga).
 *   F5 (escape del dueño: PROCESAR IGUAL manda) → Bloque 4/6 (guard
 *       !fila.forzarDedupOff en la rama T-4 + rama forzarDedupOff de la
 *       capa 0 + procesarIgual de e65 intacto — reproceso completo).
 *   F6 (sin falsos positivos: archivo nuevo procesa normal) → Bloque 2/6
 *       (igualdad EXACTA del payload, sin prefijos; el ledger SOLO se
 *       alimenta de desenlaces ENVIADOS — 4 guards verificados).
 *   F7 (gemelas en el MISMO lote: nunca doble OCR) → Bloque 4 (el lookup del
 *       ledger vive DENTRO de `if (!originalQr)` — el mapa de sesión de la
 *       e63m manda primero; reutilizarViaQr intacto).
 *   F8 (invariantes) → Bloque 6 (YA-ENVIADA sobrevive recarga · píldora
 *       esmeralda · informe yaEnviadas · llaves AUSENTES del informe de
 *       contenido y del envío · vaciar() llama borrarHistorico SOLO bajo
 *       !COLA_PERSISTENTE (e64p) · DB separada — cero migración).
 *
 * Nota honesta: el ledger vive en IndexedDB (browser-only) y NO corre
 * headless — su SEMÁNTICA se verifica aquí por source-scan por SÍMBOLO
 * (líneas reales de la rama). El flujo end-to-end en navegador (F1-F8 con
 * IDB real: enviar → vaciar → re-subir → YA-ENVIADA) queda para la mini-Fase
 * D del dueño (kit §6 — Fase D: vaciar + re-subir los 46).
 */
import { readFile } from "node:fs/promises";

let pasadas = 0;
let fallos = 0;
function ok(cond: boolean, etiqueta: string): void {
  console.log(`${cond ? "OK" : "FAIL"} · ${etiqueta}`);
  pasadas++;
  if (!cond) fallos++;
}

const RUTA = "src/lib/e14/masiva/";
const historico = await readFile(RUTA + "historico.ts", "utf8");
const store = await readFile(RUTA + "store.ts", "utf8");
const runner = await readFile(RUTA + "runner.ts", "utf8");
const cola = await readFile(RUTA + "cola.ts", "utf8");
const tipos = await readFile(RUTA + "tipos.ts", "utf8");
const masiva = await readFile("src/components/e14/screens/MasivaView.tsx", "utf8");
const informe = await readFile("src/lib/e14/informe.ts", "utf8");
const pkg = await readFile("package.json", "utf8");

// ---------- Bloque 1 — T-1: módulo ledger (DB separada, solo llaves) ----------

console.log("\n── Bloque 1 · T-1 historico.ts — ledger persistente ──");

ok(
  historico.includes('"use client";'),
  "T-1: módulo client-side (IndexedDB del navegador — mismo entorno que cola.ts)",
);

ok(
  historico.includes('DB_NOMBRE = "e14-masiva-historico-v1"') &&
    !historico.includes('DB_NOMBRE = "e14-masiva-v1"') &&
    cola.includes('DB_NOMBRE = "e14-masiva-v1"'),
  "F3/F8: DB SEPARADA e14-masiva-historico-v1 — la cola e14-masiva-v1 queda INTOCADA (cero migración)",
);

ok(
  historico.includes('const STORE = "llaves"; // keyPath "id" — un registro por fila enviada'),
  "T-1: store «llaves» — keyPath id (re-put IDEMPOTENTE por fila enviada)",
);

const entradaTipo = historico.match(/export type EntradaHistorica = \{([\s\S]*?)\};/);
ok(
  entradaTipo != null &&
    entradaTipo[1]!.includes("id: string;") &&
    entradaTipo[1]!.includes("ts: number;") &&
    entradaTipo[1]!.includes("hashBytes?: string;") &&
    entradaTipo[1]!.includes("hashDedup?: string;") &&
    entradaTipo[1]!.includes("payloadQr?: string;") &&
    entradaTipo[1]!.includes("serie?: string;") &&
    !/(Blob|acta|dataURL|foto|thumb)/.test(entradaTipo[1]!),
  "RL-e65b-1/L7: EntradaHistorica SOLO llaves (id/ts/hashBytes/hashDedup/payloadQr/serie) — JAMÁS Blob/acta/dataURL",
);

ok(
  historico.includes('serie?: string; // SOLO informativa'),
  "RL-e65b-8: serie en el ledger SOLO informativa (jamás llave de dedup)",
);

ok(
  historico.includes('typeof indexedDB === "undefined"') &&
    historico.includes('reject(new Error("SIN_INDEXEDDB"))'),
  "T-1: guard SIN_INDEXEDDB — rechazo CLARO (el caller decide — conservador)",
);

ok(
  historico.includes("let dbSingleton: IDBDatabase | null = null;") &&
    historico.includes("dbSingleton.onclose = () => {") &&
    historico.includes("dbSingleton = null;"),
  "T-1: singleton + onclose — MISMO patrón de abrirCola() en cola.ts",
);

ok(
  historico.includes("export async function registrarEntradaHistorico") &&
    historico.includes("store.put(e);") &&
    historico.includes("tx.oncomplete = () => resolve();"),
  "T-1: registrarEntradaHistorico — put readwrite + await tx.oncomplete (throw = el caller decide)",
);

ok(
  historico.includes("export async function listarHistorico") &&
    historico.includes("store.getAll()"),
  "T-1: listarHistorico — getAll() de llaves chicas (~100 B c/u; NUNCA retiene Blob)",
);

ok(
  historico.includes("export async function borrarHistorico") &&
    historico.includes("store.clear();") &&
    /import\s*\{[^}]*borrarHistorico/.test(store) && // e64p (C-1/C-2): importado — cableado SOLO bajo !COLA_PERSISTENTE
    !/import\s*\{[^}]*borrarHistorico/.test(runner) &&
    !/from "\.\/historico"/.test(cola),
  "RL-e65b-5 + e64p C-2: borrarHistorico importado SOLO por store (cableo condicional modo pruebas); runner/cola jamás lo conocen",
);

// ---------- Bloque 2 — T-2: índice fusionado + helpers (store.ts) ----------

console.log("\n── Bloque 2 · T-2 store — índice fusionado ledger+cola ──");

ok(
  // KIT e73-sondeo-qr-precoz-v1 (§C) — el bloque de import crece con el
  // índice por payload (actualizarIndicePayload + indiceEnviadasPorPayload):
  // MISMO módulo, MISMO patrón (D57 append — nada se reordena ni elimina).
  store.includes('import {\n  borrarHistorico,\n  listarHistorico,\n  registrarEntradaHistorico,') &&
    store.includes('actualizarIndicePayload,') &&
    store.includes('indiceEnviadasPorPayload,') &&
    store.includes('type EntradaHistorica,\n} from "./historico";'),
  "T-2a + e64p + e73: EntradaHistorica UNIFICADA — importada del módulo (bloque ampliado con borrarHistorico por e64p y con el índice por payload por e73 §C)",
);

ok(
  !/type EntradaHistorica = \{ id: string; hashBytes\?: string; hashDedup\?: string \};/.test(store),
  "T-2a: el tipo LOCAL duplicado de store.ts ya NO existe (una sola fuente de verdad)",
);

ok(
  store.includes('if (r.acta?.status !== "ENVIADA" && r.estado !== "YA-ENVIADA") return null;') &&
    store.includes("if (!r.hashBytes && !r.hashDedup && !r.qrPayload) return null;") &&
    store.includes("ts: r.agregadaEn,") &&
    store.includes("payloadQr: r.qrPayload,"),
  "T-2b/F6: mapper del índice — SOLO ENVIADA/YA-ENVIADA con ALGUNA llave (sin llave → fuera, jamás inventar)",
);

ok(
  store.includes("deLedger = await listarHistorico();") &&
    store.includes("for (const e of deLedger) porId.set(e.id, e);") &&
    store.includes("for (const e of deCola) porId.set(e.id, e); // la cola viva manda (más fresca)"),
  "T-2b/F3: índice FUSIONADO — ledger + cola, la cola viva manda (más fresca) al re-put por id",
);

ok(
  store.includes("if (COLA_PERSISTENTE) {\n    try {\n      deLedger = await listarHistorico();") &&
    store.includes("} catch {\n      deLedger = [];\n    }\n  }"),
  "M-e65b-2 + e64p C-3: ledger NO fatal (try/catch → cola viva) — lectura bajo COLA_PERSISTENTE; modo pruebas NO lo lee (cero memoria entre lotes)",
);

ok(
  store.includes("export async function registrarEnviadaHistorico") &&
    store.includes("await registrarEntradaHistorico(e);") &&
    store.includes("} catch {\n    return; // IDB caída — conservador, jamás tumba el envío (RL-e65b-3)") &&
    store.includes("if (indiceEnviadas) {") &&
    store.includes("if (i >= 0) indiceEnviadas[i] = entrada;\n    else indiceEnviadas.push(entrada);"),
  "T-2c/F1: registrarEnviadaHistorico — ÚNICO punto de crecimiento; fallo IDB tragado + cache EN MEMORIA actualizado al instante",
);

// WAVE3 §A.3 (feat/ledger-remoto-envios-v1) — ACTUALIZACIÓN DEL F-CHECK CON
// NOTA: la unión ViaYaEnviada se EXTIENDE con "payload-remoto" AL FINAL
// (contrato D57 — kit §A.3 literal: el veto REMOTO del ledger D1 viaja por
// esta puerta). Los valores previos quedan byte a byte en el MISMO orden.
ok(
  store.includes('export type ViaYaEnviada = "bytes" | "dhash" | "payload" | "payload-remoto";'),
  "RL-e65b-7/D57 + wave3 §A.3: ViaYaEnviada — \"payload\" y \"payload-remoto\" son valores NUEVOS AL FINAL de la unión (ledger D1)",
);

ok(
  store.includes("export async function marcarYaEnviada(") &&
    store.includes("qrPayload?: string,") &&
    store.includes("aceptarProcesando?: boolean,"),
  "T-2d: marcarYaEnviada EXPORTADA con qrPayload opcional (aditivo) + aceptarProcesando (M-e65b-3)",
);

ok(
  store.includes('estado: "YA-ENVIADA",\n      hashBytes: hashBytes ?? registro.hashBytes,\n      enviadaDe: enviadaDeId,\n      dedup: "ya-enviada",'),
  "F1/F3-e65: el write YA-ENVIADA lleva hashBytes + enviadaDe + dedup 'ya-enviada' (expresión e65 BYTE A BYTE — regresión cero)",
);

ok(
  store.includes("...(qrPayload ? { qrPayload } : {}), // e65b (T-2d) — aditivo (D57)") &&
    store.includes("void registrarEnviadaHistorico({\n    id,\n    ts: Date.now(),"),
  "T-2d/F6: la marca YA-ENVIADA TAMBIÉN alimenta el ledger (qrPayload estampado aditivo — cierra el gap pre-kit)",
);

ok(
  store.includes("if (!(aceptarProcesando === true && filaViva?.estado === \"PROCESANDO\")) {") &&
    store.includes("if (!filaViva || filaViva.estado !== \"PENDIENTE\") return false;"),
  "M-e65b-3: guard anti-zombi — callers e65 exigen PENDIENTE byte a byte; SOLO el caller T-4 (aceptarProcesando) admite su PROPIA fila PROCESANDO",
);

ok(
  store.includes("export async function enviadaPorPayload") &&
    store.includes("if (!payload) return null;") &&
    store.includes("(await indiceEnviadasDe()).find((h) => h.payloadQr === payload) ?? null;"),
  "T-2e/F6: enviadaPorPayload — igualdad EXACTA del payload (llave opaca, jamás prefijos — RL-e65b-8)",
);

ok(
  store.includes("return (await indiceEnviadasDe()).find((h) => h.payloadQr === payload) ?? null;\n  } catch {\n    return null;\n  }"),
  "RL-e65b-3: fallo del índice en enviadaPorPayload → null CONSERVADOR (la fila sigue su curso)",
);

// ---------- Bloque 3 — T-3: hooks de envío (runner + manuales) ----------

console.log("\n── Bloque 3 · T-3 hooks de envío — el ledger SOLO crece con ENVIADOS ──");

ok(
  runner.includes("void registrarEnviadaHistorico({\n        id: fila.id,\n        ts: Date.now(),\n        hashBytes: filaViva?.hashBytes ?? registro.hashBytes,\n        hashDedup: filaViva?.hashDedup ?? registro.hashDedup,\n        payloadQr: qrPayload ?? undefined,\n        serie: identidad?.serie ?? registro.serie ?? undefined,\n      }).catch(() => {});"),
  "T-3a/F1: envío PROPIO del runner alimenta el ledger — llaves hashDedup/hashBytes FRESCAS de la fila viva (HOTFIX H2 — recalibración aditiva del ancla: cadenaDedup persiste después de que el pipeline leyó el registro), payload/serie VIVOS de la corrida, fire-and-forget (RL-e65b-2/3)",
);

ok(
  runner.includes("payloadQr: qrPayload ?? undefined,") &&
    runner.indexOf("payloadQr: qrPayload ?? undefined,") > runner.indexOf("enviadaAuto = true;"),
  "T-3a: el hook vive DESPUÉS del desenlace ENVIADO (enviadaAuto = true — jamás alimenta con no-enviados)",
);

// ADENDA e66 (M-e66-1 — reversa documentada): la gemela REUTILIZADA ya NO
// alimenta el ledger (mandato P2 del plan e66: el historial registra SOLO
// envíos reales — antes la copia heredaba ENVIADA y entraba por T-3b).
// La protección de re-encolado de la gemela sobrevive vía la ENTRADA de la
// ORIGINAL en el ledger (payload-QR exacto + dhash cinta cierta ≤ 6).
// ADENDA e71 (P2.1 — kit e71-consolidación): la copia HEREDA el desenlace
// del original — ENVIADA/OPTIMA → DUPLICADA (regla e66 intacta); con
// rechazo → RECHAZADA heredada (el informe muestra RECHAZADA: 2, no
// DUPLICADA). El literal `actaCopia.status = "DUPLICADA";` pasó a la
// asignación condicional `actaCopia.status = copiaRechazada ?
// "RECHAZADA" : "DUPLICADA";` — misma invariancia (JAMÁS hereda el envío
// de la original; enviadoAutomaticamente null en AMBAS ramas).
ok(
  !runner.includes('if (actaCopia.status === "ENVIADA") {') &&
    runner.includes(
      'actaCopia.status = copiaRechazada ? "RECHAZADA" : "DUPLICADA";',
    ) &&
    runner.includes('const originalEnviada = actaCopia.status === "ENVIADA" || actaCopia.status === "OPTIMA";') &&
    runner.includes("actaCopia.enviadoAutomaticamente = null;"),
  "e66/M-e66-1 + e71/P2.1: la gemela JAMÁS hereda el envío (ENVIADA/OPTIMA → DUPLICADA; con rechazo → RECHAZADA heredada — informe RECHAZADA: 2), enviadoAutomaticamente null en ambas ramas",
);

ok(
  store.includes('if (actaNueva.status === "ENVIADA") {') &&
    store.includes("id: origenAbierto,") &&
    store.includes("id: fila.id,\n          ts: Date.now(),"),
  "T-3c/M-e65b-4: envíos MANUALES cableados — REVISIÓN (sincronizarAlVolver) y LOTE ADVERTENCIA (enviarLote) — mismos guards ENVIADA",
);

// ADENDA e66: el conteo baja de ≥2 a ≥1 — el hook T-3b de la gemela fue
// REVERSADO (M-e66-1); queda el hook de envío propio (T-3a), único punto
// fire-and-forget que queda en el runner.
ok(
  (runner.match(/\.catch\(\(\) => \{\}\)/g)?.length ?? 0) >= 1 &&
    !runner.includes("await registrarEnviadaHistorico"),
  "RL-e65b-2/3 + M-e66-1: TODOS los hooks restantes fire-and-forget (void + catch) — jamás await: el envío JAMÁS espera al ledger",
);

// ---------- Bloque 4 — T-4: capa 0 payload contra el histórico ----------

console.log("\n── Bloque 4 · T-4 capa 0 — re-fotos sin OCR, escape sagrado ──");

ok(
  runner.includes("if (!originalQr) {") &&
    runner.indexOf("const enviadaHist = await enviadaPorPayload(qrPayload);") >
      runner.indexOf("if (!originalQr) {") &&
    // ADENDA e71 (Opt-3): el registro pasó DENTRO de la sección crítica
    // (conExclusionMutua) y la closure usa la acotación qrPayloadSeguro —
    // el ORDEN del intent (lookup del ledger ANTES del registro, mapa e63m
    // manda primero — F7) queda intacto.
    runner.indexOf("registrarQrPayload(qrPayloadSeguro, fila.id);") >
      runner.indexOf("const enviadaHist = await enviadaPorPayload(qrPayload);"),
  "T-4/F4: el lookup del ledger corre en la rama SIN original de sesión y ANTES de registrarQrPayload (el mapa e63m manda primero — F7) [e71: registro en sección crítica con qrPayloadSeguro]",
);

ok(
  runner.includes("if (!fila.forzarDedupOff) {\n          const enviadaHist = await enviadaPorPayload(qrPayload);"),
  "F5/RL-e65b-6: forzarDedupOff manda SIEMPRE — PROCESAR IGUAL salta el lookup del ledger (escape del dueño sagrado)",
);

ok(
  runner.includes('"payload",') &&
    runner.includes("qrPayload,\n              true,") &&
    runner.includes("[e14] capa0-qr ya-enviada-historico"),
  "T-4/F4: marcarYaEnviada via \"payload\" + aceptarProcesando=true + traza ya-enviada-historico",
);

ok(
  runner.includes("return; // sin OCR, sin envío — YA-ENVIADA jamás vuelve a siguientePendiente (T-5 e65)"),
  "T-4/F4: hit del ledger → RETURN — el pipeline OCR JAMÁS se paga (tiempo de fila < 2 s)",
);

ok(
  runner.includes("enviadaHist.id !== fila.id &&"),
  "T-4 (defensa): jamás se apunta a sí misma (el re-encolado nace con id nuevo — ids únicos)",
);

ok(
  runner.includes('} else if (fila.forzarDedupOff) {') &&
    runner.includes("[e14] capa0-qr reprocesa-completo"),
  "F5: la rama forzarDedupOff de la capa 0 (reproceso completo) queda INTACTA — el escape también gana sobre la reutilización por sesión",
);

ok(
  runner.includes("(f.estado === \"PENDIENTE\" || f.estado === \"DUPLICADA\") &&") &&
    !runner.includes('f.estado === "YA-ENVIADA"'),
  "F8-e65: siguientePendiente solo toma PENDIENTE/DUPLICADA — la YA-ENVIADA de la capa 0 JAMÁS vuelve al runner (cero reproceso)",
);

// ---------- Bloque 5 — T-5: vaciar NO toca el histórico ----------

console.log("\n── Bloque 5 · T-5 vaciar — la cola es el taller, el envío es el hecho ──");

ok(
  store.includes("indiceEnviadas = null;") &&
    store.includes("REVERSA de D-e65-8 → D-e65b-1"),
  "T-5/F2: vaciar() invalida SOLO el cache de sesión — la REVERSA D-e65b-1 está declarada en el código",
);

const cuerpoVaciar = store.slice(store.indexOf("vaciar: async () => {"));

ok(
  /if \(!COLA_PERSISTENTE\) \{[\s\S]*?await borrarHistorico\(\)/.test(cuerpoVaciar) &&
    store.includes("indiceEnviadas = null;"),
  "RL-e65b-5 + e64p C-2: vaciar() llama borrarHistorico SOLO bajo !COLA_PERSISTENTE (reversa declarada en modo pruebas; producción D-e65b-1 intacta)",
);

ok(
  cola.includes("export async function vaciar(): Promise<void> {") &&
    cola.includes("store.clear();") &&
    !/historico/i.test(cola),
  "F2: vaciar() de la cola INTACTO — clear() solo del store «archivos» (la DB del ledger es OTRA)",
);

ok(
  store.includes("let indiceEnviadas: EntradaHistorica[] | null = null;") &&
    store.includes("if (indiceEnviadas) return indiceEnviadas;") &&
    store.includes("indiceEnviadas = [...porId.values()];"),
  "F3: el cache se reconstruye SOLO — y el rebuild FUSIONA ledger+cola (tras vaciar, el índice = histórico persistente)",
);

// ---------- Bloque 6 — F5/F6/F7/F8 invariantes + red lines ----------

console.log("\n── Bloque 6 · invariantes F5-F8 + RED LINES + D57 ──");

ok(
  store.includes("forzarDedupOff: true,") &&
    store.includes("enviadaDe: undefined,") &&
    store.includes('estado: "PENDIENTE",\n        dupOf: undefined'),
  "F5-e65: PROCESAR IGUAL intacto — PENDIENTE + forzarDedupOff + enviadaDe fuera (memoria e IDB); el reproceso corre el pipeline COMPLETO",
);

ok(
  store.includes("(await indiceEnviadasDe()).find((h) => h.payloadQr === payload)") &&
    !/payloadQr[^;\n]*\.?(startsWith|slice|includes)\(/.test(store) &&
    !/payloadQr[^;\n]*\.test\(/.test(store),
  "F6/RL-e65b-8: la decisión del payload es IGUALDAD EXACTA — sin prefijos, sin fuzzy, sin umbrales (RED LINE 10 heredada)",
);

ok(
  runner.includes("const originalQr =") &&
    runner.indexOf("if (!originalQr) {") < runner.indexOf("} else if (originalQr.estado === \"LISTA\""),
  "F7: el orden e63m queda INTACTO — mapa de sesión → forzarDedupOff → LISTA/DUPLICADA → PROCESANDO → PENDIENTE/ERROR; el ledger es SOLO el fallback de la rama sin-original",
);

ok(
  store.includes("hashBytes: r.hashBytes ?? null,") &&
    store.includes("...(r.estado === \"YA-ENVIADA\" ? { enviadaDe: r.enviadaDe ?? null } : {}),"),
  "F8-e65: YA-ENVIADA sobrevive la RECARGA (filaDeRegistro restaura hashBytes SIEMPRE + enviadaDe SOLO-YA-ENVIADA)",
);

ok(
  masiva.includes('return { label: "YA ENVIADA", clases: "border-emerald-500/60 text-emerald-300 bg-emerald-500/10" };') &&
    masiva.includes("YA ENVIADAS {yaEnviadas}"),
  "F8-e65: píldora + chip esmeralda YA ENVIADA intactos en la bandeja (la e65b no cambia la UI — el desenlace es el mismo)",
);

ok(
  informe.includes('yaEnviadas: filas.filter((f) => f.statusActa === "ENVIADA").length,') &&
    !informe.includes("hashBytes") &&
    !/EntradaHistorica|listarHistorico|registrarEnviadaHistorico/.test(informe),
  "F8/RL-e65b-8 + e71/P3.1: informe sin hashBytes/ledger — yaEnviadas ahora cuenta statusActa === ENVIADA (kit e71: el dueño la lee como «actas enviadas»; el estado YA-ENVIADA solo existe en re-subidas de la misma sesión y reportaba 0)",
);

ok(
  runner.includes("registrarEnvioMasiva(actaDesenlace)") &&
    store.includes("registrarEnvioMasiva(acta)") &&
    !/registrarEnvioMasiva\([^)]*(hashBytes|hashDedup|payloadQr|EntradaHistorica)/.test(store) &&
    !/registrarEnvioMasiva\([^)]*(hashBytes|hashDedup|payloadQr|EntradaHistorica)/.test(runner),
  "F8: el ENVÍO (registrarEnvioMasiva) queda byte a byte — las llaves del ledger jamás viajan al envío",
);

ok(
  !pkg.includes("indexeddb") && !pkg.includes("idb") && !pkg.includes("historico"),
  "RL-e65b-4: cero dependencias nuevas — IndexedDB vanilla (package.json/bun.lock INTACTOS)",
);

// WAVE3 C.2 (obs-informe-wave3-v1) — ACTUALIZACIÓN DEL F-CHECK CON NOTA:
// la unión dedup de tipos.ts se EXTIENDE con las puertas del veto AL FINAL
// (contrato D57): "ya-enviada-postocr" (H1) y "ya-enviada-copia" (traza
// visual sobre YA-ENVIADA — gap real lote 10). Los valores previos quedan
// byte a byte en el MISMO orden; nada se elimina ni reordena.
// KIT e73-sondeo-qr-precoz-v1 — 'qr-sondeo' entra AL FINAL (D57 append;
// todas las puertas del veto quedan byte a byte).
ok(
  tipos.includes(
    'dedup?: "v2" | "sin-match" | "identidad" | "visual-aplazada" | "qr"\n    | "ya-enviada" // e65-dedup-enviadas-v1 — match contra registro ENVIADO del histórico/cola (bytes/dhash cinta cierta) — valor NUEVO AL FINAL (contrato D57)\n    // WAVE3 C.2 (obs-informe-wave3-v1) — puertas del veto AL FINAL (D57):\n    // distinguen POR DÓNDE llegó el veto ya-enviada (gap real lote 10:\n    // filas YA-ENVIADA con dedup:"sin-match" — la puerta quedaba invisible).\n    | "ya-enviada-postocr" // H1 post-OCR (punto único de envío — el OCR ya se pagó)\n    | "ya-enviada-copia" // la traza visual de cadenaDedup aterrizó sobre un registro YA-ENVIADA (evidencia del veto preservada)\n    | "qr-sondeo"; // KIT e73-sondeo-qr-precoz-v1 (§B) — gemela por payload EXACTO leído en INGESTA (pre-pool; no paga slot/probe/OCR) — valor NUEVO AL FINAL (contrato D57)',
  ),
  "D57-e65+wave3+e73: la unión dedup de tipos.ts conserva TODOS sus valores en orden (e65b intacto) + puertas del veto AL FINAL (postocr/copia — wave3 C.2) + 'qr-sondeo' AL FINAL (e73 §B)",
);

ok(
  historico.includes("SOLO bajo !COLA_PERSISTENTE") && historico.includes("RL-e65b-5"),
  "RL-e65b-5 + e64p: la docstring del módulo declara el cableo CONDICIONAL (producción sin cablear · modo pruebas resetea — adenda honesta)",
);

// ---------- Resumen ----------

console.log(
  `\nQA historico-enviadas: ${pasadas - fallos}/${pasadas} OK${fallos ? " — HAY FALLOS" : " ✓"}`,
);
if (fallos) process.exit(1);
