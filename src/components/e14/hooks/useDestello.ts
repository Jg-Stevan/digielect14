"use client";

/**
 * useDestello — SPRINT-B (B1, refactor/ui-hooks-v1): hook dedicado al
 * destello de captura y al FLUJO DE CAPTURA hacia el store. MOVIMIENTO PURO
 * desde screens/ScanView.tsx (mismos cuerpos, mismos refs, mismas
 * dependencias — el hook no registra efectos).
 *
 * Contiene (extraído tal cual de ScanView.tsx):
 *  · NAVEGACION_TRAS_MS (margen del destello antes de navegar a ANALIZANDO).
 *  · destelloKey (state que dispara el flash blanco) + actaObjetivoRef
 *    (identidad G3 del acta creada por ESTE disparo).
 *  · blobToDataUrl / canvasABlob (encode del ganador).
 *  · despacharCaptura (destello + vibrate + File → store → ANALIZANDO).
 *  · archivoDentroDeTope (decode ÚNICO + capa 3 del F-SENSOR-PROFILER H2).
 *  · despacharArchivo (despacho final ya dentro del tope).
 *  · mejorarSilenciosa (G3 — upgrade silencioso full-res en REVISIÓN).
 *  · downscaleImage (función de módulo del lab — reduce galerías enormes).
 *
 * Todas las dependencias externas son INYECTADAS con la misma identidad que
 * en el original: sensorProfileRef (propietario: ScanView), procesandoRef,
 * setProcesando, setArchivoPendiente, dispararEscaneo, mejorarFotoActa.
 */
import { useCallback, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { fileToCaptureDataUrl, loadImage } from "@jg-stevan/scanner-core/image-processor";
import { getSensorSafeCap, type SensorProfile } from "@jg-stevan/scanner-core/sensor-profiler";
import type { Acta } from "@/lib/e14/types";
import { useE14Store } from "@/lib/e14/store";

/** Destello de captura ~120 ms (spec §7 — duración en globals.css) + margen
 *  antes de navegar a ANALIZANDO (el visor se desmonta). Consumido también
 *  por capturarInteligente (ScanView — último recurso grab del video). */
export const NAVEGACION_TRAS_MS = 260;

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
  mejorarFotoActa: (url: string, objetivo: Acta) => Promise<unknown> | void;
}

export function useDestello({
  sensorProfileRef,
  procesandoRef,
  setProcesando,
  setArchivoPendiente,
  dispararEscaneo,
  mejorarFotoActa,
}: UseDestelloParams) {
  const [destelloKey, setDestelloKey] = useState(0);
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
   *  La navegación se demora ~260 ms para que el destello (~120 ms) se vea
   *  ANTES de desmontar el visor. G3 (upgrade silencioso): al resolver
   *  dispararEscaneo captura la IDENTIDAD del acta creada por este disparo
   *  (el pageId del lab) — el runner del upgrade la usa como guard. */
  const despacharCaptura = useCallback(
    (archivo: File) => {
      setArchivoPendiente(archivo);
      setDestelloKey((k) => k + 1);
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(30);
      }
      window.setTimeout(() => {
        procesandoRef.current = false;
        setProcesando(false);
        void dispararEscaneo().then(() => {
          actaObjetivoRef.current = useE14Store.getState().actaActual;
        });
      }, NAVEGACION_TRAS_MS);
    },
    [dispararEscaneo, setArchivoPendiente],
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
        const rawDataUrl = robusto
          ? await fileToCaptureDataUrl(archivo)
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
      } catch {
        return archivo; // el bridge reintenta con su propio pipeline robusto
      }
    },
    [blobToDataUrl],
  );

  /** Despacha la captura FINAL (ya dentro del tope H2): destello + vibrate +
   *  File → store → ANALIZANDO. La navegación se demora ~260 ms para que el
   *  destello (~120 ms) se vea ANTES de desmontar el visor. */
  const despacharArchivo = useCallback(
    async (blobOArchivo: Blob, robusto: boolean) => {
      const base =
        blobOArchivo instanceof File
          ? blobOArchivo
          : new File([blobOArchivo], `acta-camara-${Date.now()}.jpg`, {
              type: blobOArchivo.type || "image/jpeg",
            });
      const final = (await archivoDentroDeTope(base, robusto)) ?? base;
      despacharCaptura(final);
    },
    [archivoDentroDeTope, despacharCaptura],
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
    destelloKey,
    setDestelloKey,
    canvasABlob,
    archivoDentroDeTope,
    despacharArchivo,
    mejorarSilenciosa,
  };
}
