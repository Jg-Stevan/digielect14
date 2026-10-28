"use client";

/**
 * AyudaOverlay — guía de uso de la app (onboarding + referencia).
 * Task 4 (shell): se abre SOLO en la primera visita (localStorage) y
 * bajo demanda desde SideNav («CÓMO FUNCIONA»), el botón «?» del HUD de
 * ESCANEAR y la tecla «?» del teclado. Estado propio en un mini-store
 * zustand LOCAL a este módulo (cero cambios al store de negocio —
 * `useE14Store` queda intacto).
 */
import { useEffect } from "react";
import { create } from "zustand";
import {
  StitchCameraIcon,
  StitchSpinIcon,
  StitchEyeIcon,
  StitchCloudCheckIcon,
} from "./icons";

/** Mini-store UI-local del overlay — exportado para disparos externos. */
const useAyudaStore = create<{
  abierta: boolean;
  abrir: () => void;
  cerrar: () => void;
}>((set) => ({
  abierta: false,
  abrir: () => set({ abierta: true }),
  cerrar: () => set({ abierta: false }),
}));

/** Disparo sin hook — externo (SideNav/ScanView/teclado).
 *  SPRINT-B (B3): cerrarAyuda BORRADA (desviación documentada) — el kit
 *  pedía de-export «si no tiene consumidores»; el grep confirma que no
 *  tiene NI internos (el overlay usa el action `cerrar` del store en
 *  L117) → código muerto, se elimina (protocolo 3B del overnight:
 *  «export muerto» ≠ «código muerto»; aquí es muerto del todo). */
export const abrirAyuda = () => useAyudaStore.getState().abrir();

const LS_KEY = "e14-ayuda-vista";

const PASOS = [
  {
    Icon: StitchCameraIcon,
    titulo: "1 · ESCANEA",
    detalle:
      "Apunta la cámara al acta E-14 llenando el encuadre. También puedes subir una foto o un PDF.",
  },
  {
    Icon: StitchSpinIcon,
    titulo: "2 · ANALIZA",
    detalle:
      "La app detecta los bordes del acta, la endereza y lee la cabecera y el contenido con OCR.",
  },
  {
    Icon: StitchEyeIcon,
    titulo: "3 · REVISA",
    detalle:
      "Comprueba el resultado: calidad del escaneo, clasificación (puesto · tipo · mesa · página) y texto leído.",
  },
  {
    Icon: StitchCloudCheckIcon,
    titulo: "4 · TRANSMITE",
    detalle:
      "Las actas óptimas se envían solas; las demás te pedimos confirmación o un rescaneo. Sin conexión, se acumulan en cola.",
  },
];

const NIVELES = [
  {
    chip: "ÓPTIMA",
    rango: "score ≥ 8.0",
    color: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
    accion: "Se envía automáticamente.",
  },
  {
    chip: "ADVERTENCIA",
    rango: "6.5 – 7.9",
    color: "text-amber-300 border-amber-500/40 bg-amber-500/10",
    accion: "Se pide confirmación o un rescaneo.",
  },
  {
    chip: "RECHAZADA",
    rango: "score < 6.5",
    color: "text-red-300 border-red-500/40 bg-red-500/10",
    accion: "Hay que repetir la foto (varios intentos → revisión humana).",
  },
];

const GLOSARIO: [string, string][] = [
  [
    "E-14",
    "El acta oficial de escrutinio que firman los jurados de mesa el día electoral.",
  ],
  [
    "DELEGADOS / TRANSMISIÓN",
    "Cada mesa tiene 2 páginas por tipo: DELEGADOS (elegidos) y TRANSMISIÓN (resultados). El guion completa P1 y P2 de cada tipo.",
  ],
  [
    "Score (0–10)",
    "Calidad de la digitalización: nitidez, contraste y legibilidad del OCR. Define el desenlace del acta.",
  ],
  [
    "Dedup",
    "Detección de duplicados: si subes la misma acta dos veces, la copia se marca y no contamina el registro.",
  ],
];

const TIPS = [
  "Luz uniforme sin sombras duras (evita el contraluz y el reflejo del flash).",
  "Acta apoyada plana: arrugas y curvas distorsionan el texto para el OCR.",
  "Llena el encuadre con el acta completa, sin cortar bordes.",
  "Si sale RECHAZADA dos veces, prueba desde SUBIR con una foto de la galería.",
];

export function AyudaOverlay() {
  const abierta = useAyudaStore((s) => s.abierta);
  const cerrar = useAyudaStore((s) => s.cerrar);

  // Primera visita: abre solo una vez (el flag se sella al cerrar).
  useEffect(() => {
    try {
      if (!localStorage.getItem(LS_KEY)) {
        useAyudaStore.getState().abrir();
      }
    } catch {
      /* sin localStorage (modo privado): simplemente no auto-abre */
    }
  }, []);

  // Escape cierra.
  useEffect(() => {
    if (!abierta) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierta, cerrar]);

  if (!abierta) return null;

  const cerrarYRecordar = () => {
    try {
      localStorage.setItem(LS_KEY, "1");
    } catch {
      /* modo privado: la próxima visita la volverá a mostrar — aceptable */
    }
    cerrar();
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Cómo funciona el Digitalizador E-14"
      onClick={cerrarYRecordar}
    >
      <div
        className="w-full max-w-lg max-h-[88dvh] overflow-y-auto thin-scroll bg-[#10161f] border border-slate-700/80 rounded-3xl shadow-[0_24px_80px_rgba(0,0,0,0.6)] animate-view-enter"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="sticky top-0 z-10 bg-[#10161f]/95 backdrop-blur px-6 pt-6 pb-4 border-b border-slate-800/80">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">
            Guía rápida
          </p>
          <h2 className="text-xl font-extrabold text-white mt-1">
            ¿Cómo funciona el Digitalizador?
          </h2>
          <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">
            Convierte las fotos de las actas E-14 en registros digitales
            verificados: escanea, la app lee el acta con OCR y transmite el
            resultado.
          </p>
        </div>

        <div className="px-6 py-5 flex flex-col gap-6">
          {/* Flujo */}
          <section aria-label="Flujo de trabajo" className="flex flex-col gap-3">
            {PASOS.map(({ Icon, titulo, detalle }) => (
              <div key={titulo} className="flex items-start gap-3.5">
                <span className="shrink-0 w-10 h-10 rounded-xl bg-[#0b1117] border border-slate-800 flex items-center justify-center text-emerald-400">
                  <Icon className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-white">
                    {titulo}
                  </p>
                  <p className="text-[13px] text-slate-400 leading-relaxed mt-0.5">
                    {detalle}
                  </p>
                </div>
              </div>
            ))}
          </section>

          {/* Niveles de calidad */}
          <section aria-label="Niveles de calidad">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">
              Niveles de calidad (score)
            </p>
            <div className="flex flex-col gap-2">
              {NIVELES.map((n) => (
                <div
                  key={n.chip}
                  className="flex items-center gap-3 rounded-xl border px-3.5 py-2.5 bg-[#0b1117]"
                >
                  <span
                    className={`shrink-0 font-mono text-[10px] font-extrabold uppercase tracking-wider rounded-md px-2 py-1 border ${n.color}`}
                  >
                    {n.chip}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400 tabular-nums w-[74px] shrink-0">
                    {n.rango}
                  </span>
                  <span className="text-[12px] text-slate-400 leading-snug">
                    {n.accion}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Glossario */}
          <section aria-label="Glosario">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">
              Términos clave
            </p>
            <dl className="flex flex-col gap-2.5">
              {GLOSARIO.map(([term, def]) => (
                <div key={term} className="flex flex-col gap-0.5">
                  <dt className="font-mono text-[11px] font-bold text-slate-200">
                    {term}
                  </dt>
                  <dd className="text-[12.5px] text-slate-400 leading-relaxed">
                    {def}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Tips */}
          <section aria-label="Consejos de foto" className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3.5">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-2">
              Tips para un escaneo óptimo
            </p>
            <ul className="flex flex-col gap-1.5">
              {TIPS.map((t) => (
                <li key={t} className="flex gap-2 text-[12.5px] text-slate-300 leading-relaxed">
                  <span className="text-emerald-400 font-mono shrink-0" aria-hidden>
                    ▸
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* CTA */}
        <div className="sticky bottom-0 bg-[#10161f]/95 backdrop-blur px-6 py-4 border-t border-slate-800/80">
          <button
            type="button"
            onClick={cerrarYRecordar}
            autoFocus
            className="w-full min-h-11 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-black font-mono font-extrabold text-sm uppercase tracking-widest transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            Entendido — empezar
          </button>
          <p className="text-center text-[10px] text-slate-400 mt-2 font-mono">
            Vuelve a abrirla con «?» — CÓMO FUNCIONA (menú lateral)
          </p>
        </div>
      </div>
    </div>
  );
}
