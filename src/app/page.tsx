"use client";

/**
 * Shell único (D3): TopBar (solo REVISIÓN) + vista activa por estado (zustand)
 * + BottomNav. Transiciones 150 ms.
 * STITCH REDESIGN (SPEC-e14-redesign-stitch §4/D2): el sistema de
 * notificaciones flotantes queda ELIMINADO — FloatingBanner ya NO se monta
 * (archivo borrado) y `notificar` desaparece del store. El feedback vive
 * SIEMPRE en la UI persistente de estado (píldora/nube/bloque ENVIADO/
 * franja del visor/feedback en botón).
 */
import { useEffect } from "react";
import { useE14Store } from "@/lib/e14/store";
import { TopBar } from "@/components/e14/TopBar";
import { BottomNav } from "@/components/e14/BottomNav";
import { ScanView } from "@/components/e14/screens/ScanView";
import { AnalyzingView } from "@/components/e14/screens/AnalyzingView";
import { ReviewView, ReviewCtas } from "@/components/e14/screens/ReviewView";
import { ActasView } from "@/components/e14/screens/ActasView";
import { ResumenView } from "@/components/e14/screens/ResumenView";
// KIT e14-carga-masiva-v1 (T4): vista MASIVA (módulo separado, desktop-first).
import { MasivaView } from "@/components/e14/screens/MasivaView";
// F-PWA (kit H6): registro del Service Worker + listeners de instalación +
// banner E-04 «Nueva versión lista» — montaje único, no renderiza nada.
import { PwaRegister } from "@/components/e14/PwaRegister";

export default function Page() {
  const vista = useE14Store((s) => s.vista);

  // KIT L6: arranque de la jornada persistida — UNA vez por carga (la
  // acción es idempotente: guarda de doble montaje incluida). Sin registro
  // persistido la app arranca fresca exactamente como hoy.
  const arrancarJornada = useE14Store((s) => s.arrancarJornada);
  useEffect(() => {
    void arrancarJornada();
  }, [arrancarJornada]);

  // KIT e14-esquinas-suaves-v1 (T-R): tick del SIM VIVO en el SHELL — corre en
  // TODAS las vistas (el dueño mira RESUMEN y el puesto se llena a la vista).
  // Antes vivía en ACTAS (se pausaba al navegar). Misma cadencia 5 s, mismo
  // guard: OFF o guion completo → sin ticks (AC-SIM1). D6 intocable: solo lee.
  const modoSimulacion = useE14Store((s) => s.modoSimulacion);
  const simCompleta = useE14Store((s) => s.simCompleta);
  const avanzarSimulacion = useE14Store((s) => s.avanzarSimulacion);
  useEffect(() => {
    if (!modoSimulacion || simCompleta) return;
    const t = window.setInterval(avanzarSimulacion, 5000);
    return () => window.clearInterval(t);
  }, [modoSimulacion, simCompleta, avanzarSimulacion]);

  return (
    // D38 (F5): shell candado a h-dvh (NO min-h) — la cadena de alturas de
    // REVISIÓN queda DEFINITA (main flex-1 → tarjeta flex-1 → img h-full) y la
    // barra de controles vive SIEMPRE pegada a los CTAs/BottomNav, sin importar
    // la orientación del documento. Cada vista gestiona su propio scroll
    // (Actas/Resumen ya son overflow-y-auto; ScanView cabe por diseño).
    <div className="h-dvh bg-[#090d12] text-slate-100 flex flex-col font-sans overflow-hidden">
      {vista === "revision" && <TopBar />}

      <main className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
        <div key={vista} className="flex-1 min-h-0 flex flex-col animate-view-enter">
          {vista === "escanear" && <ScanView />}
          {vista === "analizando" && <AnalyzingView />}
          {vista === "revision" && <ReviewView />}
          {vista === "actas" && <ActasView />}
          {vista === "resumen" && <ResumenView />}
          {/* KIT e14-carga-masiva-v1 (T4): MASIVA en la grilla de vistas —
              TopBar queda como está (solo REVISIÓN), scroll propio. */}
          {vista === "masiva" && <MasivaView />}
        </div>
      </main>

      {vista !== "analizando" && (
        <BottomNav mode={vista === "actas" || vista === "resumen" ? "app" : "dark"}>
          {vista === "revision" && <ReviewCtas />}
        </BottomNav>
      )}

      {/* F-PWA (H6): SW offline + instalación — SIEMPRE montado (todas las
          vistas) porque el registro vive en el shell, no en una pantalla. */}
      <PwaRegister />
    </div>
  );
}
