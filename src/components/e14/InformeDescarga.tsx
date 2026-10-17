"use client";

/**
 * InformeDescarga.tsx — INFORME-TELEMETRÍA v1 (SPEC-informe-telemetria-ocr-v1 §4.9)
 *
 * Píldora de descarga del informe: renderiza SOLO cuando el informe YA está
 * listo (`estado === "listo"`). Fija abajo-derecha (encima de BottomNav),
 * estilo del sistema (charcoal, borde white/15, label-caps 10px), dos botones
 * INFORME TXT / INFORME JSON. Tras descargar, los botones quedan con
 * opacidad reducida (por si quiere re-descargar). Nada más en la UI.
 */
import { useState } from "react";
import { informeStore } from "@/lib/e14/informe/telemetria";

export function InformeDescarga() {
  const estado = informeStore((s) => s.estado);
  const nombreBase = informeStore((s) => s.nombreBase);
  const descargarInforme = informeStore((s) => s.descargarInforme);
  const [descargados, setDescargados] = useState(false);

  if (estado !== "listo" || !nombreBase) return null;

  const bajar = (tipo: "txt" | "json") => {
    descargarInforme(tipo);
    setDescargados(true);
  };

  return (
    <div
      role="status"
      aria-label="Informe de telemetría listo para descargar"
      className="animate-view-enter fixed right-3 bottom-24 z-50 flex flex-col gap-1.5 rounded-xl border border-white/15 bg-[#080C0A]/95 px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur"
    >
      <span className="text-center text-[10px] font-bold uppercase tracking-wider text-white/50">
        Informe listo
      </span>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => bajar("txt")}
          className={`rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/90 transition-colors hover:bg-white/10 active:bg-white/15 ${descargados ? "opacity-50" : ""}`}
        >
          Informe TXT
        </button>
        <button
          type="button"
          onClick={() => bajar("json")}
          className={`rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/90 transition-colors hover:bg-white/10 active:bg-white/15 ${descargados ? "opacity-50" : ""}`}
        >
          Informe JSON
        </button>
      </div>
    </div>
  );
}
