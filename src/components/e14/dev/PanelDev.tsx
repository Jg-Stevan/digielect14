"use client";

/**
 * PanelDev — panel del MODO DESARROLLADOR (antes «modo de diagnóstico»,
 * renombrado por el dueño — KIT e14-observabilidad-v1,
 * agente 2 · C4). La puerta de entrada visual a TODA la observabilidad.
 *
 * Convención de overlay COPIADA de AyudaOverlay.tsx (fixed inset-0 z-[70],
 * clic-fuera cierra, Esc cierra, role="dialog" aria-modal) + focus trap
 * básico. SOLO accesible desde la tuerca (sin ruta ni query param).
 *
 * Secciones (orden del kit C4 + kit e14-adaptacion-dispositivo-v1):
 *  1 · Estado (versión, modo, identidad truncada, política en texto)
 *  2 · Salud del dispositivo (snapshot + refrescar + muestreo cada 5 min)
 *  3 · Reportes de errores (contador + top-10 por digest; detalle → C5)
 *  4 · Ajustes de datos (4 toggles de PoliticaDatos — activar confirma, D4)
 *  5 · Exportar (JSON del reporte; vaciar buffer)
 *  6 · Kill switch (overrides MANUALES de flags — D6: la app nunca sola)
 *  7 · Flags activas (valor efectivo + refrescar)
 *  8 · Perfil del dispositivo (adaptación: capacidades + puntuación + plan
 *      por gama + DESCARGAR INFORME IA — kit e14-adaptacion-dispositivo-v1)
 *
 * FASE 1: datos REALES vía dev/puente.ts → obs/* (buffer IDB, salud,
 * identidad, export) + lib/e14/flags.ts — el núcleo ya existe y el puente
 * delega; consumidores y JSX sin cambios.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  appVersion,
  contarEventos,
  descargarInformeIA,
  descargarReporte,
  detenerMuestreoSalud,
  eventosPorDigest,
  guardarModoDev,
  guardarOverridesFlags,
  guardarPolitica,
  idDispositivo,
  idSesion,
  iniciarMuestreoSalud,
  leerFlags,
  obtenerPerfilDispositivo,
  planAdaptativo,
  refrescarFlags,
  useModoDev,
  useOverridesFlags,
  usePolitica,
} from "./puente";
import type { PerfilDispositivo } from "./puente";
import type { ErroresAgrupados, PoliticaDatos } from "@/lib/e14/obs/tipos";
// KIT e14-observabilidad-v1 (agente 2 · C5): detalle de errores + breadcrumbs.
import { VistaErrores } from "./VistaErrores";
// KIT e14-observabilidad-v1 (agente 2 · C6): salud en vivo (30 s, solo panel abierto).
import { useSaludVivo } from "./useSaludVivo";
// KIT e14-rastreo-tiempos-v1: test/rastréo de tiempos de digitalización
// (sección 9) — activado desde el modo desarrollador, mide el flujo como
// lo usaría un usuario normal.
import { SeccionRastreo } from "./SeccionRastreo";

/** Timeout del armado — el MISMO patrón de «reiniciar jornada» (4 s). */
const ARMADO_MS = 4000;

/** Armado efímero reutilizable (patrón «reiniciar jornada»: timeout 4 s). */
function useArmado(): [boolean, () => void, () => void] {
  const [armado, setArmado] = useState(false);
  useEffect(() => {
    if (!armado) return;
    const t = window.setTimeout(() => setArmado(false), ARMADO_MS);
    return () => window.clearTimeout(t);
  }, [armado]);
  return [armado, () => setArmado(true), () => setArmado(false)];
}

function TituloSeccion({
  n,
  titulo,
  hijo,
}: {
  n: number;
  titulo: string;
  hijo?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
        {n} · {titulo}
      </h3>
      {hijo}
    </div>
  );
}

function FilaDato({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">
        {etiqueta}
      </span>
      <span className="font-mono text-[12px] text-slate-200 text-right min-w-0 break-all">
        {valor}
      </span>
    </div>
  );
}

/** Switch de fila (el repo no tenía switch estándar — vive aquí, dentro de
 *  mi zona dev/). Toda la fila es el botón (blanco táctil ≥44px). */
function SwitchFila({
  etiqueta,
  nota,
  activo,
  onAlternar,
  ariaLabel,
}: {
  etiqueta: string;
  nota?: string;
  activo: boolean;
  onAlternar: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={ariaLabel}
      onClick={onAlternar}
      className="w-full min-h-11 flex items-center justify-between gap-3 rounded-xl px-3 hover:bg-slate-800/40 focus-visible:bg-slate-800/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10b981]/60 transition-colors text-left cursor-pointer"
    >
      <span className="min-w-0 flex flex-col gap-0.5">
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-slate-200">
          {etiqueta}
        </span>
        {nota && <span className="text-[11px] leading-snug text-slate-400">{nota}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`relative w-10 h-[22px] rounded-full transition-colors shrink-0 ${
          activo ? "bg-[#10b981]" : "bg-slate-700"
        }`}
      >
        <span
          className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white transition-transform ${
            activo ? "translate-x-[18px]" : ""
          }`}
        />
      </span>
    </button>
  );
}

/** Confirmación inline [SÍ][NO] para activaciones (coherencia D4). */
function ConfirmInline({
  pregunta,
  onSi,
  onNo,
}: {
  pregunta: string;
  onSi: () => void;
  onNo: () => void;
}) {
  return (
    <div className="mx-1 mb-2 rounded-xl border border-amber-400/50 bg-amber-400/10 px-3 py-2.5 flex flex-col gap-2">
      <p className="text-[11.5px] leading-snug text-amber-300 font-medium">{pregunta}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSi}
          autoFocus
          className="min-h-[36px] flex-1 rounded-lg bg-amber-400 hover:bg-amber-300 text-[#090d12] font-mono text-[10px] font-black uppercase tracking-wider transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
        >
          SÍ
        </button>
        <button
          type="button"
          onClick={onNo}
          className="min-h-[36px] flex-1 rounded-lg border border-slate-700 bg-slate-800/60 hover:border-slate-500 text-slate-300 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          NO
        </button>
      </div>
    </div>
  );
}

/** Trunca un UUID largo para mostrarlo: `a1b2c3d4…e5f6`. */
function truncarId(id: string): string {
  return id.length <= 14 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;
}

// ─── KIT e14-adaptacion-dispositivo-v1 (sección 8) ─────────────────────────

/** Chip de capacidad web: verde disponible, gris ausente (honesto). */
function ChipCap({ ok, label, title }: { ok: boolean; label: string; title: string }) {
  return (
    <span
      title={title}
      className={`font-mono text-[9px] font-black uppercase tracking-wider rounded px-1.5 py-0.5 border ${
        ok
          ? "border-[#10b981]/50 bg-[#10b981]/10 text-[#10b981]"
          : "border-slate-700 bg-slate-800/60 text-slate-500"
      }`}
    >
      {label}
    </span>
  );
}

/** Barra 0-100 de un sub-score (verde ≥70 · ámbar ≥40 · rojo <40 · — null). */
function BarraSubscore({ etiqueta, valor }: { etiqueta: string; valor: number | null }) {
  const color =
    valor === null
      ? "bg-slate-600"
      : valor >= 70
        ? "bg-[#10b981]"
        : valor >= 40
          ? "bg-amber-400"
          : "bg-[#ef4444]";
  return (
    <div className="flex items-center gap-2 min-h-[16px]">
      <span className="w-16 font-mono text-[9px] font-bold uppercase tracking-wider text-slate-400 shrink-0">
        {etiqueta}
      </span>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={valor ?? undefined}
        aria-label={`Puntuación ${etiqueta}`}
        className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden"
      >
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: valor === null ? "0%" : `${Math.max(2, valor)}%` }}
        />
      </div>
      <span className="w-8 text-right font-mono text-[10px] font-bold text-slate-300 tabular-nums">
        {valor === null ? "—" : valor}
      </span>
    </div>
  );
}

export function PanelDev({ onClose }: { onClose: () => void }) {
  const modoDev = useModoDev();
  const politica = usePolitica();
  const overrides = useOverridesFlags();

  // ── Sección 2 · salud ──────────────────────────────────────────────────
  // (hook C6: 30 s SOLO mientras el panel está abierto — el panel SOLO
  //  existe montado; al desmontar se limpia el timer. NUNCA timer global.)
  const { snapshot, refrescar: refrescarSalud } = useSaludVivo({ activo: true });
  const [armadoMuestreo, armarMuestreo, desarmarMuestreo] = useArmado();

  // ── Sección 3 · errores ────────────────────────────────────────────────
  const [eventosBuffer, setEventosBuffer] = useState(0);
  const [errores, setErrores] = useState<ErroresAgrupados[]>([]);
  const refrescarErrores = useCallback(async () => {
    try {
      setEventosBuffer(await contarEventos());
      setErrores(await eventosPorDigest());
    } catch {
      setEventosBuffer(0);
      setErrores([]);
    }
  }, []);
  useEffect(() => {
    void refrescarErrores();
  }, [refrescarErrores]);
  // KIT C5: modal hijo con el detalle completo (VistaErrores).
  const [detalleAbierto, setDetalleAbierto] = useState(false);

  // ── Sección 1 · estado (desactivar = flujo inverso del C1) ─────────────
  const [armadoDesactivar, armarDesactivar, desarmarDesactivar] = useArmado();

  // ── Sección 4 · privacidad (activar confirma — D4) ─────────────────────
  const [claveConfirmando, setClaveConfirmando] = useState<keyof PoliticaDatos | null>(null);
  useEffect(() => {
    if (!claveConfirmando) return;
    const t = window.setTimeout(() => setClaveConfirmando(null), ARMADO_MS);
    return () => window.clearTimeout(t);
  }, [claveConfirmando]);

  const alternarPolitica = (clave: keyof PoliticaDatos) => {
    if (politica[clave]) {
      // Apagar es inmediato (menos recolección — jamás se confirma).
      guardarPolitica({ ...politica, [clave]: false });
      return;
    }
    // Activar recolección nueva → confirmación inline (coherencia con D4).
    setClaveConfirmando(clave);
  };

  // ── Sección 5 · exportar ───────────────────────────────────────────────
  const [exportando, setExportando] = useState<null | "json">(null);
  const [listo, setListo] = useState<null | "json">(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [vaciarTrasExportar, setVaciarTrasExportar] = useState(true);
  const bufferVacio = eventosBuffer === 0;

  const motivoDeError = (err: unknown): string => {
    const crudo = err instanceof Error ? err.message : String(err);
    return (crudo.replace(/\s+/g, " ").trim().slice(0, 48) || "NO SE PUDO GENERAR").toUpperCase();
  };

  /** JSON = ReporteSesion del contrato (delegado a obs/export.ts — real). */
  const exportarJson = async () => {
    if (exportando || bufferVacio) return;
    setExportando("json");
    setListo(null);
    setMotivo(null);
    try {
      await descargarReporte("json", vaciarTrasExportar);
      setListo("json");
      window.setTimeout(() => setListo(null), 1500);
      void refrescarErrores();
    } catch (err) {
      setMotivo(motivoDeError(err));
    } finally {
      setExportando(null);
    }
  };

  // ── Sección 6 · kill switch (overrides MANUALES — D6) ──────────────────
  const toggleOverride = (clave: "ocrThreadsTope", activar: boolean) => {
    const siguiente = { ...overrides };
    if (activar) {
      siguiente.ocrThreadsTope = 2;
    } else {
      delete siguiente[clave];
    }
    guardarOverridesFlags(siguiente);
  };

  // ── Sección 7 · flags activas ──────────────────────────────────────────
  // Valor efectivo del contrato (defaults + overrides). Reacciona a cambios
  // del kill switch vía useOverridesFlags → evento del puente.
  const flags = useMemo(() => leerFlags(), [overrides]);
  const [resultadoFlags, setResultadoFlags] = useState<null | "ok" | "sin-endpoint" | "error">(
    null,
  );
  const refrescarFlagsAhora = useCallback(async () => {
    setResultadoFlags(await refrescarFlags());
  }, []);

  // ── Sección 8 · perfil del dispositivo (adaptación) ──────────────────
  // KIT e14-adaptacion-dispositivo-v1: perfil con benchmarks (una vez por
  // carga; REPETIR re-mide) + plan efectivo (reacciona al kill switch vía
  // overrides) + descarga del informe IA.
  const [perfil, setPerfil] = useState<PerfilDispositivo | null>(null);
  const [perfileando, setPerfileando] = useState(false);
  const pedirPerfil = useCallback(async (forzar: boolean) => {
    setPerfileando(true);
    try {
      setPerfil(await obtenerPerfilDispositivo(forzar));
    } catch {
      setPerfil(null); // null honesto — jamás romper el panel
    } finally {
      setPerfileando(false);
    }
  }, []);
  useEffect(() => {
    void pedirPerfil(false);
  }, [pedirPerfil]);
  const plan = useMemo(() => planAdaptativo(), [overrides]);
  const [exportandoIA, setExportandoIA] = useState(false);
  const [listoIA, setListoIA] = useState(false);
  const [motivoIA, setMotivoIA] = useState<string | null>(null);
  const exportarInformeIA = async () => {
    if (exportandoIA) return;
    setExportandoIA(true);
    setListoIA(false);
    setMotivoIA(null);
    try {
      await descargarInformeIA();
      setListoIA(true);
      window.setTimeout(() => setListoIA(false), 1500);
    } catch (err) {
      setMotivoIA(motivoDeError(err));
    } finally {
      setExportandoIA(false);
    }
  };

  // ── Overlay: Esc cierra + focus trap básico (convención AyudaOverlay) ──
  // Mientras el modal hijo (VistaErrores) está abierto, ESTE manejador se
  // retira — Esc/clic cierran SOLO el hijo (sin cascada).
  const refPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (detalleAbierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const raiz = refPanel.current;
      if (!raiz) return;
      const focables = raiz.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focables.length === 0) return;
      const primero = focables[0];
      const ultimo = focables[focables.length - 1];
      const activo = document.activeElement;
      if (e.shiftKey && (activo === primero || !(activo instanceof Node && raiz.contains(activo)))) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, detalleAbierto]);

  const politicaTexto = [
    `Metadatos: ${politica.metadatos ? "sí" : "no"}`,
    `OCR: ${politica.textoOcr ? "sí" : "no"}`,
    `Miniaturas: ${politica.miniaturas ? "sí" : "no"}`,
    `Salud: ${politica.saludEnVivo ? "sí" : "no"}`,
  ].join(" · ");

  const badgeTier = snapshot
    ? snapshot.tier === "ALTO"
      ? "bg-[#10b981]/15 border-[#10b981]/50 text-[#10b981]"
      : snapshot.tier === "MEDIO"
        ? "bg-amber-400/15 border-amber-400/50 text-amber-400"
        : "bg-[#ef4444]/15 border-[#ef4444]/50 text-[#ef4444]"
    : null;

  const idDisp = idDispositivo();
  const idSes = idSesion();

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Panel de modo desarrollador"
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
              Modo desarrollador
            </p>
            <h2 className="text-lg font-extrabold text-white mt-0.5">PANEL DEV</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="Cerrar panel de modo desarrollador"
            className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl border border-slate-700/70 bg-slate-800/60 hover:border-slate-500 text-slate-300 font-mono text-base flex items-center justify-center transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10b981]"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-7">
          {/* ── 1 · ESTADO ─────────────────────────────────────────────── */}
          <section aria-label="Estado" className="flex flex-col gap-1.5">
            <TituloSeccion n={1} titulo="Estado" />
            <div className="rounded-2xl border border-slate-800 bg-[#0b1117] px-3.5 py-2">
              <FilaDato etiqueta="Versión" valor={appVersion()} />
              <div className="border-t border-slate-800/70" />
              <div className="flex items-center justify-between gap-3 py-1.5">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">
                  Modo desarrollador
                </span>
                {modoDev ? (
                  armadoDesactivar ? (
                    <span className="font-mono text-[11px] font-bold text-[#10b981]">
                      ACTIVO — CONFIRMA ABAJO ↓
                    </span>
                  ) : (
                    <span className="font-mono text-[11px] font-bold text-[#10b981]">ACTIVO</span>
                  )
                ) : (
                  <span className="font-mono text-[11px] font-bold text-slate-400">OFF</span>
                )}
              </div>
              {armadoDesactivar && (
                <ConfirmInline
                  pregunta="¿Desactivar el modo desarrollador? Se apaga la recolección y se cierra el panel (el buffer se conserva)."
                  onSi={() => {
                    desarmarDesactivar();
                    guardarModoDev(false);
                    onClose();
                  }}
                  onNo={desarmarDesactivar}
                />
              )}
              {modoDev && !armadoDesactivar && (
                <button
                  type="button"
                  onClick={armarDesactivar}
                  className="mb-1.5 min-h-[36px] px-3 rounded-lg border border-slate-700 bg-slate-800/60 hover:border-[#ef4444]/60 hover:text-[#ef4444] text-slate-300 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ef4444]/60"
                >
                  DESACTIVAR MODO
                </button>
              )}
              <div className="border-t border-slate-800/70" />
              <FilaDato
                etiqueta="Dispositivo"
                valor={idDisp ? truncarId(idDisp) : "—"}
              />
              <div className="border-t border-slate-800/70" />
              <FilaDato etiqueta="Sesión" valor={idSes ? truncarId(idSes) : "—"} />
              <div className="border-t border-slate-800/70" />
              <FilaDato etiqueta="Política" valor={politicaTexto} />
            </div>
          </section>

          {/* ── 2 · SALUD DEL DISPOSITIVO ──────────────────────────────── */}
          <section aria-label="Salud del dispositivo" className="flex flex-col gap-2">
            <TituloSeccion
              n={2}
              titulo="Salud del dispositivo"
              hijo={
                <button
                  type="button"
                  onClick={() => void refrescarSalud()}
                  className="min-h-[32px] px-2.5 rounded-lg border border-slate-700 bg-slate-800/60 hover:border-[#10b981]/60 hover:text-[#10b981] text-slate-300 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10b981]/60"
                >
                  REFRESCAR
                </button>
              }
            />
            <div className="flex items-center gap-2 flex-wrap">
              {badgeTier ? (
                <span
                  className={`font-mono text-[10px] font-black uppercase tracking-wider rounded-md px-2 py-1 border ${badgeTier}`}
                >
                  TIER {snapshot?.tier}
                </span>
              ) : (
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider rounded-md px-2 py-1 border border-slate-700 bg-slate-800/60 text-slate-400">
                  TIER N/D
                </span>
              )}
              {snapshot?.tierInferido && (
                <span className="text-[10.5px] text-slate-400 font-mono">
                  tier inferido (sin deviceMemory — iOS)
                </span>
              )}
              {!snapshot && (
                <span className="text-[10.5px] text-slate-400 font-mono">
                  esperando el núcleo obs (FASE 1)
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["RAM", snapshot?.memoriaGB != null ? `${snapshot.memoriaGB} GB` : "—"],
                  ["Núcleos", snapshot ? `${snapshot.nucleos}` : "—"],
                  [
                    "Batería",
                    snapshot?.bateria.nivel != null
                      ? `${Math.round(snapshot.bateria.nivel * 100)}%${snapshot.bateria.cargando ? " ⚡" : ""}`
                      : "—",
                  ],
                  ["Red", snapshot?.red.tipo ?? "—"],
                  [
                    "Storage libre",
                    snapshot?.storageLibreMB != null ? `${Math.round(snapshot.storageLibreMB)} MB` : "—",
                  ],
                  [
                    "Memoria JS",
                    snapshot?.memoriaMB != null ? `${Math.round(snapshot.memoriaMB)} MB` : "—",
                  ],
                ] as const
              ).map(([k, v]) => (
                <div
                  key={k}
                  className="rounded-xl border border-slate-800 bg-[#0b1117] px-3 py-2 flex flex-col gap-0.5"
                >
                  <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    {k}
                  </span>
                  <span className="font-mono text-[13px] font-bold text-slate-200 tabular-nums">
                    {v}
                  </span>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-slate-800 bg-[#0b1117] py-1">
              <SwitchFila
                etiqueta="MUESTREO CADA 5 MIN"
                nota="Escribe muestras de salud en el buffer. Solo corre con el modo desarrollador activo."
                ariaLabel="Muestreo de salud cada 5 minutos"
                activo={politica.saludEnVivo}
                onAlternar={() => {
                  if (politica.saludEnVivo) {
                    detenerMuestreoSalud();
                    guardarPolitica({ ...politica, saludEnVivo: false });
                    return;
                  }
                  armarMuestreo();
                }}
              />
              {armadoMuestreo && (
                <ConfirmInline
                  pregunta="¿Activar el muestreo de salud cada 5 minutos?"
                  onSi={() => {
                    desarmarMuestreo();
                    guardarPolitica({ ...politica, saludEnVivo: true });
                    iniciarMuestreoSalud();
                  }}
                  onNo={desarmarMuestreo}
                />
              )}
            </div>
          </section>

          {/* ── 3 · REPORTES DE ERRORES ────────────────────────────────── */}
          <section aria-label="Reportes de errores" className="flex flex-col gap-2">
            <TituloSeccion
              n={3}
              titulo="Reportes de errores"
              hijo={
                <span className="flex items-center gap-1.5">
                  {eventosBuffer > 0 && (
                    <button
                      type="button"
                      onClick={() => setDetalleAbierto(true)}
                      className="min-h-[32px] px-2.5 rounded-lg border border-slate-700 bg-slate-800/60 hover:border-[#10b981]/60 hover:text-[#10b981] text-slate-300 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10b981]/60"
                    >
                      VER DETALLE
                    </button>
                  )}
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider rounded-md px-2 py-1 border border-slate-700 bg-slate-800/60 text-slate-300">
                    {eventosBuffer} EN BUFFER
                  </span>
                </span>
              }
            />
            <div className="rounded-2xl border border-slate-800 bg-[#0b1117] px-3.5 py-1.5">
              {errores.length === 0 ? (
                <p className="py-3 text-center font-mono text-[11px] text-slate-400">
                  SIN EVENTOS EN EL BUFFER
                </p>
              ) : (
                <ul>
                  {errores.slice(0, 10).map((e) => (
                    <li
                      key={e.digest}
                      className="flex items-center gap-2 py-2 border-b border-slate-800/60 last:border-0"
                    >
                      <span
                        aria-hidden="true"
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          e.severidad === "error" ? "bg-[#ef4444]" : "bg-amber-400"
                        }`}
                      />
                      <span className="font-mono text-[11px] text-slate-200 truncate min-w-0">
                        {e.tipo}: {e.mensaje}
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-slate-400 shrink-0 tabular-nums">
                        ×{e.veces}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* KIT e14-observabilidad-v1 (agente 2 · C5): modal hijo — errores
              agrupados con breadcrumbs + vaciar buffer armado. */}
          {detalleAbierto && (
            <VistaErrores
              onClose={() => setDetalleAbierto(false)}
              alVaciar={() => void refrescarErrores()}
            />
          )}

          {/* ── 4 · AJUSTES DE DATOS (PRIVACIDAD) ──────────────────────── */}
          <section aria-label="Ajustes de datos y privacidad" className="flex flex-col gap-2">
            <TituloSeccion n={4} titulo="Ajustes de datos (privacidad)" />
            <div className="rounded-2xl border border-slate-800 bg-[#0b1117] py-1">
              <SwitchFila
                etiqueta="METADATOS"
                nota="IDs hasheados, tiempos, scores y desenlaces del pipeline. Sin contenido de actas."
                ariaLabel="Recolectar metadatos"
                activo={politica.metadatos}
                onAlternar={() => alternarPolitica("metadatos")}
              />
              {claveConfirmando === "metadatos" && (
                <ConfirmInline
                  pregunta="¿Activar la recolección de metadatos?"
                  onSi={() => {
                    guardarPolitica({ ...politica, metadatos: true });
                    setClaveConfirmando(null);
                  }}
                  onNo={() => setClaveConfirmando(null)}
                />
              )}
              <SwitchFila
                etiqueta="TEXTO OCR"
                nota="Guarda el texto leído del acta en los reportes. Contenido potencialmente sensible — OFF por defecto."
                ariaLabel="Incluir texto OCR en los reportes"
                activo={politica.textoOcr}
                onAlternar={() => alternarPolitica("textoOcr")}
              />
              {claveConfirmando === "textoOcr" && (
                <ConfirmInline
                  pregunta="¿Activar el guardado del texto OCR? Incluye contenido de las actas."
                  onSi={() => {
                    guardarPolitica({ ...politica, textoOcr: true });
                    setClaveConfirmando(null);
                  }}
                  onNo={() => setClaveConfirmando(null)}
                />
              )}
              <SwitchFila
                etiqueta="MINIATURAS"
                nota="Adjunta miniaturas de las actas a los reportes. OFF por defecto."
                ariaLabel="Incluir miniaturas en los reportes"
                activo={politica.miniaturas}
                onAlternar={() => alternarPolitica("miniaturas")}
              />
              {claveConfirmando === "miniaturas" && (
                <ConfirmInline
                  pregunta="¿Activar miniaturas? Adjuntan imagen de las actas a los reportes."
                  onSi={() => {
                    guardarPolitica({ ...politica, miniaturas: true });
                    setClaveConfirmando(null);
                  }}
                  onNo={() => setClaveConfirmando(null)}
                />
              )}
              <SwitchFila
                etiqueta="SALUD EN VIVO"
                nota="Muestras periódicas de salud del dispositivo. Solo corre con el modo desarrollador activo."
                ariaLabel="Salud en vivo"
                activo={politica.saludEnVivo}
                onAlternar={() => alternarPolitica("saludEnVivo")}
              />
              {claveConfirmando === "saludEnVivo" && (
                <ConfirmInline
                  pregunta="¿Activar la salud en vivo? Solo corre mientras el modo desarrollador esté activo."
                  onSi={() => {
                    guardarPolitica({ ...politica, saludEnVivo: true });
                    iniciarMuestreoSalud();
                    setClaveConfirmando(null);
                  }}
                  onNo={() => setClaveConfirmando(null)}
                />
              )}
            </div>
          </section>

          {/* ── 5 · EXPORTAR ───────────────────────────────────────────── */}
          <section aria-label="Exportar" className="flex flex-col gap-2">
            <TituloSeccion n={5} titulo="Exportar" />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void exportarJson()}
                disabled={bufferVacio || exportando !== null}
                aria-label="Exportar reporte JSON"
                className="min-h-[44px] px-3 rounded-xl border border-[#10b981]/60 bg-[#10b981]/10 hover:bg-[#10b981]/20 text-[#10b981] font-mono text-[11px] font-black uppercase tracking-wider transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5"
              >
                {exportando === "json" ? "GENERANDO…" : listo === "json" ? "{} LISTO ✓" : "{} JSON"}
              </button>
            </div>
            <button
              type="button"
              role="checkbox"
              aria-checked={vaciarTrasExportar}
              aria-label="Vaciar buffer tras exportar"
              onClick={() => setVaciarTrasExportar((v) => !v)}
              className="w-full min-h-11 flex items-center justify-between gap-3 rounded-xl px-3 border border-slate-800 bg-[#0b1117] hover:border-slate-600 transition-colors text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10b981]/60"
            >
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-slate-200">
                VACIAR BUFFER TRAS EXPORTAR
              </span>
              <span
                aria-hidden="true"
                className={`w-10 h-[22px] rounded-full border transition-colors shrink-0 flex items-center px-[3px] ${
                  vaciarTrasExportar ? "bg-[#10b981]/25 border-[#10b981]/60" : "bg-slate-800 border-slate-700"
                }`}
              >
                <span
                  className={`w-3.5 h-3.5 rounded-full transition-transform ${
                    vaciarTrasExportar ? "translate-x-[18px] bg-[#10b981]" : "translate-x-0 bg-slate-500"
                  }`}
                />
              </span>
            </button>
            {bufferVacio && (
              <p
                role="note"
                className="rounded-xl border border-slate-800 bg-[#0b1117] px-3.5 py-2 font-mono text-[10.5px] font-bold uppercase tracking-wider text-slate-400"
              >
                BUFFER VACÍO ({eventosBuffer} EVENTOS) — NADA QUE EXPORTAR
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
          </section>

          {/* ── 6 · KILL SWITCH (OVERRIDES MANUALES) ───────────────────── */}
          <section aria-label="Kill switch de proceso" className="flex flex-col gap-2">
            <TituloSeccion n={6} titulo="Kill switch (overrides)" />
            <p className="rounded-xl border border-slate-800 bg-[#0b1117] px-3.5 py-2 text-[11.5px] leading-relaxed text-slate-400">
              Estos cambios de proceso los decides tú; la app nunca los hace sola.
            </p>
            <div className="rounded-2xl border border-slate-800 bg-[#0b1117] py-1">
              <SwitchFila
                etiqueta="OCR A 2 HILOS"
                nota="ocrThreadsTope 4 → 2: el OCR usa a lo sumo 2 hilos — equipos modestos respiren. (Override MANUAL — manda sobre el plan adaptativo.)"
                ariaLabel="Override: OCR a dos hilos"
                activo={overrides.ocrThreadsTope === 2}
                onAlternar={() => toggleOverride("ocrThreadsTope", overrides.ocrThreadsTope !== 2)}
              />
              {/* KIT e14-adaptacion-dispositivo-v1 — kill switch del plan:
                  el override MANUAL manda (D6); false = byte-idéntico a hoy. */}
              <SwitchFila
                etiqueta="ADAPTACIÓN AUTOMÁTICA"
                nota="El plan por gama ajusta knobs de RECURSOS (hilos OCR: BAJO 2 · MEDIO 3 · ALTO 6). Nunca reglas de negocio; tu override manual manda. OFF = comportamiento histórico."
                ariaLabel="Adaptación automática al dispositivo"
                activo={flags.adaptacionDispositivo}
                onAlternar={() =>
                  guardarOverridesFlags({
                    ...overrides,
                    adaptacionDispositivo: !flags.adaptacionDispositivo,
                  })
                }
              />
            </div>
          </section>

          {/* ── 7 · FLAGS ACTIVAS ──────────────────────────────────────── */}
          <section aria-label="Flags activas" className="flex flex-col gap-2">
            <TituloSeccion
              n={7}
              titulo="Flags activas"
              hijo={
                <button
                  type="button"
                  onClick={() => void refrescarFlagsAhora()}
                  className="min-h-[32px] px-2.5 rounded-lg border border-slate-700 bg-slate-800/60 hover:border-[#10b981]/60 hover:text-[#10b981] text-slate-300 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10b981]/60"
                >
                  REFRESCAR FLAGS
                </button>
              }
            />
            <div className="rounded-2xl border border-slate-800 bg-[#0b1117] px-3.5 py-1.5">
              {(
                [
                  [
                    "ocrThreadsTope",
                    `${flags.ocrThreadsTope}`,
                    overrides.ocrThreadsTope !== undefined,
                  ],
                  [
                    "telemetriaSalud",
                    flags.telemetriaSalud ? "on" : "off",
                    overrides.telemetriaSalud !== undefined,
                  ],
                  [
                    "endpointReportes",
                    flags.endpointReportes ?? "—",
                    overrides.endpointReportes !== undefined,
                  ],
                ] as const
              ).map(([clave, valor, conOverride]) => (
                <div
                  key={clave}
                  className="flex items-center justify-between gap-3 py-2 border-b border-slate-800/60 last:border-0"
                >
                  <span className="font-mono text-[11px] text-slate-400 truncate">{clave}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    {conOverride && (
                      <span className="font-mono text-[8.5px] font-black uppercase tracking-wider rounded px-1.5 py-0.5 border border-amber-400/50 bg-amber-400/10 text-amber-400">
                        override
                      </span>
                    )}
                    <span className="font-mono text-[11px] font-bold text-slate-200 tabular-nums">
                      {valor}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            {resultadoFlags && (
              <p
                role="status"
                aria-live="polite"
                className={`font-mono text-[10px] font-bold uppercase tracking-wider ${
                  resultadoFlags === "ok"
                    ? "text-[#10b981]"
                    : resultadoFlags === "sin-endpoint"
                      ? "text-slate-400"
                      : "text-[#ef4444]"
                }`}
              >
                {resultadoFlags === "ok"
                  ? "FLAGS ACTUALIZADAS ✓"
                  : resultadoFlags === "sin-endpoint"
                    ? "SIN ENDPOINT DE FLAGS (default null — D1)"
                    : "ERROR AL REFRESCAR FLAGS"}
              </p>
            )}
          </section>

          {/* ── 8 · PERFIL DEL DISPOSITIVO (ADAPTACIÓN) ────────────────── */}
          <section aria-label="Perfil del dispositivo y adaptación" className="flex flex-col gap-2">
            <TituloSeccion
              n={8}
              titulo="Perfil · adaptación"
              hijo={
                <button
                  type="button"
                  onClick={() => void pedirPerfil(true)}
                  disabled={perfileando}
                  className="min-h-[32px] px-2.5 rounded-lg border border-slate-700 bg-slate-800/60 hover:border-[#10b981]/60 hover:text-[#10b981] text-slate-300 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10b981]/60 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {perfileando ? "MIDIENDO…" : "REPETIR BENCH"}
                </button>
              }
            />
            {/* Tier + puntuación global */}
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`font-mono text-[10px] font-black uppercase tracking-wider rounded-md px-2 py-1 border ${
                  perfil?.tier === "ALTO"
                    ? "bg-[#10b981]/15 border-[#10b981]/50 text-[#10b981]"
                    : perfil?.tier === "MEDIO"
                      ? "bg-amber-400/15 border-amber-400/50 text-amber-400"
                      : perfil?.tier === "BAJO"
                        ? "bg-[#ef4444]/15 border-[#ef4444]/50 text-[#ef4444]"
                        : "border-slate-700 bg-slate-800/60 text-slate-400"
                }`}
              >
                {perfil ? `TIER ${perfil.tier}` : "TIER N/D"}
              </span>
              {perfil && (
                <span className="font-mono text-[10px] text-slate-300 tabular-nums">
                  puntuación{" "}
                  <b className="text-slate-100">{perfil.puntuacion.global ?? "—"}</b>/100
                </span>
              )}
              {perfil?.tierInferido && (
                <span className="text-[10.5px] text-slate-400 font-mono">
                  tier inferido (sin deviceMemory — iOS)
                </span>
              )}
            </div>
            {/* Capacidades web (SIMD/multihilo = aceleradores del OCR) */}
            <div className="flex items-center gap-1.5 flex-wrap" role="list" aria-label="Capacidades web">
              <ChipCap
                ok={perfil?.capacidades.wasmSimd ?? false}
                label="SIMD"
                title="WASM SIMD — acelera el OCR ~2×. Ausente: actualizar el navegador."
              />
              <ChipCap
                ok={perfil?.capacidades.hilosWasm ?? false}
                label="HILOS"
                title="SharedArrayBuffer + COOP/COEP — habilita el OCR multihilo (sin esto corre a 1 hilo)."
              />
              <ChipCap
                ok={perfil?.capacidades.webgpu ?? false}
                label="WEBGPU"
                title="WebGPU — futuro acelerador de inferencia (hoy el motor usa WASM)."
              />
              <ChipCap
                ok={perfil?.capacidades.offscreenCanvas ?? false}
                label="OFFSCREEN"
                title="OffscreenCanvas — candidato futuro para pre-procesado fuera del main thread."
              />
              <ChipCap
                ok={perfil?.capacidades.serviceWorker ?? false}
                label="PWA"
                title="Service Worker — modo offline y cache de modelos OCR."
              />
            </div>
            {/* Sub-scores 0-100 (null = el navegador no da el dato) */}
            <div className="rounded-2xl border border-slate-800 bg-[#0b1117] px-3.5 py-3 flex flex-col gap-1.5">
              <BarraSubscore etiqueta="CPU" valor={perfil?.puntuacion.desglose.cpu ?? null} />
              <BarraSubscore etiqueta="RAM" valor={perfil?.puntuacion.desglose.ram ?? null} />
              <BarraSubscore etiqueta="GPU" valor={perfil?.puntuacion.desglose.gpu ?? null} />
              <BarraSubscore etiqueta="Red" valor={perfil?.puntuacion.desglose.red ?? null} />
              <BarraSubscore etiqueta="Storage" valor={perfil?.puntuacion.desglose.storage ?? null} />
              {perfil && (
                <p className="text-[10px] leading-snug text-slate-500 font-mono pt-0.5">
                  {perfil.puntuacion.nota}
                </p>
              )}
            </div>
            {/* Plan aplicado (knobs de recursos — auditoría honesta) */}
            <div className="rounded-2xl border border-slate-800 bg-[#0b1117] px-3.5 py-2">
              <FilaDato
                etiqueta="Hilos OCR"
                valor={`${plan.ocrHilos} (${plan.ocrHilosFuente}${plan.hilosWasmDisponibles ? "" : " · sin SAB ⇒ 1 hilo"})`}
              />
              <div className="border-t border-slate-800/70" />
              <FilaDato
                etiqueta="Adaptación"
                valor={plan.adaptado ? "ON (plan por gama)" : "OFF (histórico)"}
              />
              <div className="border-t border-slate-800/70" />
              <FilaDato
                etiqueta="GPU"
                valor={perfil?.gpu.renderer ?? "—"}
              />
              <div className="border-t border-slate-800/70" />
              <FilaDato
                etiqueta="Cámaras"
                valor={perfil?.camaras != null ? `${perfil.camaras}` : "—"}
              />
            </div>
            {/* Descarga del INFORME IA (petición del dueño — JSON auto-descrito) */}
            <button
              type="button"
              onClick={() => void exportarInformeIA()}
              disabled={exportandoIA}
              aria-label="Descargar informe del dispositivo para IA"
              className="min-h-[44px] px-3 rounded-xl border border-[#10b981]/60 bg-[#10b981]/10 hover:bg-[#10b981]/20 text-[#10b981] font-mono text-[11px] font-black uppercase tracking-wider transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5"
            >
              {exportandoIA
                ? "GENERANDO…"
                : listoIA
                  ? "INFORME LISTO ✓"
                  : "⬇ INFORME PARA IA (JSON)"}
            </button>
            <p className="text-[10.5px] leading-snug text-slate-500">
              JSON auto-descriptivo con hardware, GPU, capacidades, benchmarks, plan aplicado y
              recomendaciones — una IA lo interpreta sin contexto del repo. Solo metadatos: sin
              actas ni contenido OCR.
            </p>
            {motivoIA && (
              <p
                role="alert"
                className="rounded-xl border border-amber-400/60 bg-amber-400/10 px-3.5 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-amber-400"
              >
                {motivoIA}
              </p>
            )}
          </section>

          {/* ── 9 · RASTREO DE TIEMPOS (KIT e14-rastreo-tiempos-v1) ───── */}
          <SeccionRastreo />

          <p className="text-center font-mono text-[9.5px] text-slate-400 pb-1">
            Nada sale del dispositivo sin que lo exportes manualmente (D1)
          </p>
        </div>
      </div>
    </div>
  );
}
