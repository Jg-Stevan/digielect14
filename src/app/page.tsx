"use client";

/**
 * Shell único (D3): TopBar (solo REVISIÓN) + vista activa por estado (zustand)
 * + BottomNav. Transiciones 150 ms.
 * STITCH REDESIGN (SPEC-e14-redesign-stitch §4/D2): el sistema de
 * notificaciones flotantes queda ELIMINADO — FloatingBanner ya NO se monta
 * (archivo borrado) y `notificar` desaparece del store. El feedback vive
 * SIEMPRE en la UI persistente de estado (píldora/nube/bloque ENVIADO/
 * franja del visor/feedback en botón).
 *
 * SHELL RESPONSIVO (Task 2-a — remodelado Z.ai):
 *  · lg+ (≥1024px): SideNav fija a la izquierda (240px) + columna de
 *    contenido; BottomNav se oculta y las CTAs de REVISIÓN (ReviewCtas)
 *    viven al fondo de la columna en desktop.
 *  · <lg: comportamiento móvil original (BottomNav + CTAs encima).
 *  · Atajos de teclado (desktop): 1/2/3/4 cambian de vista · «?»/«h» abre
 *    la guía. Se desactivan mientras haya un dialog abierto (editores,
 *    visor de foto, ayuda) o el foco esté en un input.
 */
import { useEffect } from "react";
import { useE14Store } from "@/lib/e14/store";
import { TopBar } from "@/components/e14/TopBar";
import { BottomNav } from "@/components/e14/BottomNav";
import { SideNav } from "@/components/e14/SideNav";
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
// Task 4: guía de uso (onboarding 1.ª visita + «?»/«h» + SideNav).
import { AyudaOverlay, abrirAyuda } from "@/components/e14/AyudaOverlay";
// KIT e14-observabilidad-v1 (A1-C7): bootstrap del rastreo — captura de
// errores + ErrorBoundary + breadcrumbs + uso + salud (modo dev) +
// transporte (stub → agente 3) + refresco de flags. TODO idempotente y
// silencioso (§2.4): la app se comporta IDÉNTICA con esto en marcha.
import { ErrorBoundaryObs, instalarCaptura } from "@/lib/e14/obs/captura";
import { iniciarBreadcrumbs } from "@/lib/e14/obs/breadcrumbs";
import { iniciarUso } from "@/lib/e14/obs/uso";
import { iniciarMuestreoSalud } from "@/lib/e14/obs/dispositivo";
import { iniciarTransporte } from "@/lib/e14/obs/transporte";
import { refrescarFlags } from "@/lib/e14/flags";

export default function Page() {
  const vista = useE14Store((s) => s.vista);
  const navegar = useE14Store((s) => s.navegar);

  // KIT L6: arranque de la jornada persistida — UNA vez por carga (la
  // acción es idempotente: guarda de doble montaje incluida). Sin registro
  // persistido la app arranca fresca exactamente como hoy.
  const arrancarJornada = useE14Store((s) => s.arrancarJornada);
  useEffect(() => {
    void arrancarJornada();
  }, [arrancarJornada]);

  // KIT e14-observabilidad-v1 (A1-C7): bootstrap del rastreo — UNA vez por
  // carga, TODAS las piezas idempotentes. El muestreo de salud NO crea
  // timer si el modo dev está OFF (cero costo); el transporte es no-op sin
  // endpoint (D1). Nada de esto renderiza ni toca la UI.
  useEffect(() => {
    try {
      instalarCaptura();
      iniciarBreadcrumbs();
      iniciarUso();
      iniciarMuestreoSalud();
      iniciarTransporte();
      void refrescarFlags();
    } catch {
      /* el rastreo jamás rompe la app (§2.4) */
    }
  }, []);

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

  // Task 4: atajos de teclado (desktop-friendly). Guard: nada de atajos
  // mientras un dialog esté abierto (editores/visor/ayuda) o el foco esté
  // escribiendo en un input/textarea.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === "1") navegar("escanear");
      else if (e.key === "2") navegar("actas");
      else if (e.key === "3") navegar("masiva");
      else if (e.key === "4") navegar("resumen");
      else if (e.key === "?" || e.key === "h" || e.key === "H") abrirAyuda();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navegar]);

  return (
    <ErrorBoundaryObs>
      {/* KIT e14-observabilidad-v1 (A1-C7): ErrorBoundaryObs envuelve el
          shell COMPLETO — un error de render → evento en el buffer + UI de
          fallo sobria con Recargar (nada de pantalla blanca muda). */}
      {/* D38 (F5): shell candado a h-dvh (NO min-h) — la cadena de alturas
          de REVISIÓN queda DEFINITA (main flex-1 → tarjeta flex-1 → img
          h-full) y la barra de controles vive SIEMPRE pegada a los CTAs/
          BottomNav, sin importar la orientación del documento. Cada vista
          gestiona su propio scroll (Actas/Resumen ya son overflow-y-auto;
          ScanView cabe por diseño). Task 2-a: en lg+ el shell se vuelve
          horizontal — SideNav + columna. */}
      <div className="h-dvh bg-[#090d12] text-slate-100 flex font-sans overflow-hidden">
        {/* Navegación de escritorio (lg+) — en móvil la da BottomNav */}
        <SideNav />

        <div className="flex-1 min-w-0 flex flex-col relative">
          {vista === "revision" && <TopBar />}

          <main className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
            <div
              key={vista}
              className="flex-1 min-h-0 flex flex-col animate-view-enter"
            >
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

          {/* Navegación móvil (<lg). Las CTAs de REVISIÓN viajan dentro del
            BottomNav (encima de la barra), como siempre. */}
          {vista !== "analizando" && (
            <div className="lg:hidden shrink-0">
              <BottomNav
                mode={vista === "actas" || vista === "resumen" ? "app" : "dark"}
              >
                {vista === "revision" && <ReviewCtas />}
              </BottomNav>
            </div>
          )}

          {/* CTAs de REVISIÓN en escritorio: al fondo de la columna (no hay
            barra inferior en lg+). Misma pieza (ReviewCtas), sin duplicar
            estado — es presentacional pura. */}
          {vista === "revision" && (
            <div className="hidden lg:flex shrink-0 justify-center px-6 pb-4">
              <div className="w-full max-w-2xl xl:max-w-3xl">
                <ReviewCtas />
              </div>
            </div>
          )}
        </div>

        {/* F-PWA (H6): SW offline + instalación — SIEMPRE montado (todas las
          vistas) porque el registro vive en el shell, no en una pantalla. */}
        <PwaRegister />
        {/* Task 4: guía de uso — montada única, se abre en 1.ª visita. */}
        <AyudaOverlay />
      </div>
    </ErrorBoundaryObs>
  );
}
