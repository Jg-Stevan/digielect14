"use client";

/**
 * PanelDev — panel del modo de diagnóstico (KIT e14-observabilidad-v1,
 * agente 2 · C4). La puerta de entrada visual a TODA la observabilidad.
 *
 * Convención de overlay COPIADA de AyudaOverlay.tsx (fixed inset-0 z-[70],
 * clic-fuera cierra, Esc cierra, role="dialog" aria-modal) + focus trap
 * básico. SOLO accesible desde la tuerca (sin ruta ni query param).
 *
 * Secciones (orden del kit C4):
 *  1 · Estado (versión, modo, identidad truncada, política en texto)
 *  2 · Salud del dispositivo (snapshot + refrescar + muestreo cada 5 min)
 *  3 · Reportes de errores (contador + top-10 por digest; detalle → C5)
 *  4 · Ajustes de datos (4 toggles de PoliticaDatos — activar confirma, D4)
 *  5 · Exportar (ZIP migrado de ResumenView en C3 + JSON; vaciar buffer)
 *  6 · Kill switch (overrides MANUALES de flags — D6: la app nunca sola)
 *  7 · Flags activas (valor efectivo + refrescar)
 *
 * FASE 1: datos REALES vía dev/puente.ts → obs/* (buffer IDB, salud,
 * identidad, export) + lib/e14/flags.ts — el núcleo ya existe y el puente
 * delega; consumidores y JSX sin cambios.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  appVersion,
  contarEventos,
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
  purgarBuffer,
  refrescarFlags,
  useModoDev,
  useOverridesFlags,
  usePolitica,
} from "./puente";
import type { ErroresAgrupados, PoliticaDatos } from "@/lib/e14/obs/tipos";
// KIT e14-observabilidad-v1 (agente 2 · C5): detalle de errores + breadcrumbs.
import { VistaErrores } from "./VistaErrores";
// KIT e14-observabilidad-v1 (agente 2 · C6): salud en vivo (30 s, solo panel abierto).
import { useSaludVivo } from "./useSaludVivo";

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
      <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
        {n} · {titulo}
      </h3>
      {hijo}
    </div>
  );
}

function FilaDato({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 shrink-0">
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
        {nota && <span className="text-[11px] leading-snug text-slate-500">{nota}</span>}
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
  const [exportando, setExportando] = useState<null | "zip" | "json">(null);
  const [listo, setListo] = useState<null | "zip" | "json">(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [vaciarTrasExportar, setVaciarTrasExportar] = useState(true);
  const bufferVacio = eventosBuffer === 0;
  // WAVE3 §A.4 — válvula de pruebas del dueño (ledger remoto D1): doble
  // confirmación en UI (patrón «reiniciar jornada» — armado 4 s). NUNCA
  // automática: ni vaciar local ni el reset del modo de pruebas borran el
  // remoto (literal evitado a propósito — ancla byte-idéntica del kit §1).
  const [armadoLedger, setArmadoLedger] = useState(false);
  const [resultadoLedger, setResultadoLedger] = useState<string | null>(null);

  const vaciarLedger = async () => {
    setResultadoLedger(null);
    try {
      const { vaciarLedgerRemoto } = await import("@/lib/e14/masiva/ledger-remoto");
      const r = await vaciarLedgerRemoto();
      setResultadoLedger(r.ok ? "LEDGER REMOTO VACIADO ✓" : `NO SE PUDO: ${r.error ?? "?"}`);
    } catch {
      setResultadoLedger("NO SE PUDO VACIAR EL LEDGER REMOTO");
    }
  };

  const motivoDeError = (err: unknown): string => {
    const crudo = err instanceof Error ? err.message : String(err);
    return (crudo.replace(/\s+/g, " ").trim().slice(0, 48) || "NO SE PUDO GENERAR").toUpperCase();
  };

  /** Flujo ZIP MIGRADO de ResumenView (C3 → C4): lazy import
   *  generarInformeZip + downloadBlob, chequeo de cola vacía y mensajes. */
  const exportarZip = async () => {
    if (exportando || bufferVacio) return;
    setExportando("zip");
    setListo(null);
    setMotivo(null);
    try {
      const [{ generarInformeZip }, { downloadBlob }, { contarRegistros }] = await Promise.all([
        import("@/lib/e14/informe"),
        import("@jg-stevan/scanner-core/pdf-export"),
        import("@/lib/e14/masiva/cola"),
      ]);
      // Chequeo de cola vacía del flujo original (kit C3: NO se pierde).
      if ((await contarRegistros()) === 0) {
        setMotivo("COLA MASIVA VACÍA — NADA QUE EMPAQUETAR");
        return;
      }
      const { blob, nombre } = await generarInformeZip();
      downloadBlob(blob, nombre);
      if (vaciarTrasExportar) await purgarBuffer();
      setListo("zip");
      window.setTimeout(() => setListo(null), 1500);
      void refrescarErrores();
    } catch (err) {
      setMotivo(motivoDeError(err));
    } finally {
      setExportando(null);
    }
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
  const toggleOverride = (
    clave: "poolWorkers" | "thumbsOn" | "ocrThreadsTope",
    activar: boolean,
  ) => {
    const siguiente = { ...overrides };
    if (activar) {
      if (clave === "poolWorkers") siguiente.poolWorkers = 1;
      if (clave === "thumbsOn") siguiente.thumbsOn = false;
      if (clave === "ocrThreadsTope") siguiente.ocrThreadsTope = 2;
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
      aria-label="Panel de modo de diagnóstico"
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
              Modo de diagnóstico
            </p>
            <h2 className="text-lg font-extrabold text-white mt-0.5">PANEL DEV</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="Cerrar panel de diagnóstico"
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
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 shrink-0">
                  Modo diagnóstico
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
                  pregunta="¿Desactivar el modo de diagnóstico? Se apaga la recolección y se cierra el panel (el buffer se conserva)."
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
                <span className="text-[10.5px] text-slate-500 font-mono">
                  tier inferido (sin deviceMemory — iOS)
                </span>
              )}
              {!snapshot && (
                <span className="text-[10.5px] text-slate-500 font-mono">
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
                  <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-slate-500">
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
                nota="Escribe muestras de salud en el buffer. Solo corre con el modo diagnóstico activo."
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
                <p className="py-3 text-center font-mono text-[11px] text-slate-500">
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
                      <span className="ml-auto font-mono text-[10px] text-slate-500 shrink-0 tabular-nums">
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
                nota="Muestras periódicas de salud del dispositivo. Solo corre con el modo diagnóstico activo."
                ariaLabel="Salud en vivo"
                activo={politica.saludEnVivo}
                onAlternar={() => alternarPolitica("saludEnVivo")}
              />
              {claveConfirmando === "saludEnVivo" && (
                <ConfirmInline
                  pregunta="¿Activar la salud en vivo? Solo corre mientras el modo diagnóstico esté activo."
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
                onClick={() => void exportarZip()}
                disabled={bufferVacio || exportando !== null}
                aria-label="Exportar informe ZIP"
                className="min-h-[44px] px-3 rounded-xl bg-[#10b981] hover:bg-[#059669] text-[#090d12] font-mono text-[11px] font-black uppercase tracking-wider shadow-lg shadow-[#10b981]/20 transition-all active:scale-[0.98] disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5"
              >
                {exportando === "zip" ? "GENERANDO…" : listo === "zip" ? "↓ LISTO ✓" : "↓ ZIP"}
              </button>
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
            {/* WAVE3 §A.4 — válvula de pruebas del dueño (ledger remoto D1):
                doble confirmación en UI (primer toque arma 4 s, segundo
                ejecuta). NUNCA automática — kit §A.4 literal. */}
            <button
              type="button"
              aria-label="Vaciar ledger remoto (pruebas) — requiere doble confirmación"
              onClick={() => {
                if (!armadoLedger) {
                  setArmadoLedger(true);
                  window.setTimeout(() => setArmadoLedger(false), ARMADO_MS);
                  return;
                }
                setArmadoLedger(false);
                void vaciarLedger();
              }}
              className={`w-full min-h-11 rounded-xl px-3 border font-mono text-[11px] font-black uppercase tracking-wider transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ef4444]/60 ${
                armadoLedger
                  ? "border-[#ef4444] bg-[#ef4444]/20 text-[#ef4444]"
                  : "border-[#ef4444]/50 bg-[#ef4444]/10 hover:bg-[#ef4444]/20 text-[#ef4444]"
              }`}
            >
              {armadoLedger
                ? "¿SEGURO? TOCA DE NUEVO — BORRA EL LEDGER REMOTO (D1)"
                : "VACIAR LEDGER REMOTO (PRUEBAS)"}
            </button>
            {resultadoLedger && (
              <p
                role="status"
                aria-live="polite"
                className="rounded-xl border border-slate-800 bg-[#0b1117] px-3.5 py-2 font-mono text-[10.5px] font-bold uppercase tracking-wider text-slate-300"
              >
                {resultadoLedger}
              </p>
            )}
            {bufferVacio && (
              <p
                role="note"
                className="rounded-xl border border-slate-800 bg-[#0b1117] px-3.5 py-2 font-mono text-[10.5px] font-bold uppercase tracking-wider text-slate-400"
              >
                BUFFER VACÍO ({eventosBuffer} EVENTOS) — NADA QUE EXPORTAR
              </p>
            )}
            {exportando === "zip" && (
              <p
                role="status"
                aria-live="polite"
                className="inline-block self-center rounded-full border border-slate-800 bg-[#0b1117] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-300"
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
          </section>

          {/* ── 6 · KILL SWITCH (OVERRIDES MANUALES) ───────────────────── */}
          <section aria-label="Kill switch de proceso" className="flex flex-col gap-2">
            <TituloSeccion n={6} titulo="Kill switch (overrides)" />
            <p className="rounded-xl border border-slate-800 bg-[#0b1117] px-3.5 py-2 text-[11.5px] leading-relaxed text-slate-400">
              Estos cambios de proceso los decides tú; la app nunca los hace sola.
            </p>
            <div className="rounded-2xl border border-slate-800 bg-[#0b1117] py-1">
              <SwitchFila
                etiqueta="UN SOLO WORKER"
                nota="poolWorkers 2 → 1: la cola masiva procesa de a una — menos RAM, menos velocidad."
                ariaLabel="Override: un solo worker"
                activo={overrides.poolWorkers === 1}
                onAlternar={() => toggleOverride("poolWorkers", overrides.poolWorkers !== 1)}
              />
              <SwitchFila
                etiqueta="MINIATURAS APAGADAS"
                nota="thumbsOn on → off: la bandeja deja de generar miniaturas — menos memoria."
                ariaLabel="Override: miniaturas apagadas"
                activo={overrides.thumbsOn === false}
                onAlternar={() => toggleOverride("thumbsOn", overrides.thumbsOn !== false)}
              />
              <SwitchFila
                etiqueta="OCR A 2 HILOS"
                nota="ocrThreadsTope 4 → 2: el OCR usa a lo sumo 2 hilos — equipos modestos respiren."
                ariaLabel="Override: OCR a dos hilos"
                activo={overrides.ocrThreadsTope === 2}
                onAlternar={() => toggleOverride("ocrThreadsTope", overrides.ocrThreadsTope !== 2)}
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
                  ["poolWorkers", `${flags.poolWorkers}`, overrides.poolWorkers !== undefined],
                  ["thumbsOn", flags.thumbsOn ? "on" : "off", overrides.thumbsOn !== undefined],
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

          <p className="text-center font-mono text-[9.5px] text-slate-600 pb-1">
            Nada sale del dispositivo sin que lo exportes manualmente (D1)
          </p>
        </div>
      </div>
    </div>
  );
}
