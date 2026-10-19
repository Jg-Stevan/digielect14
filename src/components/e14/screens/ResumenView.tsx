"use client";

/**
 * RESUMEN (§7.7 / C2) — "RESUMEN DE TRABAJO": progreso del puesto (barra
 * segmentada de 12), tarjetas de estadística (cola offline / rescaneos) e
 * historial de envíos con barra de acento por estado. Reactivo en vivo.
 */
import { useE14Store } from "@/lib/e14/store";
import type { HistorialRow } from "@/lib/e14/types";
import { PUESTO_SIMULADO } from "@/lib/e14/seed";
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
  // KIT e14-esquinas-suaves-v1 (T-R): los números salen del GUION VIVO
  // (store.mesas — el mismo que ACTAS): real (registrarEnvio marca OK) y SIM
  // (avanzarSimulacion marca OK cada 5 s) escriben el MISMO guion → RESUMEN
  // refleja ambos en vivo. D6: SOLO lectura — nunca se escribe estado aquí.
  // Los selectores de seed (completadas/asignadasHoy/colaOffline/
  // solicitudesRescaneo) quedan como estado interno del store (registrarEnvio
  // y contingencia C4 los usan) — RESUMEN deja de leerlos.
  const mesas = useE14Store((s) => s.mesas);
  const historial = useE14Store((s) => s.historial);
  // KIT e14-optimizacion-v1 (T5): contador de sesión «por qué no se envió»
  // (espejo pasivo del store — memoria de sesión, sin persistencia).
  const motivosNoEnvio = useE14Store((s) => s.motivosNoEnvio);
  // PUESTO ACTUAL (kit actas-resumen-puesto-v2): el real manda; en simulación
  // (sin puesto real) el demo — MISMO puesto que muestra ACTAS en todo momento.
  const puestoReal = useE14Store((s) => s.puestoActual);
  const modoSimulacion = useE14Store((s) => s.modoSimulacion);
  const puestoMostrado = puestoReal ?? (modoSimulacion ? PUESTO_SIMULADO : null);

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

  // KIT e14-esquinas-suaves-v1 (T-R): ÚLTIMOS ENVÍOS durante SIM — filas
  // DERIVADAS del guion (recorrido en orden de llenado, más reciente primero
  // — el tick llena secuencialmente). El historial REAL (envíos de capturas
  // reales, contingencias) se muestra EXACTAMENTE como hoy con SIM OFF.
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
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll bg-brand-black flex flex-col">
      {/* Header propio de la pantalla (estructura de ACTAS, §7.7; H1 corregido — ver D12) */}
      <header className="sticky top-0 z-40 w-full bg-brand-black/95 backdrop-blur border-b border-brand-border/60 flex items-center justify-between px-4 h-14 shrink-0">
        <h1 className="font-mono text-sm font-bold tracking-widest text-brand-green uppercase">
          RESUMEN DE TRABAJO
        </h1>
      </header>

      <div className="flex-grow flex flex-col gap-6 px-4 pt-4 pb-6 max-w-md mx-auto w-full">
        {/* Puesto actual — REAL (última clasificación archivada) o SIMULADO.
            KIT e14-esquinas-suaves-v1 (T-R): la ruta suma el conteo de mesas
            del guion vivo (el MISMO que llena ACTAS). */}
        <section className="flex justify-between items-end border-b border-brand-border pb-2">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-gray-400">PUESTO ACTUAL</span>
            <h2 className="text-lg font-bold text-white uppercase">
              {puestoMostrado?.titulo ?? "SIN PUESTO"}
            </h2>
            {puestoMostrado && (
              <span className="font-mono text-xs text-gray-400">
                {`${puestoMostrado.municipio} > ZONA ${puestoMostrado.zona} > PUESTO ${puestoMostrado.puesto} · ${mesas.length} MESAS`}
              </span>
            )}
          </div>
        </section>

        {/* Progreso del puesto — KIT e14-esquinas-suaves-v1 (T-R): derivado
            del guion vivo (páginas OK / páginas totales). */}
        <div className="bg-brand-surface border border-brand-border p-3 flex flex-col gap-2 rounded-2xl">
          <div className="flex justify-between items-center">
            <span className="text-sm font-bold text-white">
              PROGRESO DEL PUESTO:{" "}
              <span className="font-mono font-extrabold text-brand-green">{pct}%</span>
            </span>
          </div>
          <SegmentedBar total={totalPaginas} filled={paginasOk} tone="ok" />
          <span className="text-sm text-gray-400">
            Has completado {paginasOk} de {totalPaginas} páginas del puesto.
          </span>
        </div>

        {/* Tarjetas de estadística — KIT e14-esquinas-suaves-v1 (T-R):
            pendientes/rescaneo DERIVADOS del guion (tonos amber/red intactos). */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-brand-surface border border-brand-border p-2.5 flex flex-col gap-1 rounded-2xl">
            <span className="font-mono text-3xl font-extrabold tabular-nums text-amber-400">
              {String(pendientes).padStart(2, "0")}
            </span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-gray-400">PÁGINAS PENDIENTES</span>
          </div>
          <div className="bg-brand-surface border border-brand-border p-2.5 flex flex-col gap-1 rounded-2xl">
            <span className="font-mono text-3xl font-extrabold tabular-nums text-red-500">
              {String(paginasRescaneo).padStart(2, "0")}
            </span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-gray-400">PÁGINAS EN RESCANEO</span>
          </div>
        </div>

        {/* KIT e14-optimizacion-v1 (T5): «POR QUÉ NO SE ENVIO — SESIÓN» —
            espejo PASIVO de desenlaces ya ocurridos (store.motivosNoEnvio,
            memoria de sesión: se resetea al recargar a propósito). Sin ZIP,
            sin descargas, el gate sin tocar — instrumento para calibrar con
            datos (AUDITORIA-e14 §4). Sin motivos → no se pinta nada. */}
        {Object.keys(motivosNoEnvio).length > 0 && (
          <div className="bg-brand-surface border border-brand-border p-3 flex flex-col gap-2 rounded-2xl">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-gray-400">
              POR QUÉ NO SE ENVIO — SESIÓN
            </span>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(motivosNoEnvio).map(([clave, n]) => (
                <span
                  key={clave}
                  className="px-2.5 py-0.5 border border-brand-border text-gray-300 font-mono text-[11px] rounded-full whitespace-nowrap"
                >
                  {clave} ×{n}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* KIT e14-esquinas-suaves-v1 (T-C): la sección COMPORTAMIENTO
            (tasa de auto-envío + causas top + EXPORTAR REPORTE) se RETIRA —
            mandato del dueño §0.4. El acumulador/registrarDesenlace del store
            siguen vivos (el C4 de REVISIÓN y los ZIP de campo no dependían
            de esta vista); diagnostico.ts SIN CAMBIOS. */}

        {/* Historial de envíos — KIT e14-esquinas-suaves-v1 (T-R): con SIM
            ON las filas son DERIVADAS del guion (SIMULACIÓN — no toca el
            historial real); con SIM OFF, el historial real como siempre. */}
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <div className="flex flex-col">
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-gray-400">ÚLTIMOS ENVÍOS (HISTORIAL)</span>
              {modoSimulacion && (
                <span className="text-[10px] text-gray-500">(SIMULACIÓN — no toca el historial real)</span>
              )}
            </div>
            <span className="font-mono text-xs text-gray-400">
              {modoSimulacion ? `SIM ${paginasOk}/${totalPaginas}` : `ÚLT. ACT.: ${ultimaActividad}`}
            </span>
          </div>
          <div className="flex flex-col max-h-96 overflow-y-auto thin-scroll rounded-xl border border-brand-border">
            {filas.map((fila) => {
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
