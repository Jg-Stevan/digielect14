"use client";

/**
 * VistaErrores — detalle de reportes de errores con breadcrumbs (KIT
 * e14-observabilidad-v1, agente 2 · C5). Modal HIJO del PanelDev
 * (z-[80] sobre el z-[70] del panel): cada `ErroresAgrupados` como card;
 * al expandir, los breadcrumbs del evento más reciente en timeline
 * vertical — el dueño ve «cómo surgió» cada error.
 *
 * Botón «VACIAR BUFFER» con confirmación armada (patrón 4 s) →
 * `purgarBuffer()`. FASE 0: datos vía dev/puente.ts (buffer honestamente
 * vacío); FASE 1: solo cambia el puente.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { eventosPorDigest, purgarBuffer } from "./puente";
import type { Breadcrumb, ErroresAgrupados } from "./contrato";

/** Timeout del armado — el MISMO patrón de «reiniciar jornada» (4 s). */
const ARMADO_MS = 4000;

/** Etiqueta legible del tipo de breadcrumb (contrato §4.2). */
const TIPO_BREADCRUMB: Record<Breadcrumb["tipo"], string> = {
  click: "clic",
  vista: "vista",
  cola: "cola",
  store: "store",
  red: "red",
};

/** Fecha relativa compacta: «hace 2 min». */
function hace(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

export function VistaErrores({
  onClose,
  alVaciar,
}: {
  onClose: () => void;
  alVaciar: () => void;
}) {
  const [errores, setErrores] = useState<ErroresAgrupados[]>([]);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [vaciarArmado, setVaciarArmado] = useState(false);
  const refPanel = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    try {
      setErrores(await eventosPorDigest());
    } catch {
      setErrores([]); // el rastreo jamás rompe la app
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Armado efímero del «VACIAR BUFFER» (timeout 4 s).
  useEffect(() => {
    if (!vaciarArmado) return;
    const t = window.setTimeout(() => setVaciarArmado(false), ARMADO_MS);
    return () => window.clearTimeout(t);
  }, [vaciarArmado]);

  // Esc cierra (el panel padre desactiva SU manejador mientras esto está abierto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const vaciar = async () => {
    setVaciarArmado(false);
    try {
      await purgarBuffer();
      await cargar();
      alVaciar();
    } catch {
      /* el rastreo jamás rompe la app */
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Detalle de errores y breadcrumbs"
      onClick={onClose}
    >
      <div
        ref={refPanel}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90dvh] overflow-y-auto thin-scroll bg-[#10161f] border border-slate-700/80 rounded-3xl shadow-[0_24px_80px_rgba(0,0,0,0.6)] animate-view-enter"
      >
        {/* Cabecera */}
        <div className="sticky top-0 z-10 bg-[#10161f]/95 backdrop-blur px-5 pt-5 pb-3.5 border-b border-slate-800/80 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[#10b981]">
              Reportes de errores
            </p>
            <h2 className="text-lg font-extrabold text-white mt-0.5">
              ERRORES Y BREADCRUMBS
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="Cerrar detalle de errores"
            className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl border border-slate-700/70 bg-slate-800/60 hover:border-slate-500 text-slate-300 font-mono text-base flex items-center justify-center transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10b981]"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-3">
          {errores.length === 0 ? (
            <p className="py-8 text-center font-mono text-[11px] text-slate-500">
              SIN ERRORES REGISTRADOS EN EL BUFFER
            </p>
          ) : (
            errores.map((e) => {
              const abierto = expandido === e.digest;
              return (
                <article
                  key={e.digest}
                  className="rounded-2xl border border-slate-800 bg-[#0b1117] p-3.5 flex flex-col gap-2"
                >
                  {/* Cabecera del card */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`font-mono text-[9px] font-black uppercase tracking-wider rounded-md px-2 py-1 border ${
                        e.severidad === "error"
                          ? "border-[#ef4444]/50 bg-[#ef4444]/15 text-[#ef4444]"
                          : "border-amber-400/50 bg-amber-400/15 text-amber-400"
                      }`}
                    >
                      {e.severidad}
                    </span>
                    <span className="font-mono text-[11px] font-bold text-slate-200 truncate min-w-0">
                      {e.tipo}
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-slate-500 shrink-0 tabular-nums">
                      ×{e.veces}
                    </span>
                  </div>

                  {/* Mensaje (truncado, expandible) */}
                  <p
                    className={`text-[12px] leading-snug text-slate-300 ${abierto ? "" : "line-clamp-2"}`}
                  >
                    {e.mensaje}
                  </p>

                  {/* Metadatos */}
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px]">
                    <div className="flex gap-1.5 min-w-0">
                      <dt className="text-slate-500 shrink-0">digest</dt>
                      <dd className="text-slate-300 truncate">{e.digest}</dd>
                    </div>
                    <div className="flex gap-1.5 min-w-0">
                      <dt className="text-slate-500 shrink-0">archivo</dt>
                      <dd className="text-slate-300 truncate">{e.archivo ?? "—"}</dd>
                    </div>
                    <div className="flex gap-1.5 min-w-0">
                      <dt className="text-slate-500 shrink-0">1.ª</dt>
                      <dd className="text-slate-300">{hace(e.primera)}</dd>
                    </div>
                    <div className="flex gap-1.5 min-w-0">
                      <dt className="text-slate-500 shrink-0">últ.</dt>
                      <dd className="text-slate-300">{hace(e.ultima)}</dd>
                    </div>
                  </dl>
                  {e.versiones.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {e.versiones.map((v) => (
                        <span
                          key={v}
                          className="font-mono text-[9px] text-slate-400 border border-slate-700/70 bg-slate-800/60 rounded px-1.5 py-0.5"
                        >
                          v{v}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Expandir → breadcrumbs del evento más reciente */}
                  <button
                    type="button"
                    onClick={() => setExpandido(abierto ? null : e.digest)}
                    aria-expanded={abierto}
                    className="self-start min-h-[32px] px-2.5 rounded-lg border border-slate-700 bg-slate-800/60 hover:border-[#10b981]/60 hover:text-[#10b981] text-slate-300 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10b981]/60"
                  >
                    {abierto ? "OCULTAR BREADCRUMBS" : `VER BREADCRUMBS (${e.breadcrumbsRecientes.length})`}
                  </button>

                  {abierto && (
                    <ol className="mt-1 ml-1.5 border-l border-slate-700/80 pl-4 flex flex-col gap-2.5">
                      {e.breadcrumbsRecientes.length === 0 ? (
                        <li className="font-mono text-[10.5px] text-slate-500">
                          SIN BREADCRUMBS PARA ESTE EVENTO
                        </li>
                      ) : (
                        e.breadcrumbsRecientes.map((b, i) => (
                          <li key={`${b.t}-${i}`} className="relative">
                            <span
                              aria-hidden="true"
                              className="absolute -left-[21px] top-1 w-2 h-2 rounded-full bg-[#10b981]/80 border border-[#0b1117]"
                            />
                            <p className="font-mono text-[10.5px] text-slate-300 leading-snug">
                              {hace(b.t)} · {TIPO_BREADCRUMB[b.tipo]} · {b.detalle}
                            </p>
                          </li>
                        ))
                      )}
                    </ol>
                  )}
                </article>
              );
            })
          )}

          {/* Vaciar buffer — confirmación armada (patrón 4 s) */}
          <div className="mt-2 flex flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (!vaciarArmado) {
                  setVaciarArmado(true);
                  return;
                }
                void vaciar();
              }}
              aria-label={
                vaciarArmado
                  ? "Confirmar vaciar el buffer de eventos"
                  : "Vaciar el buffer de eventos"
              }
              className={`w-full lg:max-w-sm min-h-[40px] px-4 rounded-xl border font-mono text-[11px] font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ef4444]/60 ${
                vaciarArmado
                  ? "border-red-500 text-red-400 bg-red-500/15 shadow-sm shadow-red-500/20"
                  : "border-slate-800 bg-[#0b1117] text-slate-400 hover:border-red-500/50 hover:text-red-400"
              }`}
            >
              {vaciarArmado
                ? "¿SEGURO? TOQUE DE NUEVO PARA VACIAR EL BUFFER"
                : "VACIAR BUFFER"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
