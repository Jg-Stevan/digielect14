"use client";

/**
 * useLinterna — SPRINT-B (B1, refactor/ui-hooks-v1): hook dedicado a la
 * linterna F-FLASH v3. MOVIMIENTO PURO desde screens/ScanView.tsx (mismos
 * cuerpos, mismos refs, mismas dependencias — el hook no registra efectos;
 * los espejos flashRef/torchOnRef se asignan durante el render, igual que en
 * el original L748-749).
 *
 * Contiene (extraído tal cual de ScanView.tsx):
 *  · TORCH_HINT verbatim (diagnóstico completo de UX de campo — H4).
 *  · flashPrefOn (preferencia de sesión) + flashRef espejo.
 *  · torchOn/torchOnRef espejo + torchDisponible.
 *  · ponerLinterna (applyConstraints + verificación getSettings().torch).
 *  · aplicarLinternaGuardada (reintentos 0/250/700/1500 ms).
 *  · alternarLinterna (toggle con la verdad al pulsar).
 *
 * `streamRef`/`camEstado`/`mostrarAviso` son INYECTADOS (propietario:
 * ScanView / useSesionCamara) — mismas identidades que en el original.
 */
import { useCallback, useRef, useState } from "react";
import type { CamEstado } from "./useSesionCamara";

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L119-L127
// (TORCH_HINT verbatim — remediación H4: es copy de UX de campo; el operador
//  electoral necesita el diagnóstico completo, no la versión corta).
/** F-FLASH v3 — diagnóstico del flash: cubre navegador sin soporte (iPhone:
 *  Safari 17.4+, Chrome/Firefox de iOS no exponen torch; WebViews in-app
 *  tampoco), cámara sin LED (gran angular/macro) y permisos WebView. */
export const TORCH_HINT =
  "No se pudo controlar la linterna aquí. Causas típicas: navegador sin " +
  "soporte (en iPhone usa Safari 17.4 o posterior; Chrome/Firefox de iOS " +
  "no lo permiten), cámara abierta sin LED (gran angular o macro) o la " +
  "app corre dentro de otra app (Instagram, WhatsApp…). Cierra el " +
  "escáner y vuelve a abrirlo; si persiste, prueba en otro navegador.";

/** Parámetros del hook — inyección de propietarios (movimiento puro). */
interface UseLinternaParams {
  /** streamRef de la sesión de cámara (creado en ScanView). */
  streamRef: { current: MediaStream | null };
  /** Estado de la cámara (propietario: ScanView). */
  camEstado: CamEstado;
  /** Franja de avisos del visor (propietario: ScanView). */
  mostrarAviso: (texto: string, tono: "crit" | "warn", ms?: number) => void;
}

export function useLinterna({ streamRef, camEstado, mostrarAviso }: UseLinternaParams) {
  /** F-FLASH: preferencia de linterna de la sesión (re-aplicada por stream). */
  const [flashPrefOn, setFlashPrefOn] = useState(false);
  const flashRef = useRef(false);
  /** Espejos legibles desde listeners sin re-render (lab L399-400). */
  const torchOnRef = useRef(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchDisponible, setTorchDisponible] = useState(false);

  // Espejos para listeners del loop sin re-render (lab L456-458) — el bloque
  // original L748-749 de ScanView corre durante el render; aquí en la MISMA
  // fase (cuerpo del hook) y ANTES de cualquier efecto que los lea.
  flashRef.current = flashPrefOn;
  torchOnRef.current = torchOn;

  /* ── Linterna — F-FLASH v3 (lab L473-520) ─────────────────────────── */

  /** Enciende/apaga el torch y VERIFICA el resultado real leyendo
   *  getSettings().torch — NO confiando en getCapabilities() (hay Chrome que
   *  no anuncian torch en caps pero SÍ lo aplican). Devuelve true si el LED
   *  quedó controlado. */
  const ponerLinterna = useCallback(async (on: boolean): Promise<boolean> => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return false;
    try {
      const caps = track.getCapabilities?.() as { torch?: boolean } | undefined;
      if (caps?.torch) setTorchDisponible(true);
      await track.applyConstraints({
        advanced: [{ torch: on }],
      } as MediaTrackConstraints & { advanced: unknown[] });
      const st = track.getSettings() as { torch?: boolean };
      const aplicado = on ? st.torch === true : st.torch !== true;
      if (aplicado) {
        torchOnRef.current = on;
        setTorchOn(on);
      }
      if (caps?.torch || aplicado) setTorchDisponible(true);
      if (!aplicado && on) {
        // Aceptado en silencio pero sin señal verificable: deshaz para no
        // dejar un LED encendido "fantasma" (lab L494-502).
        await track
          .applyConstraints({ advanced: [{ torch: false }] } as MediaTrackConstraints & {
            advanced: unknown[];
          })
          .catch(() => undefined);
      }
      return aplicado;
    } catch {
      return false;
    }
  }, []);

  /** Re-aplica la preferencia persistida CON REINTENTOS (0/250/700/1500 ms):
   *  varios Android rechazan applyConstraints justo tras getUserMedia. */
  const aplicarLinternaGuardada = useCallback(() => {
    for (const ms of [0, 250, 700, 1500]) {
      window.setTimeout(() => {
        if (!flashRef.current || torchOnRef.current) return;
        void ponerLinterna(true);
      }, ms);
    }
  }, [ponerLinterna]);

  /** Linterna — botón SIEMPRE activo con cámara; la verdad al pulsar (lab
   *  toggleTorch L1404-1422). Sin cámara viva o sin verificación → hint
   *  completo del lab (TORCH_HINT verbatim — remediación H4). */
  const alternarLinterna = useCallback(async () => {
    if (camEstado !== "viva") {
      mostrarAviso(`LINTERNA NO CONTROLADA — ${TORCH_HINT}`, "warn", 7000);
      return;
    }
    const siguiente = !torchOn;
    const aplicado = await ponerLinterna(siguiente);
    if (aplicado) {
      setFlashPrefOn(siguiente);
      // FLASH ENCENDIDO: feedback persistente = el botón encendido (ámbar).
    } else {
      mostrarAviso(`LINTERNA NO CONTROLADA — ${TORCH_HINT}`, "warn", 7000);
    }
  }, [camEstado, torchOn, ponerLinterna, mostrarAviso]);

  return {
    flashPrefOn,
    setFlashPrefOn,
    flashRef,
    torchOn,
    torchOnRef,
    torchDisponible,
    setTorchDisponible,
    ponerLinterna,
    aplicarLinternaGuardada,
    alternarLinterna,
  };
}
