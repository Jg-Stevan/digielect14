"use client";

/**
 * KIT e14-simulacion-imagenes-v1 — galería «Imágenes simuladas» del visor.
 *
 * El icono de simulación (arriba a la derecha de ESCANEAR) abre esta hoja con
 * las fotos de prueba incluidas en el repo, cada una con título y descripción.
 * Sirve para que cualquier persona que revise el proyecto pruebe el escáner en
 * condiciones ya conocidas (completa, color, rotada, inclinada, con sombras y
 * recortada por arriba o por abajo) sin depender de una cámara. Elegir una
 * tarjeta entra por el MISMO pipeline que «Importar» (orientación, completitud,
 * esquinas, OCR y gate reales); nada se envía al hub ni ocupa el slot de la
 * jornada.
 *
 * El catálogo es ./lib/e14/simulacion-imagenes (fuente única con el bridge).
 */
import { useEffect } from "react";
import {
  IMAGENES_SIMULADAS,
  type ImagenSimuladaId,
} from "@/lib/e14/simulacion-imagenes";
import { SparklesIcon } from "./icons";

interface GaleriaSimulacionProps {
  abierta: boolean;
  /** Cierra la galería (✕, fondo o Escape). */
  onCerrar: () => void;
  /** El operador eligió una imagen: dispara la simulación y cierra. */
  onElegir: (id: ImagenSimuladaId) => void;
}

export function GaleriaSimulacion({ abierta, onCerrar, onElegir }: GaleriaSimulacionProps) {
  useEffect(() => {
    if (!abierta) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [abierta, onCerrar]);

  if (!abierta) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-6"
      role="presentation"
      onClick={onCerrar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="galeria-sim-titulo"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[88vh] flex flex-col rounded-2xl border border-slate-700 bg-[#0b1118]/[0.98] shadow-[0_16px_48px_rgba(0,0,0,0.6)] overflow-hidden"
      >
        <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
          <span className="w-9 h-9 rounded-xl bg-[#10161f] border border-slate-800 flex items-center justify-center text-[#10b981] shrink-0">
            <SparklesIcon className="w-5 h-5" />
          </span>
          <div className="flex-1 min-w-0">
            <h2
              id="galeria-sim-titulo"
              className="text-sm font-bold tracking-wide text-white uppercase"
            >
              Imágenes simuladas
            </h2>
            <p className="text-[10px] font-mono text-slate-400 leading-snug">
              El símbolo de simulación muestra imágenes simuladas del proyecto
              para probar el escáner en condiciones ya conocidas.
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar la galería de imágenes simuladas"
            className="min-h-11 min-w-11 shrink-0 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition flex items-center justify-center text-lg leading-none"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-2">
          {IMAGENES_SIMULADAS.map((imagen) => (
            <button
              key={imagen.id}
              type="button"
              onClick={() => onElegir(imagen.id)}
              aria-label={`Simular «${imagen.titulo}» — ${imagen.descripcion}`}
              className="group flex items-center gap-3 rounded-xl border border-slate-800 bg-[#10161f]/80 p-2 text-left transition hover:border-[#10b981]/60 hover:bg-[#10b981]/[0.06] active:scale-[0.99] focus:outline-none focus:border-[#10b981]"
            >
              <img
                src={imagen.thumb.src}
                width={imagen.thumb.width}
                height={imagen.thumb.height}
                alt=""
                className="h-20 w-16 shrink-0 rounded-lg object-cover border border-slate-700"
              />
              <span className="flex-1 min-w-0 flex flex-col gap-1">
                <span className="text-xs font-bold text-white">{imagen.titulo}</span>
                <span className="text-[11px] font-mono text-slate-400 leading-snug">
                  {imagen.descripcion}
                </span>
              </span>
              <span className="text-[#10b981] text-lg leading-none shrink-0" aria-hidden>
                ›
              </span>
            </button>
          ))}
        </div>

        <p className="border-t border-slate-800 px-4 py-2.5 text-[10px] font-mono text-slate-500 leading-snug">
          Fotos de prueba incluidas en el repositorio: no se envían al hub ni
          ocupan el cupo de la jornada. Cada imagen se procesa igual que con
          «Importar»; el botón «Importar» del dock sigue disponible para
          analizar una foto real.
        </p>
      </div>
    </div>
  );
}
