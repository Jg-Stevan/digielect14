"use client";

/**
 * TuercaResumen — puerta de entrada al MODO DESARROLLADOR (antes «modo de
 * diagnóstico», renombrado por el dueño — KIT
 * e14-observabilidad-v1, agente 2 · C1). SIEMPRE visible arriba-izquierda
 * del header de ResumenView; GRIS con modo dev OFF, ACENTO con ON.
 *
 * Activación ARMADA — MISMO patrón UX de «reiniciar jornada» de
 * ResumenView (armado + timeout 4 s): 1.er toque → confirmación
 * «¿Activar modo desarrollador? [SÍ] [NO]»; toque en SÍ →
 * `guardarModoDev(true)`. Desactivar se hace desde el PanelDev (flujo
 * inverso, C4). Con modo dev ON el toque abre el panel (`onAbrirPanel`).
 *
 * FASE 0: persistencia vía `dev/puente.ts` (claves pinned §4.1). FASE 1:
 * `guardarModoDev` pasa a `obs/politica.ts` — la UI no cambia.
 */
import { useEffect, useState } from "react";
import { guardarModoDev, useModoDev } from "./puente";

/** Timeout del armado — el MISMO de «reiniciar jornada» (4 s). */
const ARMADO_MS = 4000;

/** Copia EXACTA exigida por el kit (C1). */
const COPIA_ACTIVACION =
  "Recolecta metadatos de uso y salud del dispositivo en este equipo. Nada sale del dispositivo sin que lo exportes manualmente.";

/** Engranaje SVG inline — `icons.tsx` no tiene tuerca y el kit lo permite
 *  («icono que ya exista … o SVG inline»); así el archivo compartido queda
 *  intacto. Trazo currentColor (lucide `settings`). */
function TuercaIcono({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function TuercaResumen({ onAbrirPanel }: { onAbrirPanel?: () => void }) {
  const modoDev = useModoDev();
  const [armado, setArmado] = useState(false);

  // Armado efímero — MISMO patrón que «reiniciar jornada» (timeout 4 s).
  useEffect(() => {
    if (!armado) return;
    const t = window.setTimeout(() => setArmado(false), ARMADO_MS);
    return () => window.clearTimeout(t);
  }, [armado]);

  // Esc desarma (convención de cierre del repo, cf. AyudaOverlay).
  useEffect(() => {
    if (!armado) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setArmado(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armado]);

  const tocar = () => {
    if (modoDev) {
      onAbrirPanel?.();
      return;
    }
    if (armado) return; // espera [SÍ]/[NO] explícitos (o timeout)
    setArmado(true);
  };

  const activar = () => {
    setArmado(false);
    guardarModoDev(true);
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={tocar}
        aria-label={modoDev ? "Abrir modo desarrollador" : "Activar modo desarrollador"}
        aria-expanded={armado}
        title={modoDev ? "Abrir panel de modo desarrollador" : "Activar modo desarrollador"}
        className={`min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl flex items-center justify-center transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10b981]/70 ${
          modoDev
            ? "bg-[#10b981]/15 border border-[#10b981]/50 text-[#10b981]"
            : "bg-slate-800/50 border border-slate-700/60 text-slate-400 hover:text-slate-200"
        }`}
      >
        <TuercaIcono className="w-5 h-5" />
      </button>

      {armado && (
        <>
          {/* Clic-fuera desarma (convención AyudaOverlay). */}
          <div className="fixed inset-0 z-40" onClick={() => setArmado(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="false"
            aria-label="¿Activar el modo desarrollador?"
            className="absolute left-0 top-[calc(100%+8px)] z-50 w-[min(88vw,20rem)] rounded-2xl border border-slate-700/80 bg-[#10161f] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
          >
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
              ¿ACTIVAR EL MODO DESARROLLADOR?
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-300">{COPIA_ACTIVACION}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={activar}
                autoFocus
                className="min-h-[40px] flex-1 rounded-xl bg-[#10b981] hover:bg-[#059669] text-[#090d12] font-mono text-[11px] font-black uppercase tracking-wider transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10b981]"
              >
                SÍ, ACTIVAR
              </button>
              <button
                type="button"
                onClick={() => setArmado(false)}
                className="min-h-[40px] flex-1 rounded-xl border border-slate-700 bg-slate-800/60 hover:border-slate-500 text-slate-300 font-mono text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                NO
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
