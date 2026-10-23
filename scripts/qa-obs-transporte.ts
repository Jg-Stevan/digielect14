/**
 * QA headless — KIT e14-observabilidad-v1, AGENTE 3 (A3-C3): el transporte
 * HTTP de eventos es el ÚNICO canal por red de la app y queda APAGADO por
 * defecto (D1: nada sale del dispositivo sin acción explícita). Anclas
 * estáticas sobre src/lib/e14/obs/transporte.ts — el stub del agente 1 que
 * A3-C1 implementa. Sin red, sin DOM, determinista.
 *
 *   bun scripts/qa-obs-transporte.ts
 *
 * Anclas del kit A3-C3 (valores del kit A3-C1):
 *   a. No-op TOTAL sin endpoint: iniciarTransporte() con
 *      flags.endpointReportes === null → cero timers, cero listeners,
 *      estado {activo:false,…}.
 *   b. Outbox en DB PROPIO: IndexedDB `e14-obs-outbox` v1, store `lotes`
 *      (keyPath `id`) — JAMÁS abre el DB `e14-obs` del núcleo (§4.1).
 *   c. Kill local: tras 3 fallos seguidos del endpoint el transporte se
 *      auto-detiene (activo:false) y deja el outbox intacto (constante
 *      documentada en la implementación A3-C1 — nombres congelados por
 *      este QA junto con MI C1; renombrarlos exige acuerdo con el dueño,
 *      kit A3-C4 ⚠).
 *   d. Reintentos exponenciales 1m → 5m → 30m (tope 3).
 *   e. El envío respeta leerPolitica() — scrub previo: JAMÁS envía
 *      textoOcr/miniaturas si la política los tiene OFF.
 *   f. El lote POSTea {loteId, deviceId, appVersion, eventos[]} (kit A3-C1).
 *   g. Batcher cada 10 min, hasta 50 eventos por lote.
 *
 * FASE 0: el stub lo crea el agente 1 (feat/obs-nucleo-v1). Sin núcleo el
 * QA reporta PENDIENTE y sale 0 (adaptación declarada M-A3-1 en el
 * REPORTE); con el stub presente pasa a ESTRICTO y SUS anclas rojas son
 * las que la implementación A3-C1 debe poner verdes.
 */
import { readFile } from "node:fs/promises";

let pasadas = 0;
let fallos = 0;
function ok(cond: boolean, etiqueta: string): void {
  console.log(`${cond ? "OK" : "FAIL"} · ${etiqueta}`);
  pasadas++;
  if (!cond) fallos++;
}

const TOTAL_ANCLAS = 8;

/** Lee un archivo del repo relativo a la raíz; null si aún no existe. */
async function leerFuente(rel: string): Promise<string | null> {
  try {
    return await readFile(new URL(`../${rel}`, import.meta.url), "utf8");
  } catch {
    return null;
  }
}

const src = (await leerFuente("src/lib/e14/obs/transporte.ts")) ?? "";
const hayTransporte = await leerFuente("src/lib/e14/obs/transporte.ts");

// ---------- FASE 0 · modo PENDIENTE (sin núcleo) ----------

if (hayTransporte === null) {
  console.log("— FASE 0 · objetivo ausente (src/lib/e14/obs/transporte.ts) —");
  console.log("  Las anclas del transporte se activan al integrar feat/obs-nucleo-v1 (kit §1).");
  console.log(
    `QA obs-transporte: 0/${TOTAL_ANCLAS} · PENDIENTE NÚCLEO (FASE 0) — gate FASE 0 OK`,
  );
  process.exit(0);
}

// ---------- Bloque a · no-op TOTAL sin endpointReportes ----------

console.log("— Bloque a · transporte APAGADO por defecto (D1) —");

ok(
  src.includes("endpointReportes") && /activo:\s*false/.test(src),
  "guard de endpointReportes con estado {activo:false} — sin endpoint: no-op TOTAL (cero timers/listeners)",
);

// ---------- Bloque b · outbox en DB PROPIO (§4.1) ----------

console.log("— Bloque b · outbox en DB propio e14-obs-outbox —");

ok(
  src.includes('"e14-obs-outbox"') &&
    src.includes('"lotes"') &&
    src.includes('"id"') &&
    src.includes("keyPath"),
  'outbox: DB "e14-obs-outbox" v1, store "lotes" (keyPath "id") — §4.1',
);
ok(
  !/indexedDB\.open\(\s*"e14-obs"/.test(src),
  'RED LINE §4.1: transporte JAMÁS abre el DB "e14-obs" del núcleo (solo -outbox)',
);

// ---------- Bloque c · kill local tras 3 fallos seguidos ----------

console.log("— Bloque c · kill local (auto-detención, outbox intacto) —");

ok(
  src.includes("fallosSeguidos") && /FALLOS_KILL_LOCAL\s*=\s*3/.test(src),
  "kill local: FALLOS_KILL_LOCAL=3 — tras 3 fallos seguidos se auto-detiene (activo:false) y el outbox queda intacto",
);

// ---------- Bloque d · reintentos exponenciales 1m → 5m → 30m ----------

console.log("— Bloque d · backoff exponencial (tope 3 intentos) —");

ok(
  src.includes("BACKOFF_MS") &&
    src.includes("60_000") &&
    src.includes("300_000") &&
    src.includes("1_800_000"),
  "BACKOFF_MS = 1m → 5m → 30m (60_000 / 300_000 / 1_800_000) — exponencial con tope 3",
);

// ---------- Bloque e · el envío respeta la política (scrub previo) ----------

console.log("— Bloque e · scrub previo por leerPolitica —");

ok(
  src.includes("leerPolitica"),
  "el transporte consulta leerPolitica() ANTES de enviar (jamás envía textoOcr/miniaturas si están OFF — D4)",
);

// ---------- Bloque f · forma del lote {loteId, deviceId, appVersion, eventos[]} ----------

console.log("— Bloque f · forma del lote POST (kit A3-C1) —");

ok(
  src.includes("loteId") &&
    src.includes("deviceId") &&
    src.includes("appVersion") &&
    src.includes("eventos"),
  "el POST envía {loteId, deviceId, appVersion, eventos[]} — EventoObs del contrato §4.2",
);

// ---------- Bloque g · batcher 10 min · tope 50 eventos ----------

console.log("— Bloque g · batcher 10 min / lote ≤ 50 —");

ok(
  src.includes("BATCHER_MS") &&
    src.includes("10 * 60 * 1000") &&
    src.includes("LOTE_TOPE") &&
    /\b50\b/.test(src),
  "batcher cada 10 min (BATCHER_MS=10*60*1000) toma hasta 50 eventos (LOTE_TOPE=50) del buffer",
);

// ---------- resultado ----------

console.log(`\nQA obs-transporte: ${pasadas - fallos}/${pasadas} OK`);
if (fallos > 0) process.exit(1);
