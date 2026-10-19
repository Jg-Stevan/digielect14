"use client";

/**
 * KIT e14-carga-masiva-v1 (T2): motor SECUENCIAL del módulo MASIVA — UNA
 * foto a la vez, SIEMPRE. Por qué secuencial y no en paralelo: el OCR es
 * wasm mono-hilo (GH Pages sin SAB — AUDITORIA §2); dos OCR en paralelo se
 * reparten el mismo CPU → NO hay ganancia y la UI sí sufre. Secuencial =
 * throughput máximo real (~1 acta / 15-18 s → 100 actas ≈ 25-30 min).
 *
 * REGLA DE ORO (kit §0): llama getBridge().escanearActa(...) igual que la
 * app normal — MISMO pipeline, MISMO gate, MISMO desenlace. Nunca escribe
 * actaActual, nunca navega vistas, NUNCA simula. La orquestación vive aquí;
 * el store del flujo normal solo ve las 3 acciones de integración (T3).
 */
import { getBridge } from "../get-bridge";
// KIT e14-masiva-ux-v1 (T4): tipo con el presupuesto de timeout opcional
// (intersección LOCAL en el bridge — kit §1 prohíbe tocar bridge.ts).
import type { OpcionesEscaneoConTimeout } from "../scanner-core-bridge";
import { useE14Store } from "../store";
import { guardarRegistro, leerRegistro } from "./cola";
import { useMasivaStore } from "./store";
import { paginaDeActa, type FilaMasiva, type RegistroMasiva } from "./tipos";
import type { ProgresoAnalisis } from "../types";

/** KIT e14-masiva-ux-v1 (T4): presupuesto del pipeline en MASIVA — 120 s.
 *  Masiva es cola de fondo (no bloquea la UI): con multihilo el pipeline
 *  real tarda ~21 s (informe Vercel del dueño 19/10) y el default de 15 s
 *  falsamente RECHAZADA cada acta con el resultado real descartándose (y el
 *  runner solapando N pipelines compitiendo por CPU). El flujo individual
 *  sigue en 15 s (default de escanearActa); el timeout REAL (>120 s) sigue
 *  resolviendo RECHAZADA «TIEMPO DE PROCESADO EXCEDIDO». */
const TIMEOUT_MASIVA_MS = 120_000;

/** Throttle del progreso (~200 ms — kit §4 regla 3): el OCR emite decenas
 *  de eventos por etapa; la bandeja solo necesita el último. */
const PROGRESO_MS = 200;

let corriendoFlag = false;
let stopFlag = false;
let ultimoProgresoEn = 0;

/** Patch INMUTABLE de UNA fila (la bandeja pinta filas livianas). */
function marcarFila(id: string, patch: Partial<FilaMasiva>): void {
  const filas = useMasivaStore.getState().filas;
  useMasivaStore.setState({
    filas: filas.map((f) => (f.id === id ? { ...f, ...patch } : f)),
  });
}

function progresoThrottled(id: string, p: ProgresoAnalisis): void {
  const ahora = Date.now();
  if (ahora - ultimoProgresoEn < PROGRESO_MS) return;
  ultimoProgresoEn = ahora;
  useMasivaStore.setState({ progreso: { id, etapa: p.etapa, fraccion: p.progreso } });
}

/** Thumb de la bandeja: canvas 2d, lado mayor 320, JPEG 0.7 (kit §4 regla 4).
 *  Con loadImageMemo NO (el thumb es una foto distinta; decode directo y
 *  fuera — la RAM muere con el canvas). También lo usa el mini-store al
 *  re-sincronizar un acta editada en REVISIÓN (thumb fresco tras recorte). */
export async function hacerThumb(
  dataUrl: string | null | undefined,
): Promise<string | undefined> {
  if (!dataUrl) return undefined;
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("THUMB_NO_DECODE"));
      img.src = dataUrl;
    });
    const ladoMayor = Math.max(img.naturalWidth, img.naturalHeight) || 1;
    const escala = Math.min(1, 320 / ladoMayor);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return undefined; // thumb es cosmético — nunca tumba el desenlace
  }
}

function motivoCorto(err: unknown): string {
  const crudo = err instanceof Error ? err.message : String(err);
  const corto = crudo.replace(/\s+/g, " ").trim().slice(0, 48);
  return (corto || "ERROR DEL PIPELINE").toUpperCase();
}

/** Siguiente PENDIENTE (FIFO por agregadaEn) — el ORDEN vive en las filas
 *  livianas (mini-store), los DATOS viven en IDB (leerRegistro uno-a-uno).
 *  Las filas temporales (copia a IDB aún en vuelo — «GUARDANDO N…») se
 *  saltan: su id real llega al resolver agregarLote y el loop las toma
 *  en la siguiente pasada. */
function siguientePendiente(): FilaMasiva | null {
  const pendientes = useMasivaStore
    .getState()
    .filas.filter((f) => f.estado === "PENDIENTE" && !f.id.startsWith("masiva-temp-"))
    .sort((a, b) => a.agregadaEn - b.agregadaEn);
  return pendientes[0] ?? null;
}

/** Desenlace de UNA foto — byte a byte el pipeline real (kit §6-C: el
 *  desenlace DEBE ser idéntico al del IMPORTAR normal). */
async function procesarUno(fila: FilaMasiva): Promise<void> {
  marcarFila(fila.id, { estado: "PROCESANDO", error: null });
  useMasivaStore.setState({ progreso: { id: fila.id, etapa: "DETECTANDO", fraccion: 0 } });
  let registro: RegistroMasiva | null = null;
  try {
    registro = await leerRegistro(fila.id);
    const archivo = registro.archivo;
    // IDB clona el File original (sigue siendo File — structured clone de
    // File API). El guard honesto evita alimentar al bridge con un Blob
    // genérico (OpcionesEscaneo.archivo espera File — A5).
    if (!(archivo instanceof File)) throw new Error("ARCHIVO_FUERA_DE_LA_COLA");

    // T4: variable tipada con la intersección (sin excess-check de literal —
    // el parámetro de la interfaz E14Bridge sigue siendo OpcionesEscaneo).
    const opcionesMasiva: OpcionesEscaneoConTimeout = {
      objetivo: null, // A4 — la clasificación REAL manda (viene del OCR)
      intento: 1, // A6 — semántica de PRIMERA captura
      maxIntentos: 4, // fallos → RECHAZADA repetible / rescate por recorte manual
      fuente: "ARCHIVO", // A5 — MASIVA SIEMPRE archivo
      archivo,
      onProgreso: (p) => progresoThrottled(fila.id, p),
      timeoutMs: TIMEOUT_MASIVA_MS, // T4 — ver constante (individual: 15 s intacto)
    };
    const acta = await getBridge().escanearActa(opcionesMasiva);

    // Desenlace → la MISMA vía que el flujo normal (T3.3/T3.2). El envío
    // automático reutiliza registrarEnvio (historial + completadas + hueco
    // archivado + cola offline); el resto cae al contador T5 con las
    // MISMAS claves.
    let actaFinal = acta;
    let enviadaAuto = false;
    if (acta.status === "OPTIMA") {
      actaFinal = {
        ...acta,
        status: "ENVIADA",
        enviadoAutomaticamente: getBridge().horaEnvio(),
      };
      useE14Store.getState().registrarEnvioMasiva(acta);
      enviadaAuto = true;
    } else {
      useE14Store.getState().contarMotivoNoEnvioActa(acta);
    }

    const thumb = await hacerThumb(acta.fotoProcesada ?? acta.fotoOriginal);
    const registroListo: RegistroMasiva = {
      ...registro,
      estado: "LISTA",
      acta: actaFinal,
      thumb,
    };
    // El dueño pudo QUITAR/VACIAR la fila mientras el OCR corría: su
    // decisión manda — no se re-persiste un registro borrado (0 zombis).
    if (!useMasivaStore.getState().filas.some((f) => f.id === fila.id)) return;

    await guardarRegistro(registroListo);
    marcarFila(fila.id, {
      estado: "LISTA",
      statusActa: actaFinal.status,
      score: actaFinal.score,
      nivel: actaFinal.clasificacion?.nivel ?? null,
      pagina: paginaDeActa(actaFinal),
      motivo: actaFinal.rechazo?.tipo ?? null,
      thumb,
      enviadaAuto,
      error: null,
    });
  } catch (err) {
    // Errores de IDB/decode/pipeline NUNCA tumban la UI (kit §3): la
    // entrada pasa a ERROR con motivo corto (repetible — quitar y
    // re-soltar la foto vuelve a encolarla).
    marcarFila(fila.id, { estado: "ERROR", error: motivoCorto(err), thumb: undefined });
    if (registro) {
      try {
        await guardarRegistro({ ...registro, estado: "ERROR" });
      } catch {
        /* IDB otra vez — la fila ya quedó ERROR en memoria (honesto) */
      }
    }
  } finally {
    const progreso = useMasivaStore.getState().progreso;
    if (progreso?.id === fila.id) useMasivaStore.setState({ progreso: null });
  }
}

async function bucle(): Promise<void> {
  while (!stopFlag) {
    const fila = siguientePendiente();
    if (!fila) break;
    await procesarUno(fila);
  }
}

/** UN solo runner global (módulo singleton) — `iniciar()` double-call →
 *  no-op (kit §4 regla 1). */
export function iniciarRunner(): void {
  if (corriendoFlag) return;
  corriendoFlag = true;
  stopFlag = false;
  useMasivaStore.setState({ corriendo: true });
  void bucle().finally(() => {
    corriendoFlag = false;
    useMasivaStore.setState({ corriendo: false, progreso: null });
  });
}

/** Pausa MANUAL: stop = true — el OCR en vuelo TERMINA (no hay aborto a
 *  mitad de pipeline; la fila queda LISTA/ERROR y el loop no toma la
 *  siguiente). PROCESAR retoma donde iba. También lo llama la AUTO-PAUSA
 *  al abrir un acta en REVISIÓN (kit §4 regla 2 — el flujo de revisión usa
 *  el main thread y actaActual, no pelear). Reanudar es MANUAL (botón). */
export function pausarRunner(): void {
  stopFlag = true;
}
