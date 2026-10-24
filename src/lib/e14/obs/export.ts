/**
 * KIT e14-observabilidad-v1 (A1-C6) — export MANUAL del reporte de
 * observabilidad. D1 (REGLA DE ORO §2.2): NADA sale del dispositivo sin
 * acción explícita — no hay autosend, no hay backend; el dueño pulsa
 * «descargar» y elige ZIP/JSON.
 *
 * · construirReporte() — ReporteSesion del contrato §4.2:
 *     meta (identidad+política) · dispositivo (snapshot vivo) ·
 *     erroresAgrupados (buffer) · perfResumen (agregado de las ACTAS del
 *     store con diagnostico — NO de eventos) · saludMuestras (buffer) ·
 *     uso (contadores mergeados).
 * · descargarReporte(formato, vaciarDespues) — JSON = blob directo; ZIP =
 *   patrón EXACTO de informe.ts (fflate STORE {level:0} async + cast
 *   Uint8Array<ArrayBuffer>) con carpeta `muestras/` SOLO si
 *   politica.miniaturas está ON (D4: default OFF — scrub por contrato).
 *   Nombre: reporte-observabilidad-YYYYMMDD-HHmm.json|zip.
 *
 * SCRUB (D4): textoOcr OFF (default) → el reporte NO contiene lectura OCR
 * en ningún campo (por diseño el ReporteSesion no tiene campo de texto);
 * miniaturas OFF (default) → el ZIP no lleva muestras. Sin excepciones.
 */
import { eventosPorDigest, leerEventos, purgarBuffer } from "./buffer";
import { resumenHangsDe } from "./hang"; // ANEXO Agente C (Pieza 2)
import { obtenerDispositivo } from "./dispositivo";
// §G.3 — el id del acta YA llega hasheado (el token actaId plano jamás
// aparece aquí — qa-obs-privacidad bloque d: solo captura.ts lo toca).
import { hashDeActaIdDe } from "./captura";
import { appVersion, idDispositivo, idSesion } from "./identidad";
import { leerPolitica } from "./politica";
import { useE14Store } from "../store";
import { listarMapeados } from "../masiva/cola";
import type { DiagnosticoActa } from "../types";
import type { EnvioDetalle, EventoObs, ReporteSesion, SaludSnapshot, UsoContador } from "./tipos";

/** percentil nearest-rank sobre lista ASCENDENTE (PURA — testeada). */
export function percentilDe(asc: number[], p: number): number | null {
  if (asc.length === 0) return null;
  const idx = Math.ceil((p / 100) * asc.length) - 1;
  return asc[Math.min(asc.length - 1, Math.max(0, idx))];
}

/** Merge de contadores de uso de eventos → lista agregada (PURA). */
export function agregarUso(eventos: EventoObs[]): UsoContador[] {
  const porClave = new Map<string, UsoContador>();
  for (const e of eventos) {
    const u = e.datos as UsoContador;
    if (!u || typeof u.vista !== "string" || typeof u.accion !== "string") continue;
    const clave = `${u.dia}|${u.vista}|${u.accion}`;
    const previo = porClave.get(clave);
    if (previo) previo.n += u.n || 0;
    else porClave.set(clave, { dia: u.dia, vista: u.vista, accion: u.accion, n: u.n || 0 });
  }
  return [...porClave.values()];
}

/** Sello de nombre: YYYYMMDD-HHmm (hora local). */
export function selloDe(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}`
  );
}

/** Mínimo que el perf necesita de un acta (PURA, testeable sin Acta real).
 *  §G.3 — ORDEN-WAVE3-add-envio-individual-v1: opcionales AL FINAL (D57) —
 *  canal (modo), status del desenlace, red del momento del envío y el id
 *  YA HASHEADO (hashDeActaIdDe de captura.ts — el token actaId plano
 *  jamás aparece en este archivo: qa-obs-privacidad bloque d intacto). */
export interface FragDiag {
  tiempos: DiagnosticoActa["tiempos"];
  gate: { completa: boolean };
  /** §G.3: canal del diagnóstico al export — "individual" = actaActual (una
   *  acta abierta desde la bandeja a REVISIÓN cuenta individual), "masiva" =
   *  cola. */
  modo?: "individual" | "masiva";
  status?: DiagnosticoActa["status"];
  envioRedTipo?: string | null;
  envioDownlinkMbps?: number | null;
  actaIdHash?: string;
}

/** Diagnósticos de la jornada — SOLO LECTURA (kit A1-C6):
 *  · useE14Store.actaActual (la fuente que nombra el kit), y
 *  · la COLA MASIVA vía listarMapeados (lección L7: el mapper corre DENTRO
 *    del cursor y extrae SOLO los números del diagnóstico — los Blobs y
 *    dataURLs jamás se retienen; filas livianas NO traen acta en RAM).
 *  Sin esto, el reporte solo vería 1 acta y el dueño perdería las
 *  estadísticas de la jornada real. */
async function diagnosticosDeLaJornada(): Promise<FragDiag[]> {
  const salida: FragDiag[] = [];
  try {
    const e14 = useE14Store.getState();
    if (e14.actaActual?.diagnostico)
      salida.push({
        ...e14.actaActual.diagnostico,
        modo: "individual",
        actaIdHash: hashDeActaIdDe(e14.actaActual.diagnostico),
      });
  } catch {
    /* silencioso */
  }
  try {
    await listarMapeados((r) => {
      const d = r.acta?.diagnostico;
      if (d)
        salida.push({
          ...d,
          modo: "masiva",
          actaIdHash: hashDeActaIdDe(d),
        });
      return null; // NADA se retiene del registro completo (L7)
    });
  } catch {
    /* silencioso — la cola es opcional para el reporte */
  }
  return salida;
}

/** perfResumen desde diagnósticos (kit A1-C6): p50/p95 de `tiempos.ocrMs`
 *  (campo REAL del contrato DiagnosticoActa), fallosGate por
 *  gate.completa=false. Las copias DUPLICADAS traen ocrMs=0 (no corrieron
 *  OCR — runner e63k) → se excluyen del percentil (0 ms jamás es un tiempo
 *  de OCR real). §G.3 — telemetría del ENVÍO (aditivos AL FINAL):
 *  envios = diagnósticos con envioMs presente (0 ms válido — registro
 *  local BASELINE hoy; latencia de red real con §A/ledger D1); p50/p95 con
 *  percentilDe (mismos nulls honestos). Campos OCR INTACTOS. */
export function perfDeDiags(diags: FragDiag[], saludMuestras: SaludSnapshot[]): ReporteSesion["perfResumen"] {
  const ocrs = diags
    .map((d) => d.tiempos.ocrMs ?? 0)
    .filter((ms) => ms > 0)
    .sort((a, b) => a - b);
  const envios = diags
    .map((d) => d.tiempos.envioMs)
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => a - b);
  const memorias = saludMuestras
    .map((s) => s.memoriaMB)
    .filter((m): m is number => typeof m === "number");
  return {
    actas: diags.length,
    p50OcrMs: percentilDe(ocrs, 50),
    p95OcrMs: percentilDe(ocrs, 95),
    fallosGate: diags.filter((d) => d.gate.completa === false).length,
    memoriaPicoMB: memorias.length ? Math.max(...memorias) : null,
    envios: envios.length,
    p50EnvioMs: percentilDe(envios, 50),
    p95EnvioMs: percentilDe(envios, 95),
  };
}

/** §G.3 — enviosDetalle: una fila por diagnóstico con envioMs != null.
 *  PRIVACIDAD dura: actaIdHash (fnv1a8 — el id YA llega hasheado por el
 *  mapper via hashDeActaIdDe de captura.ts), SIN título/mesa/puesto/payload
 *  (qa-obs-privacidad manda). Sin filas → undefined (campo omitido —
 *  informes previos no cambian de forma). */
export function enviosDetalleDe(diags: FragDiag[]): EnvioDetalle[] | undefined {
  const filas: EnvioDetalle[] = diags
    .filter((d) => typeof d.tiempos.envioMs === "number")
    .map((d) => ({
      actaIdHash: d.actaIdHash ?? "",
      modo: d.modo ?? ("masiva" as const),
      status: d.status ?? "—",
      ocrMs: typeof d.tiempos.ocrMs === "number" ? d.tiempos.ocrMs : null,
      totalMs: typeof d.tiempos.totalMs === "number" ? d.tiempos.totalMs : null,
      envioMs: d.tiempos.envioMs as number,
      envioRedTipo: d.envioRedTipo ?? null,
      envioDownlinkMbps: d.envioDownlinkMbps ?? null,
    }));
  return filas.length ? filas : undefined;
}

/** ReporteSesion completo (contrato §4.2). */
export async function construirReporte(): Promise<ReporteSesion> {
  const politica = leerPolitica();
  const dispositivo = await obtenerDispositivo();
  const erroresAgrupados = await eventosPorDigest();
  const saludMuestras = (await leerEventos((e) => e.tipo === "salud")).map(
    (e) => e.datos as SaludSnapshot,
  );
  const uso = agregarUso(await leerEventos((e) => e.tipo === "uso"));
  const diags = await diagnosticosDeLaJornada();
  const perfResumen = perfDeDiags(diags, saludMuestras);
  // §G.3 — enviosDetalle (aditivo opcional AL FINAL): solo filas con envío
  // medido; undefined si ninguna (informes previos no cambian de forma).
  const enviosDetalle = enviosDetalleDe(diags);
  // ANEXO Agente C (Pieza 2) — agregación de hangs de ESTA sesión (ADITIVO
  // AL FINAL del reporte — informes previos no cambian de forma). Los
  // eventos "hang" ya son de la sesión activa (appendEvento sella sesion).
  const hangResumen = resumenHangsDe(await leerEventos((e) => e.tipo === "hang"));
  return {
    meta: {
      appVersion: appVersion(),
      generado: new Date().toISOString(),
      deviceId: idDispositivo(),
      sesion: idSesion(),
      politica,
    },
    dispositivo,
    erroresAgrupados,
    perfResumen,
    ...(enviosDetalle ? { enviosDetalle } : {}),
    saludMuestras,
    uso,
    hangResumen,
  };
}

// ─── descarga (patrón informe.ts / downloadBlob del core) ──────────────────

/** Descarga local: createObjectURL + <a download> + revoke (mismo patrón
 *  del downloadBlob de @jg-stevan/scanner-core — sin dependencia nueva). */
function descargarBlob(blob: Blob, nombre: string): void {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  } catch {
    /* silencioso */
  }
}

/** JPG ~200px de una dataURL o Blob (actas FALLIDAS con foto disponible —
 *  kit A1-C6). Canvas en main thread: SOLO corre con politica.miniaturas
 *  ON (default OFF — cero costo normal) y con pocas actas. null honesto. */
async function miniaturaJpg(fuente: string | Blob, max = 200): Promise<Uint8Array | null> {
  try {
    const img = new Image();
    const url = typeof fuente === "string" ? fuente : URL.createObjectURL(fuente);
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("imagen-ilegible"));
      img.src = url;
    });
    if (typeof fuente !== "string") URL.revokeObjectURL(url);
    const escala = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * escala));
    canvas.height = Math.max(1, Math.round(img.height * escala));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/jpeg", 0.7),
    );
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

/** Fuentes de muestra: dataURL en RAM (actaActual RECHAZADA) o Blob de la
 *  cola (registros RECHAZADOS con fotoProcesadaBlob — e68). Solo RECHAZADAS
 *  (la captura falló; ADVERTENCIA/enviadas no son muestras de fallo). */
async function miniaturasDeFallidas(): Promise<Array<{ nombre: string; bytes: Uint8Array }>> {
  const salida: Array<{ nombre: string; bytes: Uint8Array }> = [];
  const fuentes: Array<string | Blob> = [];
  try {
    const e14 = useE14Store.getState();
    if (e14.actaActual?.status === "RECHAZADA" && e14.actaActual.fotoProcesada) {
      fuentes.push(e14.actaActual.fotoProcesada);
    }
  } catch {
    /* silencioso */
  }
  try {
    await listarMapeados((r) => {
      if (r.acta?.status !== "RECHAZADA") return null;
      const f = r.acta.fotoProcesada ?? r.fotoProcesadaBlob;
      if (f) fuentes.push(f);
      return null; // L7: el Blob retenido es SOLO el de la muestra (pocas)
    });
  } catch {
    /* silencioso */
  }
  let i = 0;
  for (const f of fuentes) {
    const bytes = await miniaturaJpg(f);
    if (bytes) salida.push({ nombre: `acta-${i++}.jpg`, bytes });
  }
  return salida;
}

/** Descarga MANUAL (D1). vaciarDespues → purgarBuffer tras descargar CON
 *  ÉXITO (el dueño ya tiene su copia — el buffer local muere limpio). */
export async function descargarReporte(
  formato: "zip" | "json",
  vaciarDespues: boolean,
): Promise<{ nombre: string; bytes: number }> {
  const reporte = await construirReporte();
  const sello = selloDe(new Date());

  if (formato === "json") {
    const json = JSON.stringify(reporte, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const nombre = `reporte-observabilidad-${sello}.json`;
    descargarBlob(blob, nombre);
    if (vaciarDespues) await purgarBuffer();
    return { nombre, bytes: blob.size };
  }

  // ZIP — patrón informe.ts: zip() ASYNC con STORE {level: 0} (no bloquea
  // la UI, no re-comprime) — receta d57e538.
  const contenidos: Record<string, Uint8Array> = {
    "reporte.json": new TextEncoder().encode(JSON.stringify(reporte, null, 2)),
  };
  // Scrub D4: muestras SOLO con miniaturas ON (default OFF).
  if (reporte.meta.politica.miniaturas) {
    for (const m of await miniaturasDeFallidas()) {
      contenidos[`muestras/${m.nombre}`] = m.bytes;
    }
  }
  const { zip } = await import("fflate");
  const empaquetado = await new Promise<Uint8Array>((resolve, reject) => {
    zip(contenidos, { level: 0 }, (err, datos) =>
      err ? reject(err) : resolve(datos),
    );
  });
  const blob = new Blob([empaquetado as Uint8Array<ArrayBuffer>], {
    type: "application/zip",
  });
  const nombre = `reporte-observabilidad-${sello}.zip`;
  descargarBlob(blob, nombre);
  if (vaciarDespues) await purgarBuffer();
  return { nombre, bytes: blob.size };
}
