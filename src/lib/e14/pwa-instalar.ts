/**
 * F2 — KIT e63k-capa2-identidad-e-instalar-v1: píldora «Instalar app» (PWA).
 *
 * Evidencia del dueño (consola, kit §0.3): `Banner not shown:
 * beforeinstallpromptevent.preventDefault() called. The page must call
 * prompt()`. El módulo `@jg-stevan/scanner-core/pwa` captura el evento
 * (e.preventDefault()), guarda deferredPrompt y expone promptInstall() /
 * getPwaInstallState() / subscribePwaState() — pero NADIE los consumía en la
 * app: ni banner nativo (fue suprimido) ni prompt de la app ⇒ el usuario no
 * podía instalar NUNCA. El core está BIEN; aquí vive la UI que dispara el
 * prompt.
 *
 * Patrón OBLIGATORIO (kit §2): idéntico al banner E-04 (update-banner.ts) —
 * módulo self-contained en src/lib/e14, DOM directo, montado UNA vez desde
 * PwaRegister, sobrevive la navegación SPA, cero dependencias. NUNCA toca
 * scanner-core ni TopBar/screens (RED LINE 6).
 *
 * · Píldora fija abajo-IZQUIERDA (left:16px, transform:none) — NO centro-
 *   abajo: ahí vive el banner E-04 (colisión). safe-area-inset respetado.
 * · Mostrar SOLO cuando canPrompt && !installed && !isIos — iOS no tiene
 *   prompt nativo: no ofrecer humo. Tras appinstalled el estado installed
 *   la oculta igualmente.
 * · Botón ✕: oculta POR SESIÓN (variable local — no persistir; la próxima
 *   visita vuelve a ofrecer).
 * · Accesible: role="status", aria-labels, tap target ≥ 44 px.
 */

import { promptInstall, subscribePwaState } from "@jg-stevan/scanner-core/pwa";

export function setupPwaInstalar(): void {
  if (typeof window === "undefined") return;
  // Cinturón: el montaje es único (PwaRegister), pero un doble setup no
  // debe duplicar la suscripción (mismo espíritu que el guard de DOM).
  let montado = false;
  if (montado) return;
  montado = true;

  // Descartada ESTA sesión → no volver a ofrecer (no persistir: la próxima
  // visita vuelve a ofrecer — kit §2.1).
  let descartada = false;

  const showPill = () => {
    // Ya visible → no duplicar (varias emisiones del estado pueden coincidir).
    if (document.getElementById("pwa-instalar-pill")) return;

    const host = document.createElement("div");
    host.id = "pwa-instalar-pill";
    host.setAttribute("role", "status");
    host.setAttribute("aria-label", "Instalar la aplicación en este dispositivo");
    host.style.cssText = [
      "position:fixed",
      "left:16px",
      "bottom:calc(16px + env(safe-area-inset-bottom, 0px))",
      "z-index:2147483647",
      "display:flex",
      "align-items:center",
      "gap:12px",
      "background:rgba(28,28,30,0.94)",
      "color:#fff",
      "padding:10px 10px 10px 16px",
      "border-radius:14px",
      "box-shadow:0 8px 24px rgba(0,0,0,0.28)",
      "font:600 14px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
      "max-width:calc(100vw - 24px)",
    ].join(";");

    const label = document.createElement("span");
    label.textContent = "Instalar app";

    const instalar = document.createElement("button");
    instalar.type = "button";
    instalar.textContent = "Instalar";
    instalar.setAttribute("aria-label", "Instalar la aplicación");
    instalar.style.cssText = [
      "border:0",
      "cursor:pointer",
      "padding:10px 18px",
      "min-height:44px",
      "display:inline-flex",
      "align-items:center",
      "border-radius:999px",
      "background:#007aff",
      "color:#fff",
      "font:inherit",
    ].join(";");

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Descartar aviso de instalación");
    close.style.cssText = [
      "border:0",
      "cursor:pointer",
      "padding:6px 8px",
      "min-height:44px",
      "min-width:44px",
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "border-radius:999px",
      "background:transparent",
      "color:rgba(255,255,255,0.7)",
      "font:inherit",
    ].join(";");

    instalar.addEventListener("click", () => {
      void promptInstall().then((r) => {
        // accepted | dismissed → ocultar (el core ya limpia deferredPrompt y
        // emite; tras appinstalled el estado installed la oculta igualmente).
        // "unavailable" → la píldora se queda (honesto — no pasó nada).
        if (r === "accepted" || r === "dismissed") host.remove();
      });
    });
    close.addEventListener("click", () => {
      descartada = true; // solo esta sesión
      host.remove();
    });

    host.append(label, instalar, close);
    document.body.appendChild(host);
  };

  // Estado del core: mostrar SOLO canPrompt && !installed && !isIos (iOS no
  // tiene prompt — sin humo). installed (appinstalled) la oculta.
  subscribePwaState((s) => {
    const existente = document.getElementById("pwa-instalar-pill");
    if (s.installed) {
      existente?.remove();
      return;
    }
    if (descartada) return;
    if (!(s.canPrompt && !s.isIos)) {
      existente?.remove();
      return;
    }
    showPill();
  });
}
