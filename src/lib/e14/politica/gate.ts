/**
 * 7.2 (plan de remediación, cierra A1) — EL BLOQUE ÚNICO de la política del
 * gate. Durante cuatro kits la misma lógica de negocio vivió DUPLICADA a
 * mano en `pipeline.ts` (escaneo §6) y en `RealCoreBridge.pipelineRecorte`
 * (recorte §4) — piso/techo de lectura (C3), inyección SIM, escudo-fondo
 * D10, escudo-manual Q2, cap de recortada, gate INCOMPLETA/SIN_VOTOS,
 * caps 6.4 y techosDiag — «sostenida por comentarios» («mismo criterio en
 * AMBOS pipelines», pitfall §9.9): cualquier ajuste aplicado a un solo lado
 * producía dos productos distintos según el camino del acta. Desde 7.2 la
 * política vive AQUÍ y los DOS pipelines consumen este helper (golden de
 * paridad: `gate.paridad.test.ts`).
 *
 * Patrón: inyección de dependencias como `DepsOcrCascada` del paquete
 * (orquestacion/cascada.ts) — lo clase-bound (evaluarGate) y el copy de los
 * rechazos (DETALLE_*) llegan inyectados; los NÚMEROS vienen de
 * `./umbrales` (7.1) y las constantes de LECTURA del paquete (definición
 * única). El bridge solo entra como `import type` (ResultadoGate) — se borra
 * en el emit, cero ciclo en runtime (mismo truco de pipeline.ts).
 *
 * LO QUE NO hace este helper (queda en el llamador, a propósito):
 *  · la medición del guard (verificarCompletitud) y del veto 4/4 fiduciales
 *    — sus entradas difieren por camino (SIM fuerza completa=true en el
 *    escaneo; el recorte siempre es real) y son CARAS (decode + canvas);
 *  · `medirZonaVotos` (idem — el llamador también la imprime en el log);
 *  · `pisoPerfecto` (alimenta scoreDeCalidad ANTES de este helper);
 *  · el diagnóstico y el log-contrato D51.
 */

import type { PageQuality } from "@jg-stevan/scanner-core/core/types";
import type { ClasificacionE14 } from "@jg-stevan/scanner-core/dominio/clasificador";
import type { Acta, ActaStatus } from "@jg-stevan/scanner-core/dominio/types";
import {
  PISO_LECTURA_FUERTE,
  TECHO_LECTURA_DEBIL,
  type SenalLectura,
} from "@jg-stevan/scanner-core/dominio/senal-lectura";
// 7.1 — números del producto (única fuente de verdad).
import {
  TECHO_ADVERTENCIA,
  TECHO_ESCUDO_FONDO,
  TECHO_SIN_SENAL,
  UMBRAL_SCORE_INCOMPLETA,
} from "./umbrales";
// SOLO tipos del bridge (se borran en el emit — dirección de valores
// únicamente bridge/pipeline → politica, nunca al revés).
import type { ResultadoGate } from "../scanner-core-bridge";

/** 7.3 (A2 — ancla del plan de troceado, docs/PLAN-TROCEADO-PIPELINE.md):
 *  resultado tipado por paso. Cada extracción futura de `correrPipelineL2`
 *  devuelve esto en lugar de mutar clausura — el `ErrorPaso` tipado alimenta
 *  `clasificarErrorPipeline` (../errores.ts) y de ahí el motivo de operador. */
export type Resultado<T, E> = { ok: true; valor: T } | { ok: false; error: E };

/** Entrada de la política — TODOS los datos que los dos bloques espejo
 *  consumían hoy, ya calculados por el llamador (lo caro corre UNA vez). */
export interface EntradaPoliticaGate {
  /** Score BRUTO de `scoreDeCalidad` (el helper aplica C3 → SIM → caps). */
  score: number;
  /** §D3: chip SIM determinista (`opciones.scoreSimulado`) — null fuera de
   *  SIM (el recorte jamás simula). Se aplica DESPUÉS del C3 y ANTES de los
   *  caps del sitio (los chips NO vencen escudos/recortada/vetos — §G3). */
  scoreSimulado: number | null;
  /** Señal de LECTURA v2 (ya calculada — el perdón 4/4 la necesita antes). */
  senal: SenalLectura;
  /** Level de calidad (fair/poor = techos + tokens diag). */
  calidad: { level: PageQuality["level"] };
  /** Señal de CONTENIDO §D1 (techo sin-senal + sustitución BAJO). */
  senalActa: boolean;
  /** Texto OCR y clasificación — pasan a `evaluarGate` en la rama sana. */
  texto: string;
  clasificacion: ClasificacionE14;
  /** ¿Papel completo? (guard + veto 4/4 ya resueltos por el llamador). */
  completa: boolean;
  /** Recorte MANUAL del editor (Q2) — true SOLO desde pipelineRecorte con
   *  `manual`; el escaneo pasa false (veto completo, conservador). */
  manual: boolean;
  /** Marcador de votos ya medido (`medirZonaVotos(...).hayVotos`). */
  hayVotos: boolean;
  /** Página 2 (constancias) — sin zona de votos, el gate de votos se salta. */
  votosSkipPag2: boolean;
  /** Escudo D10: fondo/sombra al filo (guard de completitud). */
  fondo: boolean;
  /** Acta RECORTADA (OCR de secciones o esquina faltante sin perdón). */
  recortada: boolean;
  intento: number;
  maxIntentos: number;
}

/** Dependencias inyectadas (clase-bound del bridge + copy de rechazos). */
export interface DepsPoliticaGate {
  evaluarGate: (
    score: number,
    ocrTexto: string,
    clasificacion: ClasificacionE14,
    intento: number,
    maxIntentos: number,
  ) => ResultadoGate;
  DETALLE_INCOMPLETA: string;
  DETALLE_SIN_VOTOS: string;
  DETALLE_BAJO: string;
}

/** Salida: el desenlace completo del sitio del gate + la observabilidad. */
export interface SalidaPoliticaGate {
  /** Score FINAL (tras C3 → SIM → escudos → gate → caps de veto). */
  score: number;
  gate: ResultadoGate;
  /** §D3: sustitución BAJO sin señal de contenido (FUERA de evaluarGate). */
  rechazoFinal: Acta["rechazo"];
  /** Techos/ajustes en ORDEN de aplicación (token grep-able, contrato D51). */
  techosDiag: string[];
  /** Resultado del gate de votos (log `SIN_VOTOS` + diag.votos.ok). */
  marcadoresOk: boolean;
  /** Veto INCOMPLETA real (recorte manual NO veta — degrada a escudo). */
  vetoIncompleta: boolean;
  /** Escudo-manual Q2 (token `escudo-manual:7.9` — solo recorte del editor). */
  escudoManual: boolean;
}

/**
 * La política del gate §4 completa — el MISMO criterio para el escaneo y
 * para el recorte (antes dos bloques espejo de ~90 líneas cada uno).
 * Orden de aplicación (pitfall §G3, byte a byte el de siempre):
 *   C3 (piso/techo lectura) → chip SIM → escudo-fondo → escudo-manual →
 *   recortada → gate (INCOMPLETA → SIN_VOTOS → evaluarGate) → caps 6.4 →
 *   sustitución BAJO.
 */
export function aplicarPoliticaGate(
  entrada: EntradaPoliticaGate,
  deps: DepsPoliticaGate,
): SalidaPoliticaGate {
  const {
    score: scoreBruto,
    scoreSimulado,
    senal,
    calidad,
    senalActa,
    texto,
    clasificacion,
    completa,
    manual,
    hayVotos,
    votosSkipPag2,
    fondo,
    recortada,
    intento,
    maxIntentos,
  } = entrada;
  let score = scoreBruto;

  // C3 (KIT e14-score-lectura-v1 §4-B3): el OCR manda — FUERTE sube al piso
  // (vence al techo fair pero NUNCA al poor); DEBIL techo 5.9; MEDIA no toca.
  // ANTES de SIM y de los caps del sitio (pitfall §9.4/§9.5).
  if (senal.nivel === "FUERTE" && calidad.level !== "poor") {
    score = Math.max(score, PISO_LECTURA_FUERTE);
  } else if (senal.nivel === "DEBIL") {
    score = Math.min(score, TECHO_LECTURA_DEBIL);
  }
  // §D3 (SPEC-e14-simulacion-scores): inyección determinista del chip —
  // sin re-aplicación de pisos: el chip manda dentro de la ventana del
  // gate, los caps posteriores siguen MANDANDO sobre él.
  if (scoreSimulado != null) score = scoreSimulado;

  // KIT e14-esquinas-suaves-v1 (Q2): el veto del guard SOLO rechaza fuera
  // del recorte MANUAL — allí degrada al escudo (techo 7.9): el operador
  // VIO el papel; a lo sumo su crop cortó impresión y lo decide mirando.
  const vetoIncompleta = !completa && !manual;
  const escudoManual = !completa && manual;

  // GATE-MARCADORES (KIT e14-gate-v2, G2): INCOMPLETA manda primero — el
  // veto de votos SOLO condena actas completas sin tinta en la zona; el
  // escudo-manual NO lo releva (un rescate sin votos no pasa).
  const marcadoresOk = vetoIncompleta ? true : votosSkipPag2 ? true : hayVotos;

  // Escudos y caps del sitio (D10 fondo · Q2 manual · FASE C recortada) —
  // techo ADVERTENCIA: nunca ÓPTIMA, sin copy nuevo, el operador decide.
  if (completa && fondo) score = Math.min(score, TECHO_ESCUDO_FONDO);
  if (escudoManual) score = Math.min(score, TECHO_ESCUDO_FONDO);
  if (recortada) score = Math.min(score, TECHO_ESCUDO_FONDO);

  // Gate: INCOMPLETA/SIN_VOTOS FUERA de evaluarGate (D6/AC10 + G2 — el veto
  // sigue vivo fuera del gate §7 score-ocr intocado). Al AGOTAR intentos →
  // contingencia C4 automática (EN_REVISION_HUMANA con el MISMO rechazo).
  const gate: ResultadoGate = vetoIncompleta
    ? {
        status: intento >= maxIntentos ? ("EN_REVISION_HUMANA" as ActaStatus) : ("RECHAZADA" as ActaStatus),
        rechazo: { tipo: "INCOMPLETA", detalle: deps.DETALLE_INCOMPLETA },
        clasificacion: null,
      }
    : !marcadoresOk
      ? {
          status: intento >= maxIntentos ? ("EN_REVISION_HUMANA" as ActaStatus) : ("RECHAZADA" as ActaStatus),
          rechazo: { tipo: "SIN_VOTOS", detalle: deps.DETALLE_SIN_VOTOS },
          clasificacion: null,
        }
      : deps.evaluarGate(score, texto, clasificacion, intento, maxIntentos);

  // Caps de coherencia score↔status: RECHAZADA implica < 6.5
  // (statusDeScore) — el cap del veto SOLO cuando el veto es REAL (con
  // escudo-manual el cap 7.9 ya aplicó arriba).
  if (vetoIncompleta) score = Math.min(score, UMBRAL_SCORE_INCOMPLETA);
  if (completa && !marcadoresOk) score = Math.min(score, UMBRAL_SCORE_INCOMPLETA);

  // §D3: sin señal de contenido el rechazo se sustituye por BAJO SEA CUAL
  // SEA el status (el status lo sigue decidiendo el gate/los intentos).
  const rechazoFinal: Acta["rechazo"] = senalActa
    ? gate.rechazo
    : { tipo: "BAJO", detalle: deps.DETALLE_BAJO };

  // C1 (KIT e14-diagnostico-autoenvio-v1 §6-B): techos con las MISMAS
  // condiciones que ya aplicaron los caps — orden real de aplicación.
  // Tokens grep-able del log-contrato D51; los valores viajan desde
  // umbrales.ts (el token refleja SIEMPRE el umbral vigente).
  const techosDiag: string[] = [];
  if (calidad.level === "fair") techosDiag.push(`techo-fair:${TECHO_ADVERTENCIA}`);
  if (calidad.level === "poor") techosDiag.push(`techo-poor:${UMBRAL_SCORE_INCOMPLETA}`);
  if (!senalActa) techosDiag.push(`sin-senal:${TECHO_SIN_SENAL}`);
  // KIT e14-diag-campos-aditivos-v1 (§8): ajustes de LECTURA — NO son caps,
  // es observabilidad del ajuste (piso sube, techo baja).
  if (senal.nivel === "FUERTE" && calidad.level !== "poor")
    techosDiag.push(`piso-lectura-FUERTE:${PISO_LECTURA_FUERTE}`);
  if (senal.nivel === "DEBIL") techosDiag.push(`lectura-DEBIL:${TECHO_LECTURA_DEBIL}`);
  if (completa && fondo) techosDiag.push(`escudo-fondo:${TECHO_ESCUDO_FONDO}`);
  // KIT e14-esquinas-suaves-v1 (Q2): techo del escudo-manual — junto al
  // escudo-fondo, MISMO orden de aplicación de los caps.
  if (escudoManual) techosDiag.push(`escudo-manual:${TECHO_ADVERTENCIA}`);
  if (recortada) techosDiag.push(`recortada:${TECHO_ESCUDO_FONDO}`);
  // KIT e14-esquinas-suaves-v1 (Q2): el token `incompleta:6.4` SOLO con el
  // veto real (un recorte manual incompleto NO es INCOMPLETA — es escudo).
  if (vetoIncompleta) techosDiag.push(`incompleta:${UMBRAL_SCORE_INCOMPLETA}`);
  if (completa && !marcadoresOk) techosDiag.push(`sin-votos:${UMBRAL_SCORE_INCOMPLETA}`);

  return { score, gate, rechazoFinal, techosDiag, marcadoresOk, vetoIncompleta, escudoManual };
}
