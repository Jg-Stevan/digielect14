"use client";

/**
 * KIT flujo-dueno-v1 (K2 — brief Agente B, sub-commit 1) — WARP DE INGESTA:
 * la detección+warp+sondeo-QR del pre-scan (e107) sube a la INGESTA (pasos
 * 2+3 del flujo del dueño). Cola SERIAL con cortesía de CPU; los estamps
 * (prescanOk / quad / payload / rotacionSugerida) dejan la fila DECIDIDA
 * para que el botón PROCESAR quede como ASEGURADOR idempotente (punto 7
 * del brief) y el runner con masivaStreaming consuma filas decididas a
 * medida que la ingesta las estampa (arranque temprano P5 reutilizado).
 *
 * POR FILA (mismo alcance del pre-scan e107 — el warp de ingesta es ≤2048
 * y sirve SOLO para decidir; el OCR sigue sobre el warp full-res del
 * bridge): decode (EXIF ✓) → downscale clase 400 → detect (detection-worker
 * REAL, hard-kill por operación con los MISMOS budgets del prescan de hoy
 * — detect/warp 4000+1500 ms, viven en el cliente y NO se duplican aquí) →
 * warp SIN rotar (bitmapFull TRANSFERIDO) →
 * lectura del QR sobre el warp (BarcodeDetector → jsQR — MISMO orden y el
 * MISMO cap ≤1600 del prescan) → estamps:
 *   · prescanOk — la fila quedó decidida por ESTE pase (veredicto aplicado
 *     o lectura imposible — misma semántica del stamp del pre-scan P5).
 *   · quad (P4) — formato que el runner ya consume (flag masivaQuad ON).
 *   · payload — registrarQrPayload si masivaQrHandoff ON: el mapa
 *     payload→id de la capa 0 queda completo TAMBIÉN con las filas que el
 *     prescan asegurador salta por estar bajo este pase (el hand-off del
 *     prescan las clasifica gratis).
 *   · rotacionSugerida (K2/paso 5) — centroide de la lectura sobre el warp
 *     → orientacion-qr.rotacionDesdeCentroide (bench v8.3 4/4); la lectura
 *     fallida estampa null EXPLÍCITO (el warp corrió, no decidió).
 *   · prioridadProceso (K1 — STAMP PREPARADO, ver estampaDeIngesta).
 *
 * DIFERENCIA SUTIL vs prescan de PROCESAR (brief punto 5, documentada y
 * testeada): el camino hand-off de P1 aquí usa el payload HEREDADO del
 * sondeo crudo (qrPayloadDeFila — e73) para identidad/dedup pero NUNCA
 * salta el warp (el warp produce el cuadrante + el quad — su razón de ser).
 * En el prescan de PROCESAR el hand-off salta TODO el bloque de lectura.
 *
 * PROCESAR IGUAL (forzarDedupOff — RL-e65b-6, el escape del dueño es
 * sagrado): la fila JAMÁS entra a esta cola (guard del disparo en store.ts
 * + re-chequeo fresco al estampar) — su stamp upfront la lleva directo al
 * runner sin warp de ingesta.
 *
 * CORTESÍA DE CPU (brief punto 3): antes de cada fila de la cola, esperar
 * a que no haya cadenaDedup en vuelo (la subida nueva tiene prioridad
 * sobre el warp de la anterior) o ceder con tope corto — la cadena de
 * fondo NUNCA queda bloqueada por este módulo. Hard-kill por fila con los
 * MISMOS budgets del prescan (el cliente prescan-qr.client ya los aplica
 * por operación: detect/warp 4000+1500; el sondeo crudo conserva el suyo,
 * 2500+1000 — worker e73 intacto).
 *
 * ARQUITECTURA (doctrina turno-clasificacion — cero ciclos):
 *  · store.ts SOLO ENCOLA (encolarWarpIngesta + marcarCadenaDedupEnVuelo)
 *    — este módulo JAMÁS importa store.ts (store→aquí unidireccional).
 *  · El acceso al store (estampar filas / registrar payloads) llega
 *    INYECTADO por prescan-qr.ts al cargar (patrón e73 deps inyectables —
 *    prescan-qr.ts importa store.ts legítimamente). Sin registro (SSR/
 *    prerender/prueba) → conservador: la fila no se procesa aquí y queda
 *    para el prescan asegurador (comportamiento de hoy).
 *  · Sondeo QR con jsQR PURO vendido (masiva/vendor — red line) — el
 *    decodificador wasm lento JAMÁS en sondeos (§F.3); la extracción del
 *    cuadrante reutiliza la lógica de orientacion-qr.ts (rotacion-
 *    DesdeCentroide — mapeo puro, sin el lector wasm).
 */

import { logger } from "../../logger";
import { leerFlags } from "../flags";
import type { FlagsApp } from "../obs/tipos";
import {
  crearClientePrescan,
  DETECT_LONG_SIDE,
  downscaleLado,
  quadDeFracciones,
  type ClientePrescan,
} from "./prescan-qr.client";
import jsQR from "./vendor/jsQR.js";
import { rotacionDesdeCentroide, type RotacionQr } from "../orientacion-qr";
import { leerRegistro } from "./cola";
import type { FilaMasiva } from "./tipos";
// KIT flujo-dueno-v1 (K2): forma canónica del quad del core (solo tipo).
import type { Quad } from "@jg-stevan/scanner-core/types";

// ─── Deps inyectadas (cero import del store — doctrina turno) ───────────────

/** Acceso al store masiva — INYECTADO por prescan-qr.ts (que importa
 *  store.ts legítimamente). La intersección con prioridadProceso deja el
 *  stamp K1 PREPARADO (el campo nace con K1 — Agente A; ver REPORTE §K1). */
export interface DepsWarpIngesta {
  storeState: () => {
    filas: FilaMasiva[];
    actualizarFila: (
      id: string,
      patch: Partial<FilaMasiva> & { prioridadProceso?: 1 | 2 },
    ) => void;
  };
  registrarQrPayload: (payload: string, id: string) => void;
  qrPayloadDeFila: (id: string) => string | null;
}

let deps: DepsWarpIngesta | null = null;

/** Registro de las deps de producción (llamado UNA vez por prescan-qr.ts
 *  al cargar el módulo — MasivaView lo importa estáticamente). `null`
 *  des-registra (reset de pruebas). */
export function __registrarDepsWarpIngesta(d: DepsWarpIngesta | null): void {
  deps = d;
}

// ─── Estado del módulo: cola serial + propiedad + cortesía ──────────────────

/** FIFO de ids en espera (el en-vuelo NO está aquí — está en enVueloId). */
const colaIds: string[] = [];
/** Filas PROPIAS del pase: encoladas O en vuelo — el prescan asegurador
 *  salta estas (el punto 7 del brief: procesa solo filas SIN dueño). */
const enCola = new Set<string>();
let enVueloId: string | null = null;
let bombeando = false;
/** Cortesía — cadenaDedup en vuelo (contador: agregarFiles concurrentes).
 *  Marcado por store.ts alrededor de SU cadena de fondo. */
let dedupEnVuelo = 0;

/** Tope de la espera de CORTESÍA (ms): la subida nueva tiene prioridad,
 *  pero el warp de la anterior nunca queda bloqueado para siempre. */
export const CORTECIA_TOPE_MS = 1500;
/** Paso del sondeo de cortesía (ms). */
export const CORTECIA_PASO_MS = 100;
/** Tope de la espera del prescan asegurador a que esta cola drene (ms) —
 *  acotado: el botón PROCESAR JAMÁS queda rehén del bombeo (timeout ⇒
 *  abort honesto — el barrido de cierre decide igual, residual documentado
 *  en el REPORTE §P5-residual). */
export const ESPERA_COLA_TOPE_MS = 60_000;

/** Dormir inyectable (pruebas — patrón e73). */
let dormir: (ms: number) => Promise<void> = (ms) =>
  new Promise((r) => setTimeout(r, ms));

/** Prueba interna (tests): reemplaza el dormir del módulo. `null` restaura
 *  el real (patrón __setFabricaWorkerDeteccionParaTest). */
export function __setDormirWarpIngestaParaTest(
  fn: ((ms: number) => Promise<void>) | null,
): void {
  dormir = fn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
}

/** (K2) marca/desmarca cadenaDedup en vuelo — la cortesía del bombeo
 *  consulta esto antes de cada fila. Llamado por store.ts SOLO. */
export function marcarCadenaDedupEnVuelo(on: boolean): void {
  dedupEnVuelo = Math.max(0, dedupEnVuelo + (on ? 1 : -1));
}

/** ¿La fila está bajo este pase (encolada o en vuelo)? El prescan
 *  asegurador la salta (punto 7 del brief — su stamp llega con el bombeo). */
export function filaBajoWarpIngesta(id: string): boolean {
  return enCola.has(id) || enVueloId === id;
}

/** Encola UNA fila PENDIENTE viva para el warp de ingesta (idempotente).
 *  El disparo vive en store.ts (fin de agregarFiles) con el guard del flag
 *  masivaWarpIngesta; aquí solo la serialización y el arranque del bombeo. */
export function encolarWarpIngesta(id: string): void {
  if (enCola.has(id) || enVueloId === id) return; // idempotente
  enCola.add(id);
  colaIds.push(id);
  void bombear(); // serial por construcción — no-op si ya corre
}

/** Resuelve true cuando la cola DRENA (sin encoladas y sin fila en vuelo);
 *  false al vencer el tope (abort honesto del caller). El prescan
 *  asegurador espera AQUÍ antes de su barrido de cierre — el barrido NUNCA
 *  releasea filas que este pase está por clasificar (la gemela pagaría
 *  OCR — peligro §3-P5 del plan maestro). */
export async function esperarColaWarpIngesta(topeMs: number): Promise<boolean> {
  const t0 = Date.now();
  while ((colaIds.length > 0 || enVueloId !== null) && Date.now() - t0 < topeMs) {
    await dormir(CORTECIA_PASO_MS);
  }
  return colaIds.length === 0 && enVueloId === null;
}

/** CORTESÍA DE CPU (brief punto 3): esperar a que cadenaDedup termine (o
 *  ceder con tope corto) + ceder SIEMPRE un tick al event loop — la subida
 *  nueva respira aunque el tope venza. */
async function cortesiaDeCpu(): Promise<void> {
  const t0 = Date.now();
  while (dedupEnVuelo > 0 && Date.now() - t0 < CORTECIA_TOPE_MS) {
    await dormir(CORTECIA_PASO_MS);
  }
  await dormir(0); // cede un tick — el warp JAMÁS estrangula la subida
}

// ─── Bombeo serial (1 a la vez — brief punto 3) ─────────────────────────────

/** Procesadora inyectable SOLO para pruebas (la de producción es la real de
 *  abajo — el patrón de __setFabricaWorkerDeteccionParaTest). */
let procesadora: (id: string, cliente: ClientePrescan) => Promise<void> =
  procesarFilaDeCola;

/** Prueba interna (tests): reemplaza la procesadora por fila. `null`
 *  restaura la de producción. */
export function __setProcesadoraWarpIngestaParaTest(
  fn: ((id: string, cliente: ClientePrescan) => Promise<void>) | null,
): void {
  procesadora = fn ?? procesarFilaDeCola;
}

async function bombear(): Promise<void> {
  if (bombeando) return; // serial por construcción
  bombeando = true;
  // El cliente del worker vive por DRENAJE (patrón del prescan: un cliente
  // por pase, R6 destruye al final): el boot de OpenCV (1-3 s) se amortiza
  // entre las filas del mismo drenaje; con subida espaciada paga boot por
  // drenaje (coste del feature — kill-switchable).
  let cliente: ClientePrescan | null = null;
  try {
    while (colaIds.length > 0) {
      const id = colaIds.shift() as string;
      enVueloId = id;
      try {
        await cortesiaDeCpu();
        if (!cliente) {
          cliente = crearClientePrescan();
          if (!(await cliente.listo())) {
            // Abort honesto (§G e107): el lector no booteó — las filas
            // quedan PENDIENTE y el prescan asegurador las cubre (flujo de
            // hoy). La cola se vacía SIN estamps y sin zombis de propiedad.
            logger.warn(
              "[e14] warp-ingesta: lector no disponible — abort honesto (el prescan asegurador decide)",
            );
            for (const pendiente of colaIds) enCola.delete(pendiente);
            colaIds.length = 0;
            break;
          }
        }
        await procesadora(id, cliente);
      } finally {
        enVueloId = null;
        enCola.delete(id);
      }
    }
  } finally {
    try {
      cliente?.destruir(); // R6 — el worker muere SIEMPRE al terminar (RAM)
    } catch {
      /* noop */
    }
    bombeando = false;
  }
}

// ─── Lectura del QR sobre el warp CON ubicación (cuadrante) ─────────────────

/** Declaración local mínima (module-scoped — no colisiona con la de
 *  prescan-qr.ts): aquí el CORNER-SET importa (el centroide → cuadrante).
 *  §F.1 e107: ordenado por el dueño para este módulo y seguro por igualdad
 *  EXACTA del payload (Reed-Solomon — el error cae del lado conservador). */
interface HitBarcode {
  rawValue: string;
  cornerPoints?: { x: number; y: number }[];
}
declare const BarcodeDetector:
  | (new (opts?: { formats?: string[] }) => {
      detect(source: ImageBitmapSource): Promise<HitBarcode[]>;
    })
  | undefined;

/** Cap del prescan para rasterizar el warp en el fallback jsQR (mismo valor
 *  — QR_WARP_LADO_TOPE de prescan-qr.ts; duplicar la CONSTANTE aquí rompería
 *  la paridad si una cambia sola — se ancla por QA). Const interna — knip
 *  limpio (la QA la ancla por literal). */
const QR_WARP_LADO_TOPE = 1600;

/** Lectura sobre el warp + centroide normalizado (0-1) del QR. */
interface LecturaWarp {
  payload: string;
  centroide: { fx: number; fy: number } | null;
}

/**
 * MISMA cadena del prescan (BarcodeDetector → jsQR ≤1600) pero capturando
 * la UBICACIÓN (el cuadrante del QR la necesita y el helper del prescan
 * solo devuelve el payload). El fallback jsQR es byte-equivalente a
 * intentoSobrePixeles(BANDA_A) — banda completa × escala 1 = copia
 * identidad + jsQR attemptBoth — llamada DIRECTA porque el helper no
 * expone res.location (equivalencia documentada en el REPORTE). Sin throw
 * jamás (doctrina del conservador).
 */
async function leerQrConUbicacion(warped: ImageBitmap): Promise<LecturaWarp | null> {
  try {
    if (typeof BarcodeDetector !== "undefined") {
      try {
        const bd = new BarcodeDetector({ formats: ["qr_code"] });
        const hits = await bd.detect(warped);
        const hit = hits.find((h) => h.rawValue);
        if (hit) {
          const cp = hit.cornerPoints;
          const centroide =
            cp && cp.length > 0
              ? {
                  fx:
                    cp.reduce((s, p) => s + p.x, 0) / cp.length / warped.width,
                  fy:
                    cp.reduce((s, p) => s + p.y, 0) / cp.length / warped.height,
                }
              : null;
          return { payload: hit.rawValue, centroide };
        }
      } catch {
        /* cae a jsQR */
      }
    }
    if (typeof OffscreenCanvas === "undefined") return null;
    const lado = Math.max(warped.width, warped.height);
    const escala = lado > QR_WARP_LADO_TOPE ? QR_WARP_LADO_TOPE / lado : 1;
    const w = Math.max(1, Math.round(warped.width * escala));
    const h = Math.max(1, Math.round(warped.height * escala));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(warped, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const res = jsQR(img.data, w, h, { inversionAttempts: "attemptBoth" });
    if (!res || !res.data) return null;
    // Tipo de location de jsQR — el vendor .d.ts NO lo declara: cast local
    // (mismo patrón de orientacion-qr.ts:198 — el .js queda INTOCABLE, red
    // line 9). Los 4 vértices → centroide → cuadrante.
    const L = (
      res as unknown as {
        location?: {
          topLeftCorner: { x: number; y: number };
          topRightCorner: { x: number; y: number };
          bottomRightCorner: { x: number; y: number };
          bottomLeftCorner: { x: number; y: number };
        };
      }
    ).location;
    if (!L) return { payload: res.data, centroide: null }; // sin ubicación — payload igual sirve (identidad)
    const centroide = {
      fx:
        (L.topLeftCorner.x + L.topRightCorner.x + L.bottomRightCorner.x + L.bottomLeftCorner.x) /
        4 /
        w,
      fy:
        (L.topLeftCorner.y + L.topRightCorner.y + L.bottomRightCorner.y + L.bottomLeftCorner.y) /
        4 /
        h,
    };
    return { payload: res.data, centroide };
  } catch {
    return null; // sin throw jamás
  }
}

// ─── Estampa de la fila decidida (PURA — testeable, patrón deps e73) ────────

/** Entrada de la estampa: lo que el pipeline de la fila observó. */
export interface DecisionIngesta {
  /** Payload leído SOBRE EL WARP (con ubicación) — null si la lectura falló. */
  payloadWarp: string | null;
  /** Payload HEREDADO del sondeo crudo (qrPayloadDeFila — solo con
   *  masivaQrHandoff ON; el caller ya consulta el mapa). */
  heredado: string | null;
  /** Quad del core (masivaQuad ON + fracciones válidas) o null. */
  quadFila: Quad | null;
  /** Rotación derivada del centroide del warp (rotacionDesdeCentroide) —
   *  el caller la computa; la estampa la pliega tal cual (pura). */
  rotacion: RotacionQr | null;
}

/** Salida de la estampa: el patch + el payload a registrar (si procede). */
export interface EstampaIngesta {
  patch: Partial<FilaMasiva> & { prioridadProceso?: 1 | 2 };
  payloadParaRegistrar: string | null;
}

/** Flags que la estampa consulta (subset — testeable sin leerFlags). */
export interface FlagsEstampa {
  masivaQrHandoff: boolean;
  masivaPrioridad?: boolean; // nace con K1 (Agente A) — stamp PREPARADO
}

/**
 * Estampa de la fila decidida (pura — la escritura la hace el caller):
 *  · prescanOk SIEMPRE — la fila quedó decidida por este pase (veredicto
 *    aplicado o lectura imposible — misma semántica del stamp P5).
 *  · quad — solo si vino (flag masivaQuad ya aplicado por el caller).
 *  · rotacionSugerida — SOLO del warp: lectura OK ⇒ el valor del centroide;
 *    lectura fallida ⇒ null EXPLÍCITO (el instrumento corrió y no decidió —
 *    el heredado no trae ubicación: identidad sin geometría).
 *  · payload para registrar — HEREDADO manda (misma identidad EXACTA ya
 *    leída por el sondeo crudo; llave opaca), si no el del warp — SOLO con
 *    masivaQrHandoff ON (el mapa payload→id de la capa 0 queda completo
 *    también para las filas que el prescan asegurador salta).
 *  · prioridadProceso — K1 STAMP PREPARADO (flag nace con K1): 1 = QR
 *    leído + quad OK; 2 = resto (la DUPLICADA se deriva del estado — el
 *    campo NO guarda 3, una sola fuente de verdad, brief K1).
 */
export function estampaDeIngesta(
  d: DecisionIngesta,
  flags: FlagsEstampa,
): EstampaIngesta {
  const payload = d.heredado ?? d.payloadWarp;
  const patch: Partial<FilaMasiva> & { prioridadProceso?: 1 | 2 } = {
    prescanOk: true,
    ...(d.quadFila ? { quad: d.quadFila } : {}),
    rotacionSugerida: d.payloadWarp != null ? d.rotacion : null,
    ...(flags.masivaPrioridad === true
      ? { prioridadProceso: d.payloadWarp != null && d.quadFila ? 1 : 2 }
      : {}),
  };
  return { patch, payloadParaRegistrar: flags.masivaQrHandoff ? payload : null };
}

// ─── Pipeline real por fila (producción) ────────────────────────────────────

async function procesarFilaDeCola(id: string, cliente: ClientePrescan): Promise<void> {
  const t0 = Date.now();
  const d = deps;
  if (!d) {
    // Sin deps (SSR/prerender/prueba sin registro) → conservador: la fila
    // queda PENDIENTE y el prescan asegurador la cubre (comportamiento de hoy).
    logger.warn("[e14] warp-ingesta: deps no registradas — fila para el asegurador");
    return;
  }
  try {
    // Anti-zombi de ENTRADA: la fila pudo morir (quitar/vaciar/PROCESAR IGUAL)
    // mientras esperaba su turno en la cola.
    const st = d.storeState();
    const fila = st.filas.find((f) => f.id === id);
    if (!fila || fila.estado !== "PENDIENTE" || fila.forzarDedupOff) return;
    // Bytes originales: duermen en IDB (RegistroMasiva.archivo) — el gesto
    // real del repo (desviación M-e107-2 del REPORTE del kit e107).
    const reg = await leerRegistro(id).catch(() => null);
    const blob = reg?.archivo ?? null;
    if (!blob) return; // sin bytes → el prescan asegurador decide (§G e107)
    // Decode rápido respetando EXIF (kit R5 — imageOrientation).
    const bitmapFull = await createImageBitmap(blob, {
      imageOrientation: "from-image",
    }).catch(() => null);
    if (!bitmapFull) return; // corrupto/HEIC raro → PENDIENTE (§G)
    let quadFrac: Float32Array | null = null;
    let lectura: LecturaWarp | null = null;
    let cerrarFull = true; // el warp TRANSFIERE el bitmap (detached) — close no-op
    try {
      const bitmap400 = await downscaleLado(bitmapFull, DETECT_LONG_SIDE).catch(
        () => null,
      );
      if (!bitmap400) return;
      quadFrac = await cliente.detectar(bitmap400); // bitmap400 TRANSFERIDO
      if (!quadFrac) return; // sin quad → sin warp → sin stamp (camino de hoy)
      const warped = await cliente.warpar(bitmapFull, quadFrac); // bitmapFull TRANSFERIDO
      if (warped) {
        cerrarFull = false; // detached — el close de abajo es no-op honesto
        try {
          lectura = await leerQrConUbicacion(warped);
        } finally {
          try {
            warped.close();
          } catch {
            /* noop */
          }
        }
      }
    } finally {
      if (cerrarFull) {
        try {
          bitmapFull.close();
        } catch {
          /* noop */
        }
      }
    }
    // Anti-zombi de SALIDA (fresco — la fila pudo morir en el pipeline de
    // arriba): el stamp exige fila VIVA y PENDIENTE (§G e107) y el escape
    // del dueño manda SIEMPRE (RL-e65b-6).
    const st2 = d.storeState();
    const viva = st2.filas.find((f) => f.id === id);
    if (!viva || viva.estado !== "PENDIENTE" || viva.forzarDedupOff) return;
    const flags = leerFlags();
    const flagsK1 = flags as FlagsApp & { masivaPrioridad?: boolean };
    const rotacion: RotacionQr | null =
      lectura?.payload != null && lectura.centroide
        ? rotacionDesdeCentroide(lectura.centroide.fx, lectura.centroide.fy)
        : null;
    const heredado = flags.masivaQrHandoff ? d.qrPayloadDeFila(id) : null;
    const quadFila = flags.masivaQuad === true ? quadDeFracciones(quadFrac) : null;
    const { patch, payloadParaRegistrar } = estampaDeIngesta(
      {
        payloadWarp: lectura?.payload ?? null,
        heredado,
        quadFila,
        rotacion,
      },
      { masivaQrHandoff: flags.masivaQrHandoff, masivaPrioridad: flagsK1.masivaPrioridad },
    );
    // El registro del payload va ANTES del patch (la capa 0/asegurador ven
    // el mapa completo cuando la fila aparece decidida — mismo orden del
    // veredicto "registrar" del prescan).
    if (payloadParaRegistrar) d.registrarQrPayload(payloadParaRegistrar, id);
    st2.actualizarFila(id, patch);
    logger.info(
      `[e14] warp-ingesta fila=${id} ms=${Date.now() - t0} quad=${quadFila ? 1 : 0} qr=${lectura?.payload != null ? 1 : 0} rot=${rotacion ?? "null"} heredado=${heredado != null ? 1 : 0}`,
    );
  } catch {
    /* el warp de ingesta JAMÁS tumba la ingesta — la fila queda PENDIENTE
       (regla de oro 4; el prescan asegurador la cubre) */
  }
}

// ─── Reset de pruebas ───────────────────────────────────────────────────────

/** Prueba interna (tests): reset TOTAL del estado del módulo (cola,
 *  propiedad, cortesía, bombeo). */
export function __resetWarpIngestaParaTest(): void {
  colaIds.length = 0;
  enCola.clear();
  enVueloId = null;
  bombeando = false;
  dedupEnVuelo = 0;
}
