"use client";

/**
 * KIT a11y-diálogos-v1 (plan de remediación — bloque 4.2.2, cierra U5):
 * focus-trap compartido para los diálogos modales `role="dialog"` del repo
 * (AyudaOverlay, QuadEditor). Con el diálogo abierto:
 *  · foco inicial al elemento `[data-autofocus]` (si existe);
 *  · Tab / Shift+Tab CÍCLICOS dentro del diálogo (jamás escapan al fondo);
 *  · Escape cierra (onCerrar);
 *  · al cerrar, el foco VUELVE al elemento que lo tenía antes de abrir.
 *
 * Desviación documentada del snippet del plan: el selector de focuseables
 * excluye los elementos disabled (`:not([disabled])`) — durante
 * `aplicando` (QuadEditor) la mayoría de botones se deshabilitan y un trap
 * que los incluya movería el foco a un botón muerto (el foco se perdería).
 */
import { useEffect, useRef, type RefObject } from "react";

/** Focuseables canónicos (misma lista del plan, con guard de disabled). */
const SELECTOR_FOCUSEABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  abierto: boolean,
  onCerrar: () => void,
) {
  // Ref fresca de onCerrar: el EFECTO solo depende de [abierto, ref] — un
  // cambio de identidad del callback (p. ej. `aplicando` en QuadEditor
  // re-creando el closure) NO re-ejecuta el efecto (el re-run haría
  // cleanup → devolvería el foco al opener a mitad de sesión y lo
  // volvería a montar: saltito de foco evitable).
  const alCerrarRef = useRef(onCerrar);
  alCerrarRef.current = onCerrar;

  useEffect(() => {
    if (!abierto || !ref.current) return;
    const nodo = ref.current;
    // Foco de RETORNO: quién lo tenía justo antes de abrir el diálogo.
    const previo = document.activeElement as HTMLElement | null;
    // Foco inicial: el elemento marcado por el dueño del diálogo.
    nodo.querySelector<HTMLElement>("[data-autofocus]")?.focus();

    const alTecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        alCerrarRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      // Trap cíclico: Tab en el último → primero; Shift+Tab en el primero →
      // último. El foco jamás sale del diálogo por teclado.
      const f = nodo.querySelectorAll<HTMLElement>(SELECTOR_FOCUSEABLE);
      if (!f.length) return;
      const primero = f[0] as HTMLElement;
      const ultimo = f[f.length - 1] as HTMLElement;
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };

    nodo.addEventListener("keydown", alTecla);
    return () => {
      nodo.removeEventListener("keydown", alTecla);
      // Retorno del foco al cerrar (o al desmontar). Si el opener ya no
      // existe en el DOM, focus() es un no-op inofensivo.
      previo?.focus();
    };
  }, [abierto, ref]);
}
