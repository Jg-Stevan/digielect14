/**
 * KIT e14-rastreo-tiempos-v1 — INFORME de tiempos de digitalización.
 *
 * Construye — en el navegador, SIN red y SIN dependencias nuevas — tres
 * artefactos a partir de los datos REALES medidos por el motor:
 *
 *  · JSON auto-descriptivo (mismo espíritu de adaptacion/informe-ia.ts):
 *    lleva sus instrucciones de lectura (_como_interpretar), percentiles,
 *    desglose por fase y contexto del dispositivo. Machine-first.
 *  · TXT legible — informe humano para pegar en un chat/repo.
 *  · CSV — una fila por unidad de digitalización (hoja de cálculo).
 *
 * PRIVACIDAD: solo tiempos/estados/contadores — SIN actas, SIN OCR, SIN
 * puesto/mesa en claro (ids con hash). Nada sale sin «descargar» (D1).
 *
 * Las actas de SIMULACIÓN (chips TEST SCORES) van SEPARADAS y jamás
 * contaminan los agregados de tiempos reales.
 */
import type { SesionRastreo, UnidadRastreo } from "./tipos";
import { METAS } from "./tipos";
import { sesionesCerradas, sesionActiva } from "./motor";
import { appVersion, idDispositivo, idSesion } from "../obs/identidad";
import { obtenerPerfilDispositivo } from "../adaptacion/perfil";
import { planAdaptativo } from "../adaptacion/plan";

// ─── Agregación (puro) ──────────────────────────────────────────────────────

function percentil(valores: number[], p: number): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(orden.length - 1, Math.ceil(p * orden.length) - 1));
  return orden[idx];
}

function media(valores: number[]): number | null {
  if (valores.length === 0) return null;
  return Math.round(valores.reduce((a, b) => a + b, 0) / valores.length);
}

interface Serie {
  n: number;
  mediaMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  minMs: number | null;
  maxMs: number | null;
}

function serieDe(valores: number[]): Serie {
  return {
    n: valores.length,
    mediaMs: media(valores),
    p50Ms: percentil(valores, 0.5),
    p95Ms: percentil(valores, 0.95),
    minMs: valores.length ? Math.min(...valores) : null,
    maxMs: valores.length ? Math.max(...valores) : null,
  };
}

export interface ResumenSesion {
  actasReales: number;
  actasSim: number;
  enviadas: number;
  autoEnvios: number;
  reescaneos: number;
  intentos: number;
  tasaEnvioPct: number | null;
  actasPorHora: number | null;
  duracionMs: number | null;
  total: Serie;
  pipeline: Serie;
  revision: Serie;
  ocr: Serie;
  sobreMetaTotal: number;
  sobreMetaPipeline: number;
}

/** Resumen agregado de UNA sesión (excluye actas SIM de los tiempos). */
export function resumenDeSesion(s: SesionRastreo): ResumenSesion {
  const reales = s.actas.filter((a) => !a.sim);
  const sims = s.actas.filter((a) => a.sim);
  const enviadas = reales.filter((a) => a.enviada);
  const fin = s.fin ?? Date.now();
  const duracionMs = Math.max(0, fin - s.inicio);
  const horas = duracionMs / 3_600_000;
  return {
    actasReales: reales.length,
    actasSim: sims.length,
    enviadas: enviadas.length,
    autoEnvios: enviadas.filter((a) => a.autoEnvio).length,
    reescaneos: reales.reduce((n, a) => n + Math.max(0, a.intentos - 1), 0),
    intentos: reales.reduce((n, a) => n + a.intentos, 0),
    tasaEnvioPct: reales.length ? Math.round((enviadas.length / reales.length) * 100) : null,
    actasPorHora: horas > 0 && enviadas.length > 0 ? Math.round((enviadas.length / horas) * 10) / 10 : null,
    duracionMs,
    total: serieDe(reales.map((a) => a.totalMs).filter((x): x is number => typeof x === "number")),
    pipeline: serieDe(reales.map((a) => a.pipelineMs).filter((x): x is number => typeof x === "number")),
    revision: serieDe(reales.map((a) => a.revisionMs).filter((x): x is number => typeof x === "number")),
    ocr: serieDe(
      reales.map((a) => a.pipelineInterno?.ocrMs).filter((x): x is number => typeof x === "number"),
    ),
    sobreMetaTotal: reales.filter((a) => a.totalMs !== null && a.totalMs > METAS.actaTotalMs).length,
    sobreMetaPipeline: reales.filter(
      (a) => a.pipelineMs !== null && a.pipelineMs > METAS.pipelineMs,
    ).length,
  };
}

// ─── Informe JSON (auto-descriptivo) ────────────────────────────────────────

export interface InformeRastreo {
  $informe: "digielect14/rastreo-tiempos";
  $version: 1;
  _como_interpretar: string[];
  metas: Record<string, unknown>;
  resumen: Record<string, unknown>;
  sesiones: Record<string, unknown>[];
  porActa: Record<string, unknown>[];
  navegacionTotal: Record<string, { ms: number; visitas: number }> | null;
  contexto: Record<string, unknown>;
}

/** Todas las sesiones con datos: la activa (si hay) + las cerradas. */
export function todasLasSesiones(): SesionRastreo[] {
  const activa = sesionActiva();
  const cerradas = sesionesCerradas();
  const todas = activa ? [activa, ...cerradas] : cerradas;
  return todas.filter((s) => s.actas.length > 0 || s.eventos.length > 2);
}

export async function construirInformeRastreo(): Promise<InformeRastreo> {
  const sesiones = todasLasSesiones();
  const perfil = await obtenerPerfilDispositivo().catch(() => null);
  const plan = planAdaptativo();

  // Resumen combinado: sesiones sintéticamente unidas para percentiles.
  const fusionada: SesionRastreo | null = sesiones.length
    ? {
        version: 1,
        id: "combinada",
        inicio: Math.min(...sesiones.map((s) => s.inicio)),
        fin: Math.max(...sesiones.map((s) => s.fin ?? Date.now())),
        activa: false,
        actas: sesiones.flatMap((s) => s.actas),
        navegacion: sesiones.reduce<Record<string, { vista: string; ms: number; visitas: number }>>(
          (acc, s) => {
            for (const [vista, nav] of Object.entries(s.navegacion)) {
              const prev = acc[vista] ?? { vista, ms: 0, visitas: 0 };
              prev.ms += nav.ms;
              prev.visitas += nav.visitas;
              acc[vista] = prev;
            }
            return acc;
          },
          {},
        ),
        eventos: [],
        conSim: sesiones.some((s) => s.conSim),
      }
    : null;

  const res = fusionada ? resumenDeSesion(fusionada) : null;

  return {
    $informe: "digielect14/rastreo-tiempos",
    $version: 1,
    _como_interpretar: [
      "Informe de TIEMPOS DE DIGITALIZACIÓN de la PWA DigiE14 — mide cómo un operador digitaliza actas E-14 en el navegador.",
      "Se genera DESDE el dispositivo con datos REALES: cada unidad = un ciclo completo de digitalización (captura → pipeline OCR → revisión → envío), con reintentos agrupados.",
      "'pipelineMs' = tiempo de pared desde el disparo hasta que el pipeline resuelve (incluye decode/detección/OCR/evaluación). 'revisionMs' = tiempo en REVISIÓN hasta la decisión del operador (null = auto-envío ÓPTIMA, no pasó por revisión). 'totalMs' = captura → desenlace terminal.",
      "Percentiles p50/p95 sobre unidades reales; las actas de SIMULACIÓN (chips TEST SCORES) van por separado y JAMÁS entran en los agregados.",
      "'metas' son REFERENCIAS orientativas de fluidez (no gates): acta total ≤ 90 s y pipeline ≤ 45 s. 'sobreMeta' cuenta cuántas unidades las superan.",
      "'navegacion' muestra cómo se movió el operador por las vistas (permanencia total + visitas) — útil para detectar fricción de UX.",
      "PRIVACIDAD: sin actas, sin texto OCR, sin puesto/mesa en claro; ids con hash de 8 hex. Nada se envió a ningún servidor — descarga manual.",
      "null = dato no disponible honesto (SIM sin diagnóstico, intento sin resolver, navegador sin la API).",
    ],
    metas: {
      actaTotalMs: METAS.actaTotalMs,
      pipelineMs: METAS.pipelineMs,
      nota: "Referencias de fluidez para jornada de campo — no son gates del pipeline.",
    },
    resumen: res
      ? {
          sesiones: sesiones.length,
          actasReales: res.actasReales,
          actasSimuladas: res.actasSim,
          enviadas: res.enviadas,
          autoEnvios: res.autoEnvios,
          reescaneos: res.reescaneos,
          intentosTotales: res.intentos,
          intentosPromedio: res.actasReales ? Math.round((res.intentos / res.actasReales) * 100) / 100 : null,
          tasaEnvioPct: res.tasaEnvioPct,
          actasPorHora: res.actasPorHora,
          duracionTotalMs: res.duracionMs,
          tiempos: {
            total: res.total,
            pipeline: res.pipeline,
            revision: res.revision,
            ocr: res.ocr,
          },
          sobreMeta: { total: res.sobreMetaTotal, pipeline: res.sobreMetaPipeline },
        }
      : { sesiones: 0, nota: "SIN DATOS — activa el rastreo y digitaliza al menos un acta." },
    sesiones: sesiones.map((s) => {
      const r = resumenDeSesion(s);
      return {
        id: s.id,
        inicioIso: new Date(s.inicio).toISOString(),
        finIso: s.fin ? new Date(s.fin).toISOString() : null,
        activa: s.activa,
        duracionMs: r.duracionMs,
        actasReales: r.actasReales,
        actasSim: r.actasSim,
        enviadas: r.enviadas,
        autoEnvios: r.autoEnvios,
        reescaneos: r.reescaneos,
        actasPorHora: r.actasPorHora,
        p50TotalMs: r.total.p50Ms,
        p95TotalMs: r.total.p95Ms,
        p50PipelineMs: r.pipeline.p50Ms,
        p95PipelineMs: r.pipeline.p95Ms,
        p50RevisionMs: r.revision.p50Ms,
        p95RevisionMs: r.revision.p95Ms,
        p50OcrMs: r.ocr.p50Ms,
        p95OcrMs: r.ocr.p95Ms,
        conSim: s.conSim,
      };
    }),
    porActa: sesiones.flatMap((s) =>
      s.actas.map((a) => filaDeActa(s.id, a)),
    ),
    navegacionTotal: fusionada
      ? Object.fromEntries(
          Object.entries(fusionada.navegacion).map(([vista, nav]) => [
            vista,
            { ms: nav.ms, visitas: nav.visitas },
          ]),
        )
      : null,
    contexto: {
      app: "digielect14",
      app_version: appVersion(),
      generado_iso: new Date().toISOString(),
      id_dispositivo: idDispositivo()?.slice(0, 8) ?? null,
      id_sesion: idSesion()?.slice(0, 8) ?? null,
      tier: perfil?.tier ?? null,
      gpu: perfil?.gpu.renderer ?? null,
      nucleos: perfil?.nucleos ?? null,
      ram_gb: perfil?.memoriaGB ?? null,
      ocr_hilos: plan.ocrHilos,
      ocr_hilos_fuente: plan.ocrHilosFuente,
      nota: "Tier/hardware del kit adaptacion — contexto para interpretar los tiempos (gama baja es más lenta por diseño).",
    },
  };
}

function filaDeActa(sesionId: string, a: UnidadRastreo): Record<string, unknown> {
  return {
    sesion: sesionId,
    idHash: a.idHash || "—",
    sim: a.sim,
    fuente: a.fuente,
    intentos: a.intentos,
    desenlaces: a.statusPorIntento,
    statusFinal: a.statusFinal,
    enviada: a.enviada,
    autoEnvio: a.autoEnvio,
    scoreFinal: a.scoreFinal,
    pipelineMs: a.pipelineMs,
    revisionMs: a.revisionMs,
    totalMs: a.totalMs,
    internos: a.pipelineInterno,
    tsInicioIso: new Date(a.tsInicio).toISOString(),
    tsFinIso: a.tsFin ? new Date(a.tsFin).toISOString() : null,
  };
}

// ─── TXT legible ────────────────────────────────────────────────────────────

function msLegible(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

export async function construirInformeTxt(): Promise<string> {
  const informe = await construirInformeRastreo();
  const r = informe.resumen as Record<string, unknown>;
  const L: string[] = [];
  L.push("════════════════════════════════════════════════════════════");
  L.push("  DIGIE14 — INFORME DE RASTREO DE TIEMPOS DE DIGITALIZACIÓN");
  L.push(`  generado: ${new Date().toISOString()}`);
  L.push("════════════════════════════════════════════════════════════");
  if (r.nota) {
    L.push("");
    L.push(String(r.nota).toUpperCase());
    L.push("(Activa el rastreo en el panel dev §9 y digitaliza al menos un acta.)");
  } else {
    L.push("");
    L.push(`Sesiones incluidas ......: ${r.sesiones}`);
    L.push(`Actas reales ............: ${r.actasReales}  (simuladas aparte: ${r.actasSimuladas})`);
    L.push(`Enviadas ................: ${r.enviadas}  (auto-envío: ${r.autoEnvios})`);
    L.push(`Tasa de envío ...........: ${r.tasaEnvioPct ?? "—"}%`);
    L.push(`Re-escaneos .............: ${r.reescaneos}  (intentos totales: ${r.intentosTotales})`);
    L.push(`Ritmo ...................: ${r.actasPorHora ?? "—"} actas/hora`);
    const t = r.tiempos as Record<string, Record<string, number | null>>;
    L.push("");
    L.push("── TIEMPOS (actas reales) ──────────────────────────────────");
    for (const [nombre, s] of Object.entries(t)) {
      L.push(
        `${nombre.padEnd(9, ".")}: n=${s.n}  media=${msLegible(s.mediaMs)}  p50=${msLegible(s.p50Ms)}  p95=${msLegible(s.p95Ms)}  max=${msLegible(s.maxMs)}`,
      );
    }
    L.push("");
    L.push("── CONTRA LAS METAS DE FLUIDEZ ─────────────────────────────");
    L.push(`Actas sobre la meta de TOTAL (${msLegible(METAS.actaTotalMs)}): ${(r.sobreMeta as Record<string, number>).total}`);
    L.push(`Actas sobre la meta de PIPELINE (${msLegible(METAS.pipelineMs)}): ${(r.sobreMeta as Record<string, number>).pipeline}`);
  }
  L.push("");
  L.push("── SESIONES ────────────────────────────────────────────────");
  for (const s of informe.sesiones) {
    const sr = s as Record<string, unknown>;
    L.push(
      `[${sr.activa ? "EN CURSO" : "cerrada"}] ${sr.id} · ${sr.inicioIso} → ${sr.finIso ?? "—"} · actas ${sr.actasReales} · enviadas ${sr.enviadas} · p50 total ${msLegible(sr.p50TotalMs as number | null)}`,
    );
  }
  L.push("");
  L.push("── POR ACTA (una línea por unidad de digitalización) ───────");
  for (const fila of informe.porActa as Record<string, unknown>[]) {
    L.push(
      `${fila.sim ? "[SIM] " : ""}${String(fila.statusFinal).padEnd(19, " ")} intentos=${fila.intentos} pipeline=${msLegible(fila.pipelineMs as number | null)} revisión=${msLegible(fila.revisionMs as number | null)} total=${msLegible(fila.totalMs as number | null)} fuente=${fila.fuente} ocr=${msLegible((fila.internos as { ocrMs: number | null } | null)?.ocrMs ?? null)}`,
    );
  }
  if (informe.navegacionTotal) {
    L.push("");
    L.push("── NAVEGACIÓN (permanencia por vista) ──────────────────────");
    for (const [vista, nav] of Object.entries(informe.navegacionTotal)) {
      L.push(`${vista.padEnd(11, ".")}: ${msLegible(nav.ms)} en ${nav.visitas} visita(s)`);
    }
  }
  L.push("");
  L.push("PRIVACIDAD: solo metadatos de tiempos — sin actas ni contenido OCR.");
  return L.join("\n");
}

// ─── CSV (una fila por unidad) ──────────────────────────────────────────────

function csvEscapar(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function construirInformeCsv(sesiones: SesionRastreo[]): string {
  const cab = [
    "sesion",
    "id_hash",
    "sim",
    "fuente",
    "intentos",
    "desenlaces",
    "status_final",
    "enviada",
    "auto_envio",
    "score_final",
    "pipeline_ms",
    "revision_ms",
    "total_ms",
    "decode_ms",
    "detect_ms",
    "calidad_ms",
    "ocr_ms",
    "proceso_ms",
    "pipeline_interno_total_ms",
    "envio_ms",
    "ts_inicio_iso",
    "ts_fin_iso",
  ];
  const filas = sesiones.flatMap((s) =>
    s.actas.map((a) =>
      [
        s.id,
        a.idHash,
        a.sim ? "1" : "0",
        a.fuente,
        a.intentos,
        a.statusPorIntento.join("|"),
        a.statusFinal,
        a.enviada ? "1" : "0",
        a.autoEnvio ? "1" : "0",
        a.scoreFinal,
        a.pipelineMs,
        a.revisionMs,
        a.totalMs,
        a.pipelineInterno?.decodeMs ?? "",
        a.pipelineInterno?.detectMs ?? "",
        a.pipelineInterno?.calidadMs ?? "",
        a.pipelineInterno?.ocrMs ?? "",
        a.pipelineInterno?.procesoMs ?? "",
        a.pipelineInterno?.totalMs ?? "",
        a.pipelineInterno?.envioMs ?? "",
        new Date(a.tsInicio).toISOString(),
        a.tsFin ? new Date(a.tsFin).toISOString() : "",
      ]
        .map(csvEscapar)
        .join(","),
    ),
  );
  return [cab.join(","), ...filas].join("\n");
}

// ─── Descargas (mismo patrón de obs/export.ts / informe-ia.ts) ──────────────

function selloDe(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}`
  );
}

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

export type FormatoRastreo = "json" | "txt" | "csv";

export async function descargarRastreo(
  formato: FormatoRastreo,
): Promise<{ nombre: string; bytes: number }> {
  const sello = selloDe(new Date());
  if (formato === "json") {
    const informe = await construirInformeRastreo();
    const blob = new Blob([JSON.stringify(informe, null, 2)], { type: "application/json" });
    const nombre = `rastreo-tiempos-${sello}.json`;
    descargarBlob(blob, nombre);
    return { nombre, bytes: blob.size };
  }
  if (formato === "txt") {
    const txt = await construirInformeTxt();
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    const nombre = `rastreo-tiempos-${sello}.txt`;
    descargarBlob(blob, nombre);
    return { nombre, bytes: blob.size };
  }
  const csv = construirInformeCsv(todasLasSesiones());
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }); // BOM → Excel UTF-8
  const nombre = `rastreo-tiempos-${sello}.csv`;
  descargarBlob(blob, nombre);
  return { nombre, bytes: blob.size };
}
