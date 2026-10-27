"use client";

/**
 * KIT e107-prescan-qr-cola-v1 (§D.2) — orquestador del PRE-SCAN QR en
 * «PROCESAR COLA» + clasificador PURO + hook de progreso.
 *
 * El pedido del dueño (§0, contrato):
 *   Fase 1 — PRE-SCAN rápido: decode (EXIF ✓) → detección de quad con el
 *   detection-worker REAL → warp (recorte SIN rotar) → lectura de QR
 *   (BarcodeDetector → jsQR — sin el decodificador wasm lento, §F.3).
 *   Fase 2 — clasificación: DUPLICADA / YA-ENVIADA marcadas ANTES del OCR
 *   (el ahorro de los ~40 s); QR no leído JAMÁS se descarta — pasa al flujo
 *   normal (regla de oro 4).
 *   Fase 3 — tM() de siempre con la lista ya filtrada: «filtrar la lista»
 *   son MARCAS de estado previas a iniciar() (§B del kit) — CERO cambios en
 *   el runner/store: el único punto de contacto es la llamada `iniciar()`.
 *
 * Reglas de oro → cumplimiento mecánico (§E):
 *  · No tocar tM(): 0 edits en runner.ts/store.ts (QA lo escanea).
 *    — ENMIENDA KIT e14-quad-streaming-v1 (P5, orden del dueño): el runner
 *    ahora CONSUME por turno de clasificación (flag masivaStreaming, default
 *    OFF): `siguientePendiente` filtra por prescanOk mientras el turno está
 *    abierto y `iniciarRunner` re-chequea tras el drenaje. El QA
 *    qa-prescan-qr-cola.ts §G se actualiza EN ESTE MISMO kit (permite
 *    exactamente el token prescanOk en runner.ts/tipos.ts — el contrato
 *    e107 «cero edits» queda ampliado, todo lo demás intacto).
 *  · UI de progreso: «SONDEANDO QR… k/N» vía usePrescanQrEstado (D.3).
 *  · No bloquear main thread: detect/warp viven en el worker REAL; FIFO
 *    serial + hard-kill en prescan-qr.client.ts.
 *  · Sin pérdida de datos: cualquier fallo ⇒ fila queda PENDIENTE ⇒ Fase 3
 *    la procesa como hoy (try/catch por fila + guards anti-zombi).
 *
 * KIT e14-quad-streaming-v1 (P4): el quad detectado por el pre-scan ya NO
 * se tira — se estampa en la fila (RAM del lote) y el runner lo pasa al
 * bridge como quadPrecomputado (flag masivaQuad, default OFF) para saltar
 * la re-detección (desviación D66 resuelta — precalor.ts:26-31).
 * KIT e14-quad-streaming-v1 (P5, flag masivaStreaming, default OFF):
 * streaming seguro prescan→runner — variante SEGURA del plan §3-P5:
 *  · El turno se ABRE al empezar y se CIERRA en el finally (tras el
 *    barrido de cierre) — mientras está abierto, el filtro del runner
 *    solo consume filas decididas (prescanOk / DUPLICADA / nacidas después
 *    del arranque del turno). Sin turno abierto el filtro queda inerte:
 *    sin hambruna posible.
 *  · Arranque TEMPRANO: `iniciar()` tras el PRIMER stamp (el runner FIFO
 *    consume por agregadaEn a medida que las filas se deciden).
 *  · Barrido de cierre en el finally: toda fila del objetivo que siga
 *    PENDIENTE sin stamp (abort honesto, continue, catch) queda decidida
 *    aquí — JAMÁS una fila colgada.
 *  · PROCESAR IGUAL (forzarDedupOff — RL-e65b-6, el escape del dueño es
 *    sagrado): stamp UPFRONT — va directo al runner sin pre-scan.
 *  · Las guardas existentes (re-chequeo post-reserva runner.ts,
 *    esperarDesenlaceOriginal) quedan intactas — defensa en profundidad.
 *
 * El decodificador wasm lento: NO importado aquí (§F.3 — QA: 0 matches del
 * token). El tier correspondiente de la capa 0 (identidad-qr.ts) queda
 * intacto — cambio separado.
 */
import { create } from "zustand";
import { logger } from "../../logger";
import { leerFlags } from "../flags";
import {
  crearClientePrescan,
  DETECT_LONG_SIDE,
  type ClientePrescan,
} from "./prescan-qr.client";
import { BANDA_A, intentoSobrePixeles, type PixelesQr } from "./qr-pixeles";
import {
  enviadaPorPayload as enviadaPorPayloadStore,
  marcarYaEnviada,
  originalQrDePayload as originalQrDePayloadStore,
  // P1 (plan masiva — brief Agente A): herencia del payload del sondeo
  // (flag masivaQrHandoff — default OFF; sin dato → camino de hoy).
  qrPayloadDeFila as qrPayloadDeFilaStore,
  registrarQrPayload as registrarQrPayloadStore,
  useMasivaStore,
} from "./store";
import { guardarRegistro, leerRegistro } from "./cola";
import type { FilaMasiva } from "./tipos";
// KIT e14-quad-streaming-v1 (P5): semáforo del turno — runner.ts lo consulta
// en su filtro; aquí solo se abre/cierra (módulo sin imports — sin ciclos).
import {
  abrirTurnoClasificacion,
  cerrarTurnoClasificacion,
} from "./turno-clasificacion";
// KIT e14-quad-streaming-v1 (P4): forma canónica del quad del core (solo tipo).
import type { Quad } from "@jg-stevan/scanner-core/types";

// ─── Clasificador PURO (testeable — deps inyectadas, patrón e73) ────────────

/** Veredicto del pre-scan para UNA fila (§D.2 — ESPEJO de cadenaDedup:
 *  primer ganador gana, FIFO por agregadaEn). */
export type VeredictoPrescan =
  | { accion: "duplicada"; originalId: string }
  | { accion: "ya-enviada"; enviadaId: string }
  | { accion: "registrar" } // payload NUEVO → registrarQrPayload + sigue PENDIENTE
  | { accion: "nada" }; // sin payload / conservador → sigue PENDIENTE

export interface DepsClasificadorPrescan {
  originalDePayload: (p: string) => string | null;
  /** existe en filas (viva — QUITADA/vaciada ⇒ false). */
  filaViva: (id: string) => boolean;
  enviadaPorPayload: (p: string) => Promise<{ id: string } | null>;
}

/**
 * Orden de decisión (kit §D.2 — literal):
 *  1. payload null → `nada` (los 4 arrugados pasan al flujo normal — regla
 *     de oro 4).
 *  2. original = originalDePayload(payload); si existe, ≠ filaId y la fila
 *     original está VIVA → `duplicada` (el reuso clona el desenlace — jamás
 *     doble envío).
 *     Guard transversal: match a fila NO viva → `nada` (conservador: OCR
 *     decidirá — jamás marcar DUPLICADA apuntando a un zombi).
 *  3. Si no: enviadaPorPayload(payload) → `ya-enviada` (via "payload") —
 *     mismo self-guard de la capa 0 (runner.ts:567: hit.id !== fila.id).
 *  4. Si no: `registrar`.
 */
export async function clasificarPayloadPrescan(
  payload: string | null,
  filaId: string,
  deps: DepsClasificadorPrescan,
): Promise<VeredictoPrescan> {
  // 1 · sin payload — los arrugados/giros pasan al OCR (jamás descartar)
  if (payload == null || payload.length === 0) return { accion: "nada" };
  // 2 · dup EN LOTE (mapaQrPayload — capas 0 del runner ven lo mismo)
  const original = deps.originalDePayload(payload);
  if (original != null && original !== filaId) {
    if (deps.filaViva(original)) return { accion: "duplicada", originalId: original };
    return { accion: "nada" }; // guard transversal — conservador: OCR decidirá
  }
  // 3 · histórico de ENVIADAS (ledger persistente — hit ⇒ YA-ENVIADA)
  const hit = await deps.enviadaPorPayload(payload);
  if (hit && hit.id !== filaId) return { accion: "ya-enviada", enviadaId: hit.id };
  // 4 · payload NUEVO — se registra (la capa 0 del runner lo verá igual)
  return { accion: "registrar" };
}

// ─── Objetivo del pre-scan (R3 — puro, testeable) ───────────────────────────

/**
 * Filas objetivo del pre-scan: SOLO PENDIENTE vivas. `forzarDedupOff`
 * (PROCESAR IGUAL / e65b) manda SIEMPRE — RL-e65b-6: el escape del dueño es
 * sagrado, la fila va directa a la Fase 3 sin pasar por el pre-scan.
 */
export function objetivoPrescan(filas: FilaMasiva[]): FilaMasiva[] {
  return filas.filter((f) => f.estado === "PENDIENTE" && !f.forzarDedupOff);
}

// ─── Escritura del veredicto (extraída para vitest — patrón deps e73) ───────

export interface DepsEscrituraPrescan {
  leerRegistro: typeof leerRegistro;
  guardarRegistro: typeof guardarRegistro;
  actualizarFila: (id: string, patch: Partial<FilaMasiva>) => void;
  marcarYaEnviada: typeof marcarYaEnviada;
  registrarQrPayload: (payload: string, id: string) => void;
}

/**
 * Escribe el veredicto con la MISMA maquinaria de marcas de siempre (§C):
 *  · duplicada → write IDB (patrón cadenaDedup store.ts:586-594) + patch
 *    SOLO-VISUAL. §F.2: el write OMITE el campo `dedup` (opcional) —
 *    estado:"DUPLICADA" + dupOf bastan para reuso/UI/informe; el pre-scan
 *    NO miente telemetría ajena (sin token "qr-prescan" en la unión §G).
 *  · ya-enviada → marcarYaEnviada COMPLETA (guard anti-zombi + write IDB +
 *    patchFila + alimenta el ledger) con via "payload" (§C).
 *  · registrar → registrarQrPayload(payload, id) — la capa 0 del runner lo
 *    verá igual en su re-chequeo.
 *  · nada → no-op (queda PENDIENTE — Fase 3 lo procesa).
 * El CALLER ya garantizó fila VIVA y PENDIENTE en el instante previo al
 * write (anti-zombi §G); marcarYaEnviada re-verifica su guard por dentro.
 */
export async function aplicarVeredictoPrescan(
  filaId: string,
  veredicto: VeredictoPrescan,
  payload: string | null,
  deps: DepsEscrituraPrescan,
): Promise<void> {
  switch (veredicto.accion) {
    case "duplicada": {
      try {
        const reg = await deps.leerRegistro(filaId);
        await deps.guardarRegistro({
          ...reg,
          estado: "DUPLICADA",
          dupOf: veredicto.originalId,
          // SIN campo `dedup` (§F.2) — es opcional; el comportamiento queda
          // completo (reuso <1 s, UI, informe) y el contrato D57 intacto.
        });
      } catch {
        /* IDB caída / fila fuera de la cola → patch solo en memoria */
      }
      deps.actualizarFila(filaId, { estado: "DUPLICADA", dupOf: veredicto.originalId });
      return;
    }
    case "ya-enviada":
      // §C — marcarYaEnviada TAL CUAL (via "payload"): su guard interno
      // exige PENDIENTE (anti-zombi doble) y alimenta el ledger (RL-e65b-2).
      await deps.marcarYaEnviada(
        filaId,
        veredicto.enviadaId,
        "payload",
        undefined,
        undefined,
        payload ?? undefined,
      );
      return;
    case "registrar":
      if (payload) deps.registrarQrPayload(payload, filaId);
      return;
    case "nada":
      return; // queda PENDIENTE — Fase 3 lo procesa
  }
}

// ─── Lectura de QR sobre el warp — EXACTAMENTE la cadena del harness ────────

/** Declaración local mínima — el repo NO declara BarcodeDetector (la red
 *  line de identidad-qr.ts:54 lo PROHIBE para la capa 0/identidad y ese
 *  archivo queda INTACTO). §F.1: aquí lo ordena el dueño para este módulo
 *  NUEVO y es seguro por igualdad EXACTA de payload (Reed-Solomon — no hay
 *  «casi el mismo payload»; el error siempre cae del lado conservador). */
interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}
declare const BarcodeDetector:
  | (new (opts?: { formats?: string[] }) => BarcodeDetectorLike)
  | undefined;

/** Cap del harness para rasterizar el warp en el fallback jsQR. */
const QR_WARP_LADO_TOPE = 1600;

/**
 * (a) BarcodeDetector nativo → (b) jsQR sobre los píxeles del warp
 * (intentoSobrePixeles — tryBoth ya viene adentro) → (c) null. Sin throw
 * jamás (doctrina del conservador).
 */
export async function leerQrDeWarped(warped: ImageBitmap): Promise<string | null> {
  try {
    if (typeof BarcodeDetector !== "undefined") {
      try {
        const bd = new BarcodeDetector({ formats: ["qr_code"] });
        const hits = await bd.detect(warped);
        if (hits.length > 0 && hits[0]!.rawValue) return hits[0]!.rawValue;
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
    const pix: PixelesQr = { data: img.data, width: w, height: h };
    return intentoSobrePixeles(pix, BANDA_A);
  } catch {
    return null; // (c) sin throw jamás
  }
}

// ─── Estado del pre-scan (banner D.3 — «SONDEANDO QR… k/N») ─────────────────

export type FasePrescan = "idle" | "boot" | "sondeo" | "fin";

export interface EstadoPrescan {
  corriendo: boolean;
  total: number;
  listo: number;
  leidos: number;
  fase: FasePrescan;
}

export const usePrescanStore = create<EstadoPrescan>(() => ({
  corriendo: false,
  total: 0,
  listo: 0,
  leidos: 0,
  fase: "idle",
}));

/** Hook del banner (D.3) — mismo gesto de suscripción del store masiva. */
export function usePrescanQrEstado(): EstadoPrescan {
  return usePrescanStore();
}

function emitir(parche: Partial<EstadoPrescan>): void {
  usePrescanStore.setState(parche);
}

// ─── Deps de producción (§C — las export reales del repo, tal cual) ─────────

const DEPS_CLASIFICADOR: DepsClasificadorPrescan = {
  originalDePayload: originalQrDePayloadStore,
  filaViva: (id) => useMasivaStore.getState().filas.some((f) => f.id === id),
  enviadaPorPayload: enviadaPorPayloadStore,
};

const DEPS_ESCRITURA: DepsEscrituraPrescan = {
  leerRegistro,
  guardarRegistro,
  actualizarFila: (id, patch) => useMasivaStore.getState().actualizarFila(id, patch),
  marcarYaEnviada,
  registrarQrPayload: registrarQrPayloadStore,
};

// ─── Downscale a la clase 400 del core (mismo gesto del harness) ────────────

async function downscaleLado(bitmap: ImageBitmap, ladoObjetivo: number): Promise<ImageBitmap> {
  const lado = Math.max(bitmap.width, bitmap.height);
  if (lado <= ladoObjetivo) return bitmap; // ya chico — se transfiere tal cual
  const escala = ladoObjetivo / lado;
  const w = Math.max(1, Math.round(bitmap.width * escala));
  const h = Math.max(1, Math.round(bitmap.height * escala));
  return await createImageBitmap(bitmap, {
    resizeWidth: w,
    resizeHeight: h,
    resizeQuality: "low", // clase 400 del core — velocidad sobre nitidez
  });
}

// ─── KIT e14-quad-streaming-v1 (P4) — quad del pre-scan ya NO se tira ───────

/**
 * Float32Array(8) del worker (fracciones 0-1, TL,TR,BR,BL — contrato del
 * cliente prescan-qr.client.ts) → Quad del core ([{x,y}×4]). null ante
 * CUALQUIER duda (longitud/NaN — conservador: el stamp jamás inventa; sin
 * quad la fila procesa con detección propia como siempre). El bridge
 * RE-VALIDA la plausibilidad por su lado (guard doble).
 * Export SOLO-TEST (knip tiene los *.test.ts como entry — cero export muerto).
 */
export function quadDeFracciones(a: Float32Array | null | undefined): Quad | null {
  try {
    if (!a || a.length !== 8) return null;
    const v = Array.from(a);
    if (v.some((n) => !Number.isFinite(n))) return null;
    return [
      { x: v[0]!, y: v[1]! },
      { x: v[2]!, y: v[3]! },
      { x: v[4]!, y: v[5]! },
      { x: v[6]!, y: v[7]! },
    ];
  } catch {
    return null; // jamás throw — doctrina del conservador
  }
}

// ─── Orquestador (impuro — D.1 + export de §C) ──────────────────────────────

// Re-entrada R0 (doble protección con el flag del store — kit §D.2).
let corriendoModulo = false;

/**
 * Interceptar el clic de «PROCESAR COLA»: pre-scan QR de las PENDIENTE
 * vivas → marcar DUPLICADA / YA-ENVIADA / registrar payloads → iniciar().
 * Kill-switch OFF (prescanQrCola=false) ⇒ `iniciar()` byte-idéntico a hoy
 * (sin instanciar worker ni emitir estado — R1).
 */
export async function prescanYIniciar(): Promise<void> {
  // R0 — re-entrada: doble clic / clic durante pre-scan → no-op
  if (corriendoModulo || usePrescanStore.getState().corriendo) return;
  const store = useMasivaStore.getState();
  // R1 — kill-switch del dueño: flag OFF ⇒ byte-idéntico a hoy
  if (!leerFlags().prescanQrCola) {
    store.iniciar();
    return;
  }
  // R2 — cola ya corriendo (iniciar() es singleton no-op, igual hoy)
  if (store.corriendo) {
    store.iniciar();
    return;
  }
  // R3 — objetivo: solo PENDIENTE vivas; PROCESAR IGUAL manda SIEMPRE
  // KIT e14-quad-streaming-v1 (P5): los kill-switches y el TURNO se
  // resuelven AQUÍ, en el tramo 100% SÍNCRONO anterior al primer await —
  // el snapshot del objetivo y la marca del turno ven la MISMA tienda:
  // toda fila del objetivo nació con agregadaEn <= inicioTurno (el filtro
  // del runner no la exenta jamás: protegida hasta SU stamp); las que
  // lleguen después nacen exentas (nadie las va a clasificar). Los flags
  // se leen UNA vez por corrida (corrida atómica frente a flags).
  const quadOn = leerFlags().masivaQuad === true; // P4 — estampar el quad
  const streamingOn = leerFlags().masivaStreaming === true; // P5 — por turno
  // W1 (KIT k1-obs-prioridad — brief Agente A): estampar la prioridad de
  // fila (paso 4 del dueño). Mismo gesto P4/P5: los flags se leen UNA vez
  // por corrida (corrida atómica frente a flags).
  const prioridadOn = leerFlags().masivaPrioridad === true;
  if (streamingOn) abrirTurnoClasificacion(Date.now());
  const objetivo = objetivoPrescan(useMasivaStore.getState().filas);
  if (objetivo.length === 0) {
    if (streamingOn) cerrarTurnoClasificacion(); // sin objetivo — turno inerte
    store.iniciar(); // idempotente, como hoy
    return;
  }
  if (streamingOn) {
    // RL-e65b-6 — el escape del dueño es sagrado: las PROCESAR IGUAL van
    // DIRECTO al pool sin pre-scan (stamp upfront — sin carrera posible:
    // nadie las va a clasificar jamás).
    for (const f of useMasivaStore.getState().filas) {
      if (f.estado === "PENDIENTE" && f.forzarDedupOff) {
        useMasivaStore.getState().actualizarFila(f.id, { prescanOk: true });
      }
    }
  }
  corriendoModulo = true;
  emitir({ corriendo: true, total: objetivo.length, listo: 0, leidos: 0, fase: "boot" });
  let leidos = 0;
  const cliente: ClientePrescan = crearClientePrescan(); // R4
  try {
    if (!(await cliente.listo())) {
      // Abort honesto (§G): worker no bootea → flujo de HOY byte-idéntico.
      logger.info("[e14] prescan-qr: lector no disponible — flujo de hoy (abort honesto)");
    } else {
      emitir({ fase: "sondeo" });
      // R5 — FASE 1+2: por fila, EN ORDEN FIFO (for...of, serial, RAM móvil)
      let procesadas = 0;
      for (const fila of objetivo) {
        emitir({ listo: procesadas, leidos }); // «SONDEANDO QR… k/N»
        try {
          // P1 (brief Agente A) — flag masivaQrHandoff: si el sondeo de
          // ingesta (e73) YA leyó el QR de esta fila, TODO el bloque de
          // lectura de abajo (decode FULL + OpenCV + warp + BarcodeDetector/
          // jsQR) existía SOLO para obtener este payload → clasificar directo
          // y saltar (el quad no viaja — eso es P4, otro parche). Anti-zombi
          // IGUAL que el camino lento (fila VIVA y PENDIENTE en el instante
          // del write); flag OFF / sin payload estampado → camino de hoy byte
          // a byte. El estampado en mapaQrPayload lo hace aplicarVeredicto
          // (veredicto "registrar") — el mapa queda como siempre.
          const heredado = leerFlags().masivaQrHandoff
            ? qrPayloadDeFilaStore(fila.id)
            : null;
          if (heredado != null) {
            const vivaH = useMasivaStore
              .getState()
              .filas.find((f) => f.id === fila.id);
            if (vivaH && vivaH.estado === "PENDIENTE") {
              const veredictoH = await clasificarPayloadPrescan(
                heredado,
                fila.id,
                DEPS_CLASIFICADOR,
              );
              await aplicarVeredictoPrescan(fila.id, veredictoH, heredado, DEPS_ESCRITURA);
              leidos++;
              logger.info(
                `[e14] prescan-qr hereda payload (handoff) fila=${fila.id} veredicto=${veredictoH.accion}`,
              );
              // INTEGRACIÓN P1×P5 (e14-quad-streaming-v1): el camino heredado
              // TAMBIÉN es «fila decidida» — stamp prescanOk AQUÍ, no en el
              // barrido de cierre (sin esto, la fila más barata de clasificar
              // — sondeo-OK, lectura saltada — no llegaba al pool hasta el
              // FINAL del pase: P5 perdía a sus mejores clientes). Sin quad:
              // este camino no decodifica nada (el bridge detecta por su
              // lado, igual que hoy). Re-lectura fresca anti-zombi — mismo
              // gesto del stamp del camino lento.
              const vivaStampH = useMasivaStore
                .getState()
                .filas.find((f) => f.id === fila.id);
              if (vivaStampH && vivaStampH.estado === "PENDIENTE" && streamingOn) {
                useMasivaStore.getState().actualizarFila(fila.id, { prescanOk: true });
                useMasivaStore.getState().iniciar(); // P5 — arranque temprano
              }
            }
            continue; // el finally de abajo hace procesadas++ (contador honesto)
          }
          // Bytes originales: duermen en IDB (RegistroMasiva.archivo) —
          // NO hay `fila.file` en RAM (kit R5 dice fila.file; el gesto real
          // del repo es leerRegistro — desviación M-e107-2 del REPORTE).
          const reg = await leerRegistro(fila.id);
          const blob = reg.archivo;
          if (!blob) continue; // sin bytes → PENDIENTE (Fase 3)
          // Decode rápido respetando EXIF (kit R5 — imageOrientation).
          const bitmapFull = await createImageBitmap(blob, {
            imageOrientation: "from-image",
          }).catch(() => null);
          if (!bitmapFull) continue; // corrupto/HEIC raro → PENDIENTE (§G)
          let payload: string | null = null;
          // P4 — el quad detectado ya NO se tira (stamp aditivo abajo —
          // solo si masivaQuad ON; sin flag el trabajo es el de hoy).
          let quadVisto: Float32Array | null = null;
          try {
            const bitmap400 = await downscaleLado(bitmapFull, DETECT_LONG_SIDE).catch(
              () => null,
            );
            if (bitmap400) {
              const quad = await cliente.detectar(bitmap400); // bitmap400 transferido
              if (quad) {
                quadVisto = quad; // P4 — captura para el stamp (no altera el flujo)
                // bitmapFull TRANSFERIDO aquí (detached — close() de abajo
                // es no-op honesto); el warp sale SIN rotar (Anexo 1).
                const warped = await cliente.warpar(bitmapFull, quad);
                if (warped) {
                  try {
                    payload = await leerQrDeWarped(warped);
                  } finally {
                    try {
                      warped.close();
                    } catch {
                      /* noop */
                    }
                  }
                }
              }
            }
          } finally {
            try {
              bitmapFull.close(); // no-op si fue transferido (detached)
            } catch {
              /* noop */
            }
          }
          // Anti-zombi: la fila pudo morir (quitar/vaciar) durante el sondeo
          // — el write del pre-scan exige fila VIVA y PENDIENTE (§G).
          const viva = useMasivaStore.getState().filas.find((f) => f.id === fila.id);
          if (!viva || viva.estado !== "PENDIENTE") continue;
          const veredicto = await clasificarPayloadPrescan(payload, fila.id, DEPS_CLASIFICADOR);
          await aplicarVeredictoPrescan(fila.id, veredicto, payload, DEPS_ESCRITURA);
          if (payload) leidos++;
          // KIT e14-quad-streaming-v1 (P4/P5) — stamp de la fila decidida.
          // Sin awaits entre el veredicto aplicado y este stamp (re-lectura
          // fresca anti-zombi): el pool jamás ve la fila a medio decidir —
          // sin stamp el filtro del runner la retiene (streaming ON).
          // · prescanOk (P5): la fila entra al FIFO del pool YA (arranque
          //   temprano — iniciar() idempotente, no-op mientras corre).
          // · quad (P4): fracciones del worker — solo con flag ON y lectura
          //   del pre-scan; quadDeFracciones valida la forma (jamás inventa).
          const vivaStamp = useMasivaStore.getState().filas.find((f) => f.id === fila.id);
          if (vivaStamp && vivaStamp.estado === "PENDIENTE") {
            const quadFila = quadOn ? quadDeFracciones(quadVisto) : null;
            // W1 (KIT k1-obs-prioridad — brief Agente A): estampado de la
            // prioridad de fila — SOLO con flag masivaPrioridad ON:
            //  · 1 — fila CON QR leído (payload del warp — warp OK por
            //    construcción) + quad OK (el worker detectó el quad que
            //    produjo el warp).
            //  · 2 — fila sin QR (lectura imposible — el warp no rescató).
            //  · Sin stamp (continue por fila sin bytes/decode, barrido de
            //    cierre, camino hand-off) ⇒ prioridad EFECTIVA 2 por default
            //    en el sort del runner (JAMÁS se estampa 3: la DUPLICADA se
            //    deriva del estado — fuente única de verdad).
            const prioridadFila = prioridadOn
              ? payload != null && quadVisto != null
                ? 1
                : 2
              : null;
            if (streamingOn || quadFila || prioridadFila != null) {
              useMasivaStore.getState().actualizarFila(fila.id, {
                ...(streamingOn ? { prescanOk: true } : {}),
                ...(quadFila ? { quad: quadFila } : {}),
                ...(prioridadFila != null
                  ? { prioridadProceso: prioridadFila }
                  : {}),
              });
              if (streamingOn) useMasivaStore.getState().iniciar(); // P5 — temprano
            }
          }
        } catch {
          /* fila sigue PENDIENTE — JAMÁS descartar (regla de oro 4) */
        } finally {
          procesadas++;
        }
      }
      emitir({ listo: procesadas, leidos });
    }
  } finally {
    // R6 — el worker del pre-scan muere SIEMPRE al terminar (RAM).
    cliente.destruir();
    if (streamingOn) {
      // P5 — BARRIDO DE CIERRE: TODA fila PENDIENTE sin stamp (abort
      // honesto, continue por fila sin bytes/decode, catch, llegada a mitad
      // del turno) queda DECIDIDA aquí — la fase de clasificación de este
      // ciclo terminó y nadie la va a marcar ya. Después el turno CIERRA y
      // el filtro del runner queda INERTE: sin hambruna por construcción.
      for (const f of useMasivaStore.getState().filas) {
        if (f.estado === "PENDIENTE" && f.prescanOk !== true) {
          useMasivaStore.getState().actualizarFila(f.id, { prescanOk: true });
        }
      }
      cerrarTurnoClasificacion();
    }
    emitir({ corriendo: false, fase: "fin", leidos });
    corriendoModulo = false;
  }
  // R7 — FASE 3: tM() con la lista ya filtrada. ÚNICO punto de contacto
  // (flag OFF / abort honesto: iniciar() del flujo de hoy byte-idéntico).
  useMasivaStore.getState().iniciar();
}
