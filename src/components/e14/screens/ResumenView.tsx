"use client";

/**
 * RESUMEN (§7.7 / C2) — "RESUMEN DE TRABAJO": progreso del puesto (barra
 * segmentada de 12), tarjetas de estadística (cola offline / rescaneos) e
 * historial de envíos con barra de acento por estado. Reactivo en vivo.
 * Responsive 360→1280 (max-w-2xl en lg). La sección "ANÁLISIS DE LA
 * JORNADA" (donut + barras recharts) fue ELIMINADA a pedido del dueño.
 *
 * KIT e14-observabilidad-v1 (agente 2 · C1): tuerca del modo de
 * diagnóstico SIEMPRE visible arriba-izquierda del header (dev/
 * TuercaResumen) — activación armada, panel desde C4.
 * KIT e14-observabilidad-v1 (agente 2 · C3): el botón INFORME ZIP sale de
 * Resumen — el flujo (lazy import generarInformeZip + downloadBlob,
 * chequeo de cola vacía, mensajes) MIGRA a la sección Exportar del
 * PanelDev (C4). Resumen queda con: barra segmentada, tarjetas,
 * historial, reiniciar jornada y tuerca.
 */
import { useEffect, useState } from "react";
import { useE14Store } from "@/lib/e14/store";
import type { HistorialRow } from "@/lib/e14/types";
import { PUESTO_SIMULADO } from "@/lib/e14/seed";
import { SegmentedBar } from "../primitives";
// KIT e14-observabilidad-v1 (agente 2 · C1): puerta del modo de diagnóstico.
import { TuercaResumen } from "../dev/TuercaResumen";
// KIT e14-observabilidad-v1 (agente 2 · C4): panel completo del modo dev.
import { PanelDev } from "../dev/PanelDev";

function badgeEstado(estado: HistorialRow["estado"]) {
  switch (estado) {
    case "ENVIADO":
      return {
        label: "ENVIADO ✓",
        clases: "px-2.5 py-1 bg-[#10b981]/15 border border-[#10b981]/40 text-[#10b981] font-mono font-bold text-[11px]",
        barra: "bg-[#10b981]",
      };
    case "RESCANEO_REQUERIDO":
      return {
        label: "RESCANEO ⚠️",
        clases: "px-2.5 py-1 bg-[#ef4444]/15 border border-[#ef4444]/40 text-[#ef4444] font-mono font-bold text-[11px]",
        barra: "bg-[#ef4444]",
      };
    default:
      return {
        label: "REVISIÓN HUMANA",
        clases: "px-2.5 py-1 bg-amber-400/15 border border-amber-400/40 text-amber-400 font-mono font-bold text-[11px]",
        barra: "bg-amber-400",
      };
  }
}

export function ResumenView() {
  const mesas = useE14Store((s) => s.mesas);
  const historial = useE14Store((s) => s.historial);
  const puestoReal = useE14Store((s) => s.puestoActual);
  const modoSimulacion = useE14Store((s) => s.modoSimulacion);
  const puestoMostrado = puestoReal ?? (modoSimulacion ? PUESTO_SIMULADO : null);

  const reiniciarJornada = useE14Store((s) => s.reiniciarJornada);
  const [reiniciarArmado, setReiniciarArmado] = useState(false);
  // KIT e14-observabilidad-v1 (agente 2 · C4): el panel SOLO se abre desde
  // la tuerca (sin ruta ni query param).
  const [panelAbierto, setPanelAbierto] = useState(false);
  useEffect(() => {
    if (!reiniciarArmado) return;
    const t = window.setTimeout(() => setReiniciarArmado(false), 4000);
    return () => window.clearTimeout(t);
  }, [reiniciarArmado]);

  const totalPaginas = mesas.reduce((n, m) => n + m.paginas.length, 0);
  const paginasOk = mesas.reduce(
    (n, m) => n + m.paginas.filter((p) => p.estado === "OK").length,
    0,
  );
  const paginasRescaneo = mesas.reduce(
    (n, m) => n + m.paginas.filter((p) => p.estado === "RESCANEO").length,
    0,
  );
  const pendientes = totalPaginas - paginasOk;
  const pct = totalPaginas > 0 ? Math.round((paginasOk / totalPaginas) * 100) : 0;
  const ultimaActividad = historial[0]?.hora ?? "—";

  const filas: HistorialRow[] = modoSimulacion
    ? mesas
        .flatMap((m) =>
          m.paginas
            .filter((p) => p.estado === "OK")
            .map((p) => ({
              id: `sim-${m.id}-${p.tipo}-${p.pagina}`,
              titulo: `${m.id} · ${p.tipo} P${p.pagina}`,
              estado: "ENVIADO" as const,
              hora: "SIM",
            })),
        )
        .reverse()
    : historial;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll bg-[#090d12] flex flex-col">
      <header className="sticky top-0 z-40 w-full bg-[#090d12]/92 backdrop-blur-xl border-b border-slate-800/80 px-4 h-14 shrink-0 shadow-xs">
        {/* KIT e14-observabilidad-v1 (agente 2 · C1): tuerca SIEMPRE visible
            arriba-izquierda del header; el contenido se corre a la derecha
            (pl) para despejar su blanco táctil de 44px. */}
        <div className="absolute left-2 top-1/2 -translate-y-1/2 z-50">
          <TuercaResumen onAbrirPanel={() => setPanelAbierto(true)} />
        </div>
        {/* Task 3: el contenido de la barra se alinea al ancho del contenedor
            de la vista (en lg+ ya no queda pegado al borde del viewport). */}
        <div className="max-w-md lg:max-w-2xl mx-auto w-full h-full flex items-center justify-between pl-[56px]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-[#10b981] shrink-0" />
            <h1 className="font-mono text-sm font-bold tracking-widest text-[#10b981] uppercase truncate">
              RESUMEN DE TRABAJO
            </h1>
          </div>
          <span className="font-mono text-[11px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-md border border-slate-700/60 whitespace-nowrap shrink-0">
            {pct}% <span className="hidden min-[400px]:inline">TRANSMITIDO</span>
          </span>
        </div>
      </header>

      <div className="flex-grow flex flex-col gap-5 px-4 pt-4 pb-8 max-w-md lg:max-w-2xl mx-auto w-full">
        {/* Puesto actual */}
        <section className="bg-[#10161f] border border-slate-800 rounded-2xl p-4 lg:p-5 shadow-sm flex flex-col gap-2">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
            PUESTO DE VOTACIÓN ASIGNADO
          </span>
          <h2 className="text-lg lg:text-xl font-bold text-white uppercase truncate">
            {puestoMostrado?.titulo ?? "SIN PUESTO REGISTRADO"}
          </h2>
          {puestoMostrado && (
            <div className="text-xs font-mono text-slate-400 border-t border-slate-800/80 pt-2 flex justify-between items-center">
              <span>{`${puestoMostrado.municipio} › ZONA ${puestoMostrado.zona} › PTO ${puestoMostrado.puesto}`}</span>
              <span className="font-bold text-slate-300">{mesas.length} MESAS</span>
            </div>
          )}
        </section>

        {/* Progreso del puesto */}
        <div className="bg-[#10161f] border border-slate-800 p-4 lg:p-5 flex flex-col gap-3 rounded-2xl shadow-sm">
          <div className="flex justify-between items-center">
            <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider">
              PROGRESO DE TRANSMISIÓN
            </span>
            <span className="font-mono font-extrabold text-lg text-[#10b981] tabular-nums">
              {pct}%
            </span>
          </div>
          <SegmentedBar total={totalPaginas} filled={paginasOk} tone="ok" />
          <span className="text-xs text-slate-400 font-mono">
            Completadas {paginasOk} de {totalPaginas} páginas del puesto.
          </span>
        </div>

        {/* 3 Tarjetas de estadística KPI — Task 3: en lg+ más respiro */}
        <div className="grid grid-cols-3 gap-2 lg:gap-4">
          <div className="bg-[#10161f] border border-slate-800 p-3 lg:p-5 flex flex-col gap-1 rounded-2xl shadow-xs">
            <span className="font-mono text-2xl lg:text-3xl font-extrabold tabular-nums text-[#10b981]">
              {String(paginasOk).padStart(2, "0")}
            </span>
            <span className="font-mono text-[9px] lg:text-[10px] font-bold uppercase tracking-wider text-slate-400 leading-tight">
              PÁGINAS TRANSMITIDAS
            </span>
          </div>
          <div className="bg-[#10161f] border border-slate-800 p-3 lg:p-5 flex flex-col gap-1 rounded-2xl shadow-xs">
            <span className="font-mono text-2xl lg:text-3xl font-extrabold tabular-nums text-amber-400">
              {String(pendientes).padStart(2, "0")}
            </span>
            <span className="font-mono text-[9px] lg:text-[10px] font-bold uppercase tracking-wider text-slate-400 leading-tight">
              PÁGINAS PENDIENTES
            </span>
          </div>
          <div className="bg-[#10161f] border border-slate-800 p-3 lg:p-5 flex flex-col gap-1 rounded-2xl shadow-xs">
            <span className="font-mono text-2xl lg:text-3xl font-extrabold tabular-nums text-[#ef4444]">
              {String(paginasRescaneo).padStart(2, "0")}
            </span>
            <span className="font-mono text-[9px] lg:text-[10px] font-bold uppercase tracking-wider text-slate-400 leading-tight">
              EN RESCANEO
            </span>
          </div>
        </div>

        {/* Fin de jornada — el INFORME ZIP salió de aquí en C3 (migró al
            PanelDev, sección Exportar) */}
        <section className="flex flex-col items-center gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => {
              if (!reiniciarArmado) {
                setReiniciarArmado(true);
                return;
              }
              setReiniciarArmado(false);
              void reiniciarJornada();
            }}
            aria-label={
              reiniciarArmado
                ? "Confirmar reiniciar la jornada completa (incluye la cola masiva)"
                : "Reiniciar la jornada completa"
            }
            className={`w-full lg:max-w-sm min-h-[40px] px-4 rounded-xl border font-mono text-[11px] font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer ${
              reiniciarArmado
                ? "border-red-500 text-red-400 bg-red-500/15 shadow-sm shadow-red-500/20"
                : "border-slate-800 bg-[#10161f] text-slate-400 hover:border-red-500/50 hover:text-red-400"
            }`}
          >
            {reiniciarArmado
              ? "¿SEGURO? TOQUE DE NUEVO PARA REINICIAR JORNADA"
              : "REINICIAR JORNADA"}
          </button>
        </section>

        {/* Historial de envíos */}
        <div className="flex flex-col gap-2.5 pt-2">
          <div className="flex justify-between items-center">
            <div className="flex flex-col">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                HISTORIAL DE TRANSMISIONES
              </span>
              {modoSimulacion && (
                <span className="text-[10px] text-slate-400 font-mono">(DATOS EN MODO SIMULACIÓN)</span>
              )}
            </div>
            <span className="font-mono text-[11px] text-slate-400">
              {modoSimulacion ? `SIM ${paginasOk}/${totalPaginas}` : `ÚLT. ACT.: ${ultimaActividad}`}
            </span>
          </div>

          <div className="flex flex-col max-h-96 lg:max-h-[28rem] overflow-y-auto thin-scroll rounded-2xl border border-slate-800 bg-[#10161f] divide-y divide-slate-800/80 shadow-sm">
            {filas.length === 0 ? (
              <div className="p-4 text-center text-xs font-mono text-slate-400">
                NO HAY ENVÍOS REGISTRADOS EN ESTA SESIÓN
              </div>
            ) : (
              filas.map((fila) => {
                const badge = badgeEstado(fila.estado);
                return (
                  <div
                    key={fila.id}
                    className="min-h-12 flex items-center justify-between gap-3 px-3.5 lg:px-5 py-2.5 lg:py-3 relative overflow-hidden hover:bg-slate-800/30 transition-colors"
                  >
                    <span className={`absolute left-0 top-0 bottom-0 w-1 ${badge.barra}`} aria-hidden />
                    <span className="font-mono text-xs text-white pl-1.5 min-w-0 truncate font-semibold">
                      {fila.titulo}
                    </span>
                    <span className={`${badge.clases} whitespace-nowrap shrink-0 rounded-full shadow-xs`}>
                      {badge.label}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* KIT e14-observabilidad-v1 (agente 2 · C4): panel de diagnóstico —
          overlay fijo (z-[70]) montado desde la tuerca. */}
      {panelAbierto && <PanelDev onClose={() => setPanelAbierto(false)} />}
    </div>
  );
}
