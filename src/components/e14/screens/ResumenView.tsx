"use client";

/**
 * RESUMEN (§7.7 / C2) — "RESUMEN DE TRABAJO": progreso del puesto (barra
 * segmentada de 12), tarjetas de estadística (cola offline / rescaneos) e
 * historial de envíos con barra de acento por estado. Reactivo en vivo.
 * Responsive 360→1280 (max-w-2xl en lg). La sección "ANÁLISIS DE LA
 * JORNADA" (donut + barras recharts) fue ELIMINADA a pedido del dueño.
 */
import { useEffect, useState } from "react";
import { useE14Store } from "@/lib/e14/store";
import type { HistorialRow } from "@/lib/e14/types";
import { PUESTO_SIMULADO } from "@/lib/e14/seed";
// KIT e14-informe-analisis-v1 (T2): chequeo barato de la cola masiva al
// montar — decide el disabled del botón INFORME ↓ (cola.ts INTOCABLE).
import { contarRegistros } from "@/lib/e14/masiva/cola";
import { SegmentedBar } from "../primitives";

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

  const [colaVacia, setColaVacia] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [listo, setListo] = useState(false);
  const [motivo, setMotivo] = useState<string | null>(null);

  const reiniciarJornada = useE14Store((s) => s.reiniciarJornada);
  const [reiniciarArmado, setReiniciarArmado] = useState(false);
  useEffect(() => {
    if (!reiniciarArmado) return;
    const t = window.setTimeout(() => setReiniciarArmado(false), 4000);
    return () => window.clearTimeout(t);
  }, [reiniciarArmado]);

  useEffect(() => {
    let vivo = true;
    contarRegistros()
      .then((total) => {
        if (vivo) setColaVacia(total === 0);
      })
      .catch(() => {
        if (vivo) setColaVacia(true);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const generarInforme = async () => {
    if (generando || colaVacia) return;
    setGenerando(true);
    setListo(false);
    setMotivo(null);
    try {
      const [{ generarInformeZip }, { downloadBlob }] = await Promise.all([
        import("@/lib/e14/informe"),
        import("@jg-stevan/scanner-core/pdf-export"),
      ]);
      const { blob, nombre } = await generarInformeZip();
      downloadBlob(blob, nombre);
      setListo(true);
      window.setTimeout(() => setListo(false), 1500);
    } catch (err) {
      const crudo = err instanceof Error ? err.message : String(err);
      const corto = crudo.replace(/\s+/g, " ").trim().slice(0, 48);
      setMotivo((corto || "NO SE PUDO GENERAR").toUpperCase());
    } finally {
      setGenerando(false);
    }
  };

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
        {/* Task 3: el contenido de la barra se alinea al ancho del contenedor
            de la vista (en lg+ ya no queda pegado al borde del viewport). */}
        <div className="max-w-md lg:max-w-2xl mx-auto w-full h-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#10b981]" />
            <h1 className="font-mono text-sm font-bold tracking-widest text-[#10b981] uppercase">
              RESUMEN DE TRABAJO
            </h1>
          </div>
          <span className="font-mono text-[11px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-md border border-slate-700/60">
            {pct}% TRANSMITIDO
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

        {/* Acciones de informe y fin de jornada */}
        <section className="flex flex-col items-center gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => {
              void generarInforme();
            }}
            disabled={colaVacia || generando || listo}
            aria-label="Generar informe de análisis (ZIP)"
            className="w-full lg:max-w-sm min-h-[44px] px-6 rounded-xl bg-[#10b981] hover:bg-[#059669] text-[#090d12] font-mono text-xs font-black uppercase tracking-wider shadow-lg shadow-[#10b981]/20 transition-all active:scale-[0.98] disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
          >
            <span>↓</span>
            <span>
              {listo
                ? "INFORME GENERADO ✓"
                : generando
                  ? "GENERANDO ZIP…"
                  : colaVacia
                    ? "INFORME ZIP (COLA VACÍA)"
                    : "DESCARGAR INFORME ZIP"}
            </span>
          </button>
          {generando && (
            <p
              role="status"
              aria-live="polite"
              className="inline-block rounded-full border border-slate-800 bg-[#10161f] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-300"
            >
              EMPAQUETANDO ARCHIVOS DE AUDITORÍA…
            </p>
          )}
          {motivo && (
            <p
              role="alert"
              className="rounded-xl border border-amber-400/60 bg-amber-400/10 px-3.5 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-amber-400"
            >
              {motivo}
            </p>
          )}

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
                <span className="text-[10px] text-slate-500 font-mono">(DATOS EN MODO SIMULACIÓN)</span>
              )}
            </div>
            <span className="font-mono text-[11px] text-slate-400">
              {modoSimulacion ? `SIM ${paginasOk}/${totalPaginas}` : `ÚLT. ACT.: ${ultimaActividad}`}
            </span>
          </div>

          <div className="flex flex-col max-h-96 lg:max-h-[28rem] overflow-y-auto thin-scroll rounded-2xl border border-slate-800 bg-[#10161f] divide-y divide-slate-800/80 shadow-sm">
            {filas.length === 0 ? (
              <div className="p-4 text-center text-xs font-mono text-slate-500">
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
    </div>
  );
}
