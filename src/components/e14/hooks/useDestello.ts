"use client";

/**
 * useDestello — SPRINT-B (B1, refactor/ui-hooks-v1): hook dedicado al
 * destello de captura y al FLUJO DE CAPTURA hacia el store. MOVIMIENTO PURO
 * desde screens/ScanView.tsx (mismos cuerpos, mismos refs, mismas
 * dependencias — el hook no registra efectos).
 *
 * Contiene (extraído tal cual de ScanView.tsx):
 *  · actaObjetivoRef (identidad G3 del acta creada por ESTE disparo).
 *  · blobToDataUrl / canvasABlob (encode del ganador).
 *  · despacharCaptura (vibrate + File → store → ANALIZANDO inmediato).
 *  · archivoDentroDeTope (decode ÚNICO + capa 3 del F-SENSOR-PROFILER H2).
 *  · despacharArchivo (despacho final ya dentro del tope).
 *  · mejorarSilenciosa (G3 — upgrade silencioso full-res en REVISIÓN).
 *  · downscaleImage (función de módulo del lab — reduce galerías enormes).
 *
 * Todas las dependencias externas son INYECTADAS con la misma identidad que
 * en el original: sensorProfileRef (propietario: ScanView), procesandoRef,
 * setProcesando, setArchivoPendiente, dispararEscaneo, mejorarFotoActa y
 * mostrarAviso (la franja del visor, también de ScanView).
 */
import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import {
  ErrorRescateHeic,
  fileToCaptureDataUrl,
  jpegDimensionsFromBlob,
  loadImage,
} from "@jg-stevan/scanner-core/core/image-processor";
import { leerFlags, opcionesRescateHeic } from "@/lib/e14/flags";
import { getSensorSafeCap, dentroDelTope, type SensorProfile } from "@/lib/e14/core/sensor-profiler";
import type { Acta } from "@jg-stevan/scanner-core/dominio/types";
import { useE14Store } from "@/lib/e14/store";
import { logger } from "@/lib/logger";

/** Destello de captura ~320 ms (spec §7 — duración en globals.css). Vive en
 *  el shell (store.destelloKey) para que ANALIZANDO entre EN EL MISMO
 *  INSTANTE de la vibración sin que el cambio de vista corte el destello. */

/** KIT e14-heic-tope-v1 (D82). El decodificador de reserva (heic2any 0.0.4) no
 *  admite `width`/`height` y un HEIC por encima del tope no termina nunca, así
 *  que el acta no entra. Copy corta y en mayúsculas — el estilo del repo
 *  (D1/gate-v2): dice el hecho y la salida, sin guía larga. Los 6 s porque el
 *  operario suele estar con el dedo en el obturador y la franja debe alcanzar a
 *  leerse antes del siguiente disparo. */
export const MSG_HEIC_TOPADO = "FOTO HEIC MUY GRANDE · PASA LA ACTA A JPEG";
export const HEIC_AVISO_MS = 6000;

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L245-L290
// (downscaleImage — función de módulo del lab, canvas puro. NO existe en el
// core → se COPIA, regla de oro 6 del SPEC-auditoria-copias.md; remediación H2.)
/** Reduce imágenes enormes de galería para no reventar la memoria del store.
 *  4032 (bug v3 de CALIDAD: estaba en 3400 y re-escalaba la foto nativa del
 *  iPhone de 4032px, añadiendo un re-encode JPEG extra — codigo-test guarda
 *  la foto full-res con una sola compresión). Con el Dual Pipeline ya no hay
 *  downscale en capturas de GAMAS ALTAS (4032×3024 ≈ 12.2 MP, lejos del
 *  límite de canvas de iOS); en media/baja el F-SENSOR-PROFILER pide 3200 px
 *  al sensor y ESTE tope es la segunda red de seguridad (imports incluidos).
 *  Recibe el elemento YA decodificado (decode único de la captura) y devuelve
 *  null si no hace falta re-escalar. */
/** C13: ahora ASÍNCRONA con toBlob (no bloquea el hilo ~1 s con imports de
 *  48 MP — mismo patrón canvasToDataUrl de más abajo). */
async function downscaleImage(
  img: HTMLImageElement,
  max = 4032
): Promise<string | null> {
  const big = Math.max(img.naturalWidth || 0, img.naturalHeight || 0);
  if (big <= max || !big) return null;
  const scale = max / big;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  try {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.95)
    );
    if (blob && blob.size > 0) {
      return await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error("FileReader falló"));
        fr.readAsDataURL(blob);
      });
    }
  } catch {
    /* respaldo abajo */
  }
  try {
    return canvas.toDataURL("image/jpeg", 0.95);
  } catch {
    return null;
  }
}

/** KIT e14-velocidad-5s-v1 — re-escala FUERA del hilo principal una foto de
 *  galería más grande que el tope: el decodificador hace el resize (sin pasar
 *  por un <img> ni por base64) y el encode sale por OffscreenCanvas. null =
 *  no soportado o fallo ⇒ el llamador cae al camino robusto de siempre. */
async function reescalarFueraDelHilo(
  archivo: Blob,
  dims: { w: number; h: number },
  cap: number,
): Promise<File | null> {
  try {
    if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return null;
    const long = Math.max(dims.w, dims.h);
    if (!long || dentroDelTope(long, cap)) return null;
    const escala = cap / long;
    const w = Math.max(1, Math.round(dims.w * escala));
    const h = Math.max(1, Math.round(dims.h * escala));
    const bitmap = await createImageBitmap(archivo, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: "high",
      imageOrientation: "from-image",
    });
    try {
      const lienzo = new OffscreenCanvas(w, h);
      const ctx = lienzo.getContext("2d", { alpha: false });
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0);
      const blob = await lienzo.convertToBlob({ type: "image/jpeg", quality: 0.95 });
      if (!blob.size) return null;
      return new File([blob], archivo instanceof File ? archivo.name : "import.jpg", {
        type: "image/jpeg",
      });
    } finally {
      bitmap.close?.();
    }
  } catch {
    return null;
  }
}

/** Parámetros del hook — inyección de propietarios (movimiento puro). */
interface UseDestelloParams {
  /** Perfil del sensor de FOTO (propietario: ScanView — lo llena el arranque
   *  de useSesionCamara; lo leen archivoDentroDeTope y tomarFoto). */
  sensorProfileRef: RefObject<SensorProfile | null>;
  /** Gate anti doble-captura (propietario: ScanView). */
  procesandoRef: RefObject<boolean>;
  /** Estado «procesando» del obturador (propietario: ScanView). */
  setProcesando: Dispatch<SetStateAction<boolean>>;
  /** Acciones del store (identidad exacta del original). */
  setArchivoPendiente: (archivo: File) => void;
  dispararEscaneo: () => Promise<unknown>;
  /** Franja del visor (propietario: ScanView). KIT e14-heic-tope-v1: un HEIC
   *  por encima del tope ya no muere en silencio — el puesto tiene que saber
   *  que la foto no entró, y por qué. Mismo canal de useLinterna y
   *  useSesionCamara. */
  mostrarAviso: (texto: string, tono: "crit" | "warn", ms?: number) => void;
  mejorarFotoActa: (url: string, objetivo: Acta) => Promise<unknown> | void;
}

export function useDestello({
  sensorProfileRef,
  procesandoRef,
  setProcesando,
  setArchivoPendiente,
  dispararEscaneo,
  mostrarAviso,
  mejorarFotoActa,
}: UseDestelloParams) {
  const destellar = useE14Store((s) => s.destellar);
  // G3 (upgrade silencioso del lab L1806-1842): identidad del acta que ESTE
  // disparo creó (el pageId del lab) — la captura despacharCaptura al
  // resolver dispararEscaneo; el runner del upgrade la usa como guard.
  const actaObjetivoRef = useRef<Acta | null>(null);

  // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L625-L635
  /** Blob → data URL (para el takePhoto hi-res). */
  const blobToDataUrl = useCallback(
    (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result ?? ""));
        fr.onerror = () => reject(new Error("FileReader falló"));
        fr.readAsDataURL(blob);
      }),
    []
  );

  /** Canvas → Blob JPEG 0.92 (toBlob, NUNCA toDataURL en canvas grande). */
  const canvasABlob = useCallback(async (canvas: HTMLCanvasElement): Promise<Blob | null> => {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92),
    );
    return blob && blob.size > 0 ? blob : null;
  }, []);

  /** Despacha la captura: destello + vibrate + File → store → ANALIZANDO.
   *  ANALIZANDO entra YA (sincrónico con la vibración): el operario no se
   *  queda mirando el preview congelado — el destello lo pinta el shell, así
   *  que el cambio de vista no lo corta. G3 (upgrade silencioso): al resolver
   *  dispararEscaneo captura la IDENTIDAD del acta creada por este disparo
   *  (el pageId del lab) — el runner del upgrade la usa como guard. */
  const despacharCaptura = useCallback(
    (archivo: File) => {
      setArchivoPendiente(archivo);
      destellar();
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(30);
      }
      procesandoRef.current = false;
      setProcesando(false);
      void dispararEscaneo().then(() => {
        actaObjetivoRef.current = useE14Store.getState().actaActual;
      });
    },
    [destellar, dispararEscaneo, setArchivoPendiente, setProcesando, procesandoRef],
  );

  // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L574-L589
  // (dispatch de handleCaptureDataUrl — decode ÚNICO + capa 3 del
  //  F-SENSOR-PROFILER, remediación H2). Adaptación e14 (fila 4 de la
  //  auditoría): el lab entrega dataUrl a su pipeline; el bridge de e14
  //  recibe File → esta función decodifica UNA vez, aplica el tope por GAMA
  //  y devuelve el File YA dentro del tope — el pipeline de e14 recibe la
  //  foto ya dentro del tope, SIN IMPORTAR LA FUENTE (CÁMARA takePhoto/ZSL +
  //  IMPORTAR 12–48 MP + foto nativa iOS). `robusto` = Files del picker
  //  (F-IMPORT del core: HEIC/EXIF/12-48MP seguros — el lab hace exactamente
  //  esto en onFilePicked); false = File nacido del blob del sensor (base64
  //  barato, sin re-decode). Devuelve null SOLO si la ruta robusta falló.
  const archivoDentroDeTope = useCallback(
    async (archivo: File, robusto: boolean): Promise<File | null> => {
      try {
        const cap = sensorProfileRef.current?.safeCapPx ?? getSensorSafeCap();
        // KIT e14-velocidad-5s-v1 + KIT captura-fluida-v1 — RUTA CORTA del
        // JPEG. Las dimensiones se leen del contenedor (256 KB, sin
        // decodificar): si la foto ya está dentro del tope el File pasa
        // INTACTO y si no se re-escala fuera del hilo. El camino robusto de
        // abajo hacía lo MISMO pagando data URL + decode + canvas + FileReader
        // + fetch en el hilo principal (medido 1 500-2 200 ms de congelación
        // antes de ANALIZANDO). Desde captura-fluida-v1 aplica TAMBIÉN a la
        // foto de la cámara (takePhoto/ZSL salen en JPEG): era el mismo par
        // de decodes completos en cada disparo, solo para leer w/h.
        // HEIC/PNG (sin SOF legible) siguen intactos: esta ruta no decide.
        if (leerFlags().importRutaCorta) {
          const dims = await jpegDimensionsFromBlob(archivo);
          if (dims) {
            if (dentroDelTope(Math.max(dims.w, dims.h), cap)) return archivo;
            const reescalado = await reescalarFueraDelHilo(archivo, dims, cap);
            if (reescalado) return reescalado;
          }
        }
        const rawDataUrl = robusto
          ? await fileToCaptureDataUrl(archivo, opcionesRescateHeic())
          : await blobToDataUrl(archivo);
        if (!rawDataUrl) return null; // F-IMPORT falló → el llamador avisa (lab L954-961)
        // Decode ÚNICO de la captura (antes: downscale + detect + quality
        // decodificaban la misma foto de 12 MP tres veces). El elemento se
        // reutiliza en las etapas; solo se re-decodifica si hubo que
        // re-escalar una imagen de galería más grande que el sensor.
        const decoded = await loadImage(rawDataUrl);
        // F-SENSOR-PROFILER: el tope del downscale sigue la GAMA medida
        // (4032 alta / 3200 media-baja) — segunda red de seguridad por si
        // la foto llegó por encima del tope (photoSettings no aplicado).
        const scaledUrl = await downscaleImage(
          decoded,
          sensorProfileRef.current?.safeCapPx ?? getSensorSafeCap()
        );
        // Dentro del tope → el archivo original pasa INTACTO (F-RES-PRIORITY:
        // la resolución del sensor manda, cero re-encode extra).
        if (!scaledUrl) return archivo;
        const blob = await (await fetch(scaledUrl)).blob();
        if (!blob.size) return archivo;
        return new File([blob], archivo.name, { type: blob.type || "image/jpeg" });
      } catch (e) {
        // KIT e14-heic-tope-v1: el rechazo del rescate HEIC NO es un fallo
        // cualquiera — no hay nada que el bridge pueda reintentar (la foto no
        // entra en el decodificador). Sube y despacharArchivo lo pinta.
        if (e instanceof ErrorRescateHeic) throw e;
        return archivo; // el bridge reintenta con su propio pipeline robusto
      }
    },
    [blobToDataUrl],
  );

  /** Despacha la captura FINAL (ya dentro del tope H2): vibrate + File →
   *  store → ANALIZANDO inmediato (el destello lo pinta el shell). */
  const despacharArchivo = useCallback(
    async (blobOArchivo: Blob, robusto: boolean) => {
      const base =
        blobOArchivo instanceof File
          ? blobOArchivo
          : new File([blobOArchivo], `acta-camara-${Date.now()}.jpg`, {
              type: blobOArchivo.type || "image/jpeg",
            });
      let final: File;
      try {
        final = (await archivoDentroDeTope(base, robusto)) ?? base;
      } catch (e) {
        if (e instanceof ErrorRescateHeic) {
          // Sin este corte el rechazo dejaba solo una línea en el registro: el
          // operario veía el destello y el visor de vuelta, sin explicación.
          logger.warn("[e14] captura rechazada por el tope HEIC", { mensaje: e.message });
          mostrarAviso(MSG_HEIC_TOPADO, "crit", HEIC_AVISO_MS);
          return;
        }
        final = base; // lo imprevisto sigue el camino de siempre: despacho intacto
      }
      despacharCaptura(final);
    },
    [archivoDentroDeTope, despacharCaptura, mostrarAviso],
  );

  // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L1806-1842
  // (runSilentUpgrade — LOTE 5.4/5.5, adaptado a e14).
  /** G3 — UPGRADE SILENCIOSO: la foto full-res del sensor aterrizó (~15-18 s)
   *  tras el disparo rápido por peldaño → re-procesa el acta EN REVISIÓN
   *  (store.mejorarFotoActa → bridge.mejorarResolucion: re-proceso sin
   *  consumir intento, quad RE-DETECTADO sobre la foto nueva, gate completo).
   *  Todo el trabajo vive FUERA del flujo crítico (el usuario ya está en
   *  revisión). Solo SUBE (lab L1830-1832): si el lado mayor no supera
   *  claramente al del peldaño (2048), el acta no se toca. Fallos
   *  silenciosos: si no llega o llega roto, el acta queda como está. */
  const mejorarSilenciosa = useCallback(
    async (upgrade: Promise<Blob>): Promise<void> => {
      try {
        const blob = await upgrade;
        if (!blob || blob.size === 0) return;
        // Solo SUBE: decode FUERA del flujo crítico (el upgrade ya vuela en
        // segundo plano — el lab lo mide con readBlobLongSide barato; aquí
        // el decode único de loadImage es aceptable a esta altura).
        const rawDataUrl = await blobToDataUrl(blob);
        if (!rawDataUrl) return;
        const decoded = await loadImage(rawDataUrl);
        const longSide = Math.max(decoded.naturalWidth || 0, decoded.naturalHeight || 0);
        if (!Number.isFinite(longSide) || longSide < 2048) return;
        // Mismo tratamiento que el camino de siempre: decode único + tope
        // por GAMA (archivoDentroDeTope — capa 3 H2) antes del bridge.
        const objetivo = actaObjetivoRef.current;
        if (!objetivo) return;
        const final = await archivoDentroDeTope(
          new File([blob], "mejora-fullres.jpg", { type: blob.type || "image/jpeg" }),
          false,
        );
        if (!final) return;
        const finalUrl = await blobToDataUrl(final);
        if (!finalUrl) return;
        // Guardas de identidad (acta sigue viva y es la misma) viven en el
        // store — igual que el lab (pageId alive check L1824-1826).
        void mejorarFotoActa(finalUrl, objetivo);
      } catch {
        /* silencioso: el upgrade JAMÁS rompe nada */
      }
    },
    [blobToDataUrl, archivoDentroDeTope, mejorarFotoActa],
  );

  return {
    canvasABlob,
    archivoDentroDeTope,
    despacharArchivo,
    mejorarSilenciosa,
  };
}
