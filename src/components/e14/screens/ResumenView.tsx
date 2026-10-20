"use client";

/**
 * RESUMEN (§7.7 / C2) — "RESUMEN DE TRABAJO": progreso del puesto (barra
 * segmentada de 12), tarjetas de estadística (cola offline / rescaneos) e
 * historial de envíos con barra de acento por estado. Reactivo en vivo.
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

  // KIT e14-informe-analisis-v1 (T2): botón INFORME ↓ — reintroducción POR
  // PEDIDO EXPLÍCITO del dueño (19/10) del análisis en ZIP (original +
  // procesada byte-idénticas + fichas de la COLA MASIVA). §0.2: NADA se
  // descarga solo — SIEMPRE detrás de este botón. Sin toasts (D2):
  // píldora role=status/alert + feedback en el propio botón.
  const [colaVacia, setColaVacia] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [listo, setListo] = useState(false);
  const [motivo, setMotivo] = useState<string | null>(null);

  // KIT L6: REINICIAR JORNADA con confirmación de 2 toques (mismo patrón del
  // VACIAR de MASIVA — sin diálogos nativos). 4 s de ventana para confirmar.
  const reiniciarJornada = useE14Store((s) => s.reiniciarJornada);
  const [reiniciarArmado, setReiniciarArmado] = useState(false);
  useEffect(() => {
    if (!reiniciarArmado) return;
    const t = window.setTimeout(() => setReiniciarArmado(false), 4000);
    return () => window.clearTimeout(t);
  }, [reiniciarArmado]);

  // Chequeo SOLO al montar (kit T2.2 — barato): IDB caída → tratada como
  // vacía (el informe no puede nacer; mismo fallback honesto de MASIVA).
  // FIX C6: count() nativo de IDB — un conteo NO debe deserializar TODA la
  // cola (actas con dataURLs de ~7-14 MB c/u) para pedir su longitud.
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
      // D49: imports DIFERIDOS (patrón D47 de archivos.ts) — el generador
      // del ZIP y la descarga del core NO pesan en el bundle inicial.
      const [{ generarInformeZip }, { downloadBlob }] = await Promise.all([
        import("@/lib/e14/informe"),
        import("@jg-stevan/scanner-core/pdf-export"),
      ]);
      const { blob, nombre } = await generarInformeZip();
      downloadBlob(blob, nombre);
      setListo(true);
      window.setTimeout(() => setListo(false), 1500); // patrón ReviewView
    } catch (err) {
      // Motivo corto ≤48 (patrón fallback IDB de MasivaView) — sin toasts.
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

        {/* KIT e14-informe-analisis-v1 (T2): INFORME ↓ en el hueco del
            retirado EXPORTAR REPORTE — forma nueva pedida por el dueño
            (19/10): ZIP local (sin red) con original+procesada de las
            actas problema de la COLA MASIVA. Nada se descarga solo (§0.2):
            SIEMPRE este botón. Sin toasts (D2). */}
        <section className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void generarInforme();
            }}
            disabled={colaVacia || generando || listo}
            aria-label="Generar informe de análisis (ZIP)"
            className="min-h-[44px] px-6 rounded-xl bg-brand-green text-black font-mono text-[11px] font-extrabold uppercase tracking-wider shadow-[0_0_10px_rgba(0,230,118,0.2)] hover:brightness-110 disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60"
          >
            {listo
              ? "LISTO ✓"
              : generando
                ? "GENERANDO…"
                : colaVacia
                  ? "INFORME ↓ (COLA VACÍA)"
                  : "INFORME ↓"}
          </button>
          {generando && (
            <p
              role="status"
              aria-live="polite"
              className="inline-block rounded-full border border-brand-borderdim px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-gray-300"
            >
              GENERANDO INFORME…
            </p>
          )}
          {motivo && (
            <p
              role="alert"
              className="rounded-xl border border-amber-400/60 bg-amber-400/10 px-3.5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-amber-400"
            >
              {motivo}
            </p>
          )}
          {/* KIT L6: REINICIAR JORNADA — cierra el día de votación (borra
              mesas archivadas, historial, contadores, acta en revisión y la
              cola MASIVA). 2 toques (patrón VACIAR de MASIVA), aislado abajo
              del INFORME para que el pulgar no lo toque por accidente. */}
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
            className={`min-h-[44px] px-6 rounded-xl border font-mono text-[11px] font-bold uppercase tracking-wider focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 ${
              reiniciarArmado
                ? "border-red-500 text-red-400 bg-red-500/10"
                : "border-brand-border bg-brand-surface text-gray-400 hover:border-red-500/50 hover:text-red-400"
            }`}
          >
            {reiniciarArmado
              ? "¿SEGURO? REINICIAR JORNADA"
              : "REINICIAR JORNADA"}
          </button>
        </section>

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
