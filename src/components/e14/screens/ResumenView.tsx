"use client";

/**
 * RESUMEN (§7.7 / C2) — "RESUMEN DE TRABAJO": progreso del puesto (barra
 * segmentada de 12), tarjetas de estadística (cola offline / rescaneos) e
 * historial de envíos con barra de acento por estado. Reactivo en vivo.
 */
import { useE14Store } from "@/lib/e14/store";
import { useState } from "react";
import type { HistorialRow } from "@/lib/e14/types";
import { PUESTO_SIMULADO } from "@/lib/e14/seed";
// KIT e14-diagnostico-autoenvio-v1 (C5): card COMPORTAMIENTO — tasa de
// auto-envío + causas top + export ZIP (§5). Datos de reporteComportamiento()
// (localStorage — re-cálculo en montaje, ligero §6-F).
import {
  exportarReporteComportamientoZip,
  reporteComportamiento,
} from "@/lib/e14/diagnostico";
import { SegmentedBar } from "../primitives";

function badgeEstado(estado: HistorialRow["estado"]) {
  switch (estado) {
    case "ENVIADO":
      return {
        label: "ENVIADO ✓",
        clases: "px-2.5 py-0.5 bg-[#00E676]/10 border border-[#00E676]/40 text-brand-green font-mono text-[11px]",
        barra: "bg-brand-green",
      };
    case "RESCANEO_REQUERIDO":
      return {
        label: "RESCANEO REQUERIDO ⚠️",
        clases: "px-2.5 py-0.5 bg-amber-400/10 border border-amber-400/40 text-amber-400 font-mono text-[11px]",
        barra: "bg-amber-400",
      };
    default:
      return {
        label: "REVISIÓN HUMANA",
        clases: "px-2.5 py-0.5 bg-amber-400/10 border border-amber-400/40 text-amber-400 font-mono text-[11px]",
        barra: "bg-amber-400",
      };
  }
}

export function ResumenView() {
  const completadas = useE14Store((s) => s.completadas);
  const asignadasHoy = useE14Store((s) => s.asignadasHoy);
  const colaOffline = useE14Store((s) => s.colaOffline);
  const solicitudesRescaneo = useE14Store((s) => s.solicitudesRescaneo);
  const historial = useE14Store((s) => s.historial);
  // PUESTO ACTUAL (kit actas-resumen-puesto-v2): el real manda; en simulación
  // (sin puesto real) el demo — MISMO puesto que muestra ACTAS en todo momento.
  const puestoReal = useE14Store((s) => s.puestoActual);
  const modoSimulacion = useE14Store((s) => s.modoSimulacion);
  const puestoMostrado = puestoReal ?? (modoSimulacion ? PUESTO_SIMULADO : null);

  const pct = Math.round((completadas / asignadasHoy) * 100);
  const ultimaActividad = historial[0]?.hora ?? "—";

  // KIT e14-diagnostico-autoenvio-v1 (C5): re-cálculo en render/montaje (§6-F
  // — ligero). La fuente vive en localStorage (e14-diag-v1) — el card se
  // refresca al navegar a RESUMEN (cada montaje re-ejecuta).
  const rep = reporteComportamiento();
  const [exportando, setExportando] = useState<"ok" | "err" | null>(null);
  const exportar = () => {
    const r = exportarReporteComportamientoZip();
    setExportando(r.ok ? "ok" : "err");
    if (r.ok) setTimeout(() => setExportando(null), 2500);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll bg-brand-black flex flex-col">
      {/* Header propio de la pantalla (estructura de ACTAS, §7.7; H1 corregido — ver D12) */}
      <header className="sticky top-0 z-40 w-full bg-brand-black/95 backdrop-blur border-b border-brand-border/60 flex items-center justify-between px-4 h-14 shrink-0">
        <h1 className="font-mono text-sm font-bold tracking-widest text-brand-green uppercase">
          RESUMEN DE TRABAJO
        </h1>
      </header>

      <div className="flex-grow flex flex-col gap-6 px-4 pt-4 pb-6 max-w-md mx-auto w-full">
        {/* Puesto actual — REAL (última clasificación archivada) o SIMULADO. */}
        <section className="flex justify-between items-end border-b border-brand-border pb-2">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-gray-400">PUESTO ACTUAL</span>
            <h2 className="text-lg font-bold text-white uppercase">
              {puestoMostrado?.titulo ?? "SIN PUESTO"}
            </h2>
            {puestoMostrado && (
              <span className="font-mono text-xs text-gray-400">
                {`${puestoMostrado.municipio} > ZONA ${puestoMostrado.zona} > PUESTO ${puestoMostrado.puesto}`}
              </span>
            )}
          </div>
        </section>

        {/* Progreso del puesto */}
        <div className="bg-brand-surface border border-brand-border p-3 flex flex-col gap-2 rounded-2xl">
          <div className="flex justify-between items-center">
            <span className="text-sm font-bold text-white">
              PROGRESO DEL PUESTO:{" "}
              <span className="font-mono font-extrabold text-brand-green">{pct}%</span>
            </span>
          </div>
          <SegmentedBar total={asignadasHoy} filled={completadas} tone="ok" />
          <span className="text-sm text-gray-400">
            Has completado {completadas} de {asignadasHoy} páginas asignadas hoy.
          </span>
        </div>

        {/* Tarjetas de estadística */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-brand-surface border border-brand-border p-2.5 flex flex-col gap-1 rounded-2xl">
            <span className="font-mono text-3xl font-extrabold tabular-nums text-amber-400">
              {String(colaOffline).padStart(2, "0")}
            </span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-gray-400">PENDIENTES EN COLA (OFFLINE)</span>
          </div>
          <div className="bg-brand-surface border border-brand-border p-2.5 flex flex-col gap-1 rounded-2xl">
            <span className="font-mono text-3xl font-extrabold tabular-nums text-red-500">
              {String(solicitudesRescaneo).padStart(2, "0")}
            </span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-gray-400">SOLICITUD DE RESCANEO</span>
          </div>
        </div>

        {/* KIT e14-diagnostico-autoenvio-v1 (C5): COMPORTAMIENTO — la métrica
            del dueño (tasa de auto-envío) + 3 causas top con barra proporcional
            + export ZIP (JSON+TXT). SIM no registra — solo desenlaces reales. */}
        <section className="bg-brand-surface border border-brand-border p-3 flex flex-col gap-2.5 rounded-2xl" aria-label="Comportamiento del puesto">
          <div className="flex justify-between items-center">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-gray-400">COMPORTAMIENTO</span>
            <span className="font-mono text-[10px] text-gray-500 tabular-nums">{rep.total} desenlaces</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-3xl font-extrabold tabular-nums text-brand-green">{rep.tasaPct}%</span>
            <span className="text-xs text-gray-400">auto-envío ({rep.autoEnviadas}/{rep.total})</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {rep.causasTop.map((c) => (
              <div key={c.causa} className="flex flex-col gap-0.5">
                <div className="flex justify-between gap-2 items-baseline">
                  <span className="font-mono text-[11px] text-white truncate" title={c.causa}>{c.causa}</span>
                  <span className="font-mono text-[11px] text-gray-400 tabular-nums shrink-0">{c.n}</span>
                </div>
                <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full bg-amber-400" style={{ width: `${Math.max(4, c.pct)}%` }} />
                </div>
              </div>
            ))}
            {rep.causasTop.length === 0 && (
              <span className="text-[11px] text-gray-500">Sin desenlaces no-auto registrados aún.</span>
            )}
          </div>
          <button
            type="button"
            onClick={exportar}
            className={`w-full py-2 rounded-xl border font-mono font-bold text-[10px] uppercase tracking-wider transition-all tap-action ${
              exportando === "ok"
                ? "border-brand-green/60 text-brand-green"
                : exportando === "err"
                  ? "border-red-500/60 text-red-400"
                  : "border-brand-border text-gray-300 hover:bg-white/5"
            }`}
          >
            {exportando === "ok" ? "EXPORTADO ✓" : exportando === "err" ? "NO SE PUDO" : "EXPORTAR REPORTE"}
          </button>
        </section>

        {/* Historial de envíos */}
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-gray-400">ÚLTIMOS ENVÍOS (HISTORIAL)</span>
            <span className="font-mono text-xs text-gray-400">ÚLT. ACT.: {ultimaActividad}</span>
          </div>
          <div className="flex flex-col max-h-96 overflow-y-auto thin-scroll rounded-xl border border-brand-border">
            {historial.map((fila) => {
              const badge = badgeEstado(fila.estado);
              return (
                <div
                  key={fila.id}
                  className="min-h-12 bg-brand-surface flex items-center justify-between gap-2 px-3 py-2 border-b border-brand-border last:border-b-0 relative overflow-hidden"
                >
                  <span className={`absolute left-0 top-0 bottom-0 w-1 ${badge.barra}`} aria-hidden />
                  <span className="font-mono text-[13px] text-white pl-1 min-w-0 truncate">
                    {fila.titulo}
                  </span>
                  <span className={`${badge.clases} whitespace-nowrap shrink-0 rounded-full`}>
                    {badge.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
