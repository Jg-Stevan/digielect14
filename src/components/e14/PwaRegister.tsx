"use client";

/**
 * F-PWA — montaje único del registro PWA del e14.
 *
 * Fuente: apps/scanner-lab/src/components/scanner/PwaRegister.tsx (repo
 * web-scanner) — copia adaptada (regla de oro #0). ADAPTACIÓN declarada:
 * el warm-up idle del OCR del lab NO aplica aquí — e14 ya tiene su propio
 * pre-warm real de RapidOCR (kit e14-prowarm-ocr-v1: disparo al montar
 * MASIVA + diferido 2 s en ScanView), no hay nada que duplicar.
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
    setupPwaListeners();
    registerServiceWorker();
    setupUpdateBanner();
    setupPwaInstalar();
  }, []);

  return null;
}
