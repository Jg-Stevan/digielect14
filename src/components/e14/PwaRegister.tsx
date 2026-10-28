"use client";

/**
 * F-PWA — montaje único del registro PWA del e14.
 *
 * Fuente: apps/scanner-lab/src/components/scanner/PwaRegister.tsx (repo
 * web-scanner) — copia adaptada (regla de oro #0). ADAPTACIÓN declarada:
 * el warm-up idle del OCR del lab NO aplica aquí — e14 ya tiene su propio
 * pre-warm real de RapidOCR (kit e14-prowarm-ocr-v1: disparo al montar
 * el shell + diferido 2 s en ScanView), no hay nada que duplicar.
 *
 * DEV-SIN-SW (fix de soporte): en DESARROLLO el service worker NO se
 * registra y cualquier SW/caché de una sesión anterior se DESREGISTRA al
 * montar. Motivo: el SW cachea assets (E-04) y con el dev server
 * recompilando a cada cambio el usuario puede quedarse viendo una UI vieja
 * («sigo viendo el chip KIT» pese a estar eliminado del código). En
 * PRODUCCIÓN (build) el comportamiento es el de siempre: registro + banner
 * de nueva versión E-04.
 */
import { useEffect } from "react";
import { registerServiceWorker, setupPwaListeners } from "@jg-stevan/scanner-core/pwa";
// E-04 — banner «Nueva versión lista»: con el SW sin skipWaiting
// incondicional, la versión nueva queda waiting hasta que el usuario acepte
// recargar desde el banner (self-contained en src/lib/e14).
import { setupUpdateBanner } from "@/lib/e14/update-banner";
// e63k — KIT e63k-capa2-identidad-e-instalar-v1 (F2): píldora «Instalar app»
// — consume el promptInstall del core que NADIE llamaba (kit §0.3: el evento
// beforeinstallprompt era tragado y el usuario no podía instalar nunca).
import { setupPwaInstalar } from "@/lib/e14/pwa-instalar";

export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      // Dev: fuera cualquier SW viejo (best-effort — nunca bloquea la UI).
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        navigator.serviceWorker
          .getRegistrations()
          .then((regs) => {
            for (const r of regs) void r.unregister();
          })
          .catch(() => {});
        if (typeof caches !== "undefined") {
          caches
            .keys()
            .then((keys) => {
              for (const k of keys) void caches.delete(k);
            })
            .catch(() => {});
        }
      }
      return;
    }
    setupPwaListeners();
    registerServiceWorker();
    setupUpdateBanner();
    setupPwaInstalar();
  }, []);

  return null;
}
