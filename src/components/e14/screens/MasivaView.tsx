"use client";

/**
 * KIT e14-carga-masiva-v1 (T4): vista MASIVA — desktop-first, UNA vista con
 * todo adentro (kit §6). Sueltas/seleccionas N fotos → cola persistente
 * (IndexedDB) → runner secuencial con el MISMO pipeline real de siempre →
 * bandeja de resultados con estados, envío automático de ÓPTIMAS y
 * revisión/humanización del resto (ABRIR → REVISIÓN intacta).
 * Copy corto del repo (mono, uppercase, sin guías — D1/gate-v2). Sin toasts
 * (redesign-stitch D2): píldoras/banner. Listas largas: max-h + overflow-y-auto.
 */
import { useEffect, useRef, useState } from "react";
import { useE14Store } from "@/lib/e14/store";
import {
  refrescarEnviosTrasDrenaje,
  useMasivaStore,
  type FiltroMasiva,
} from "@/lib/e14/masiva/store";
import type { FilaMasiva } from "@/lib/e14/masiva/tipos";
import { StitchStackIcon } from "../icons";

/** Píldora de estado de una fila — paleta de estado del repo
 *  (ReviewView L222-225: verde/ámbar/rojo, mono uppercase). */
function pildoraDe(f: FilaMasiva): { label: string; clases: string } {
  switch (f.estado) {
    case "PENDIENTE":
      return { label: "PENDIENTE", clases: "border-brand-borderdim text-gray-400" };
    case "PROCESANDO":
      return { label: "PROCESANDO", clases: "border-brand-borderdim text-gray-200 bg-white/5" };
    case "ERROR":
      return { label: "ERROR", clases: "border-red-500/60 text-red-400 bg-red-500/10" };
    case "LISTA": {
      const s = f.statusActa;
      if (s === "ENVIADA") {
        // KIT e14-masiva-ux-v1 (T3.3): la fila DISTINGUE envío real vs en
        // cola por offline, y auto vs manual. Paleta de estado del repo.
        if (f.envioEnCola)
          return { label: "EN COLA", clases: "border-amber-400/60 text-amber-400 bg-amber-400/10" };
        return f.enviadaAuto
          ? { label: "ENVIADA AUTO", clases: "border-brand-green/60 text-brand-green bg-brand-green/10" }
          : { label: "ENVIADA", clases: "border-brand-green/60 text-brand-green bg-brand-green/10" };
      }
      if (s === "OPTIMA")
        return { label: "ÓPTIMA", clases: "border-brand-green/60 text-brand-green" };
      if (s === "ADVERTENCIA")
        return { label: "ADVERTENCIA", clases: "border-amber-400/60 text-amber-400 bg-amber-400/10" };
      if (s === "RECHAZADA")
        return { label: "RECHAZADA", clases: "border-red-500/60 text-red-400 bg-red-500/10" };
      if (s === "EN_REVISION_HUMANA")
        return { label: "REVISIÓN HUMANA", clases: "border-amber-400/60 text-amber-400" };
      return { label: "LISTA", clases: "border-brand-borderdim text-gray-400" };
    }
  }
}

const FILTROS: { valor: FiltroMasiva; label: string }[] = [
  { valor: "TODAS", label: "TODAS" },
  { valor: "OPTIMA", label: "ÓPTIMA" },
  { valor: "ADVERTENCIA", label: "ADVERTENCIA" },
  { valor: "RECHAZADA", label: "RECHAZADA" },
  { valor: "EN_REVISION_HUMANA", label: "EN RH" },
  { valor: "ERROR", label: "ERROR" },
];

export function MasivaView() {
  const filas = useMasivaStore((s) => s.filas);
  const corriendo = useMasivaStore((s) => s.corriendo);
  const progreso = useMasivaStore((s) => s.progreso);
  const filtro = useMasivaStore((s) => s.filtro);
  const guardando = useMasivaStore((s) => s.guardando);
  const colaDisponible = useMasivaStore((s) => s.colaDisponible);
  const {
    cargarFilas,
    sincronizarAlVolver,
    agregarFiles,
    iniciar,
    pausar,
    abrirActa,
    quitar,
    vaciar,
    enviarLote,
    setFiltro,
  } = useMasivaStore.getState();

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActivo, setDragActivo] = useState(false);
  const [vaciarArmado, setVaciarArmado] = useState(false);

  // Al montar: cargarFilas() (incluye recuperarCola — zombis fuera) +
  // sincronizarAlVolver() al regresar de REVISIÓN (kit §6). Acciones de
  // zustand estables → deps correctas.
  useEffect(() => {
    void cargarFilas().then(() => sincronizarAlVolver());
  }, [cargarFilas, sincronizarAlVolver]);

  // Confirmación inline de 2 toques — se desarma sola (kit §6, sin window.confirm).
  useEffect(() => {
    if (!vaciarArmado) return;
    const t = window.setTimeout(() => setVaciarArmado(false), 3000);
    return () => window.clearTimeout(t);
  }, [vaciarArmado]);

  // KIT e14-masiva-ux-v1 (T3.2): reconciliar filas «EN COLA» contra la
  // conexión actual — tanto al montar (el toggle pudo usarse en REVISIÓN o
  // la app recargarse: online=true + hashSha256 "EN COLA" ⇒ el drenaje ya
  // ocurrió en el store principal, la fila solo pinta tarde) como en el
  // toggle offline→online con la vista viva. Idempotente (solo toca filas
  // con hashSha256 === "EN COLA" que sigan así en IDB).
  const online = useE14Store((s) => s.online);
  useEffect(() => {
    if (online) void refrescarEnviosTrasDrenaje();
  }, [online]);

  const pendientes = filas.filter((f) => f.estado === "PENDIENTE").length;
  const terminadas = filas.filter((f) => f.estado === "LISTA" || f.estado === "ERROR").length;
  const advertenciasPend = filas.filter(
    (f) => f.estado === "LISTA" && f.statusActa === "ADVERTENCIA",
  ).length;
  const hayCola = filas.length > 0;

  // KIT e14-masiva-ux-v1 (T3.4): conteos del encabezado del lote — el dueño
  // ve de un vistazo si «se pudo enviar» y qué queda pendiente.
  const enviadas = filas.filter(
    (f) => f.estado === "LISTA" && f.statusActa === "ENVIADA" && !f.envioEnCola,
  ).length;
  const enCola = filas.filter(
    (f) => f.estado === "LISTA" && f.statusActa === "ENVIADA" && f.envioEnCola,
  ).length;
  const errores = filas.filter((f) => f.estado === "ERROR").length;

  const visibles =
    filtro === "TODAS"
      ? filas
      : filas.filter((f) =>
          filtro === "ERROR" ? f.estado === "ERROR" : f.statusActa === filtro,
        );

  const activa = progreso ? filas.find((f) => f.id === progreso.id) : null;
  const filaActiva = activa && activa.estado === "PROCESANDO" ? activa : null;

  return (
    <section
      className="flex-1 min-h-0 overflow-y-auto bg-brand-black"
      aria-label="MASIVA — carga masiva de actas"
    >
      <div className="w-full max-w-md md:max-w-3xl mx-auto px-4 py-4 flex flex-col gap-4">
        {/* ---------- HEADER ---------- */}
        <header className="flex flex-wrap items-center gap-3 justify-between">
          <div className="min-w-0">
            <h1 className="font-mono text-lg font-extrabold tracking-wider text-white uppercase flex items-center gap-2">
              <StitchStackIcon className="w-5 h-5 text-brand-green" />
              MASIVA
            </h1>
            <p className="font-mono text-[10px] tracking-wider text-gray-400 uppercase">
              MISMO PIPELINE — UNA FOTO A LA VEZ
            </p>
          </div>
          <div className="flex items-center gap-2">
            {corriendo ? (
              <button
                type="button"
                onClick={pausar}
                aria-label="Pausar la cola"
                className="min-h-[44px] px-4 rounded-xl border border-brand-border bg-brand-surface text-gray-200 font-mono text-[11px] font-bold uppercase tracking-wider hover:border-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60"
              >
                PAUSAR
              </button>
            ) : (
              <button
                type="button"
                onClick={iniciar}
                disabled={!colaDisponible || pendientes === 0}
                aria-label="Procesar la cola"
                className="min-h-[44px] px-4 rounded-xl bg-brand-green text-black font-mono text-[11px] font-extrabold uppercase tracking-wider shadow-[0_0_10px_rgba(0,230,118,0.2)] hover:brightness-110 disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60"
              >
                PROCESAR
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (!vaciarArmado) {
                  setVaciarArmado(true);
                  return;
                }
                setVaciarArmado(false);
                void vaciar();
              }}
              disabled={!hayCola || corriendo}
              aria-label={
                vaciarArmado ? "Confirmar vaciar toda la cola" : "Vaciar toda la cola"
              }
              className={`min-h-[44px] px-4 rounded-xl border font-mono text-[11px] font-bold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60 ${
                vaciarArmado
                  ? "border-red-500 text-red-400 bg-red-500/10"
                  : "border-brand-border bg-brand-surface text-gray-300 hover:border-gray-500"
              }`}
            >
              {vaciarArmado ? "¿SEGURO? VACIAR" : "VACIAR"}
            </button>
          </div>
        </header>

        {/* ---------- FALLBACK IDB (kit §3/§6) ---------- */}
        {!colaDisponible && (
          <p
            role="alert"
            className="rounded-xl border border-amber-400/60 bg-amber-400/10 px-3.5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-amber-400"
          >
            TU NAVEGADOR NO SOPORTA LA COLA — IMPORTA DE A UNA EN ESCANEAR
          </p>
        )}

        {/* ---------- ZONA DE CARGA (input + drag & drop) ---------- */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActivo(true);
          }}
          onDragLeave={() => setDragActivo(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActivo(false);
            void agregarFiles(Array.from(e.dataTransfer.files));
          }}
          className={`rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
            dragActivo
              ? "border-brand-green bg-brand-green/10"
              : "border-brand-border bg-brand-surface/60"
          }`}
        >
          <input
            ref={inputRef}
            id="masiva-archivos"
            type="file"
            multiple
            // KIT e14-masiva-ux-v1 (T2.5): imágenes + HEIC/HEIF + comprimidos.
            // El filtro REAL vive en el store (pareceImagenMasiva + extraerArchivo).
            accept="image/*,.heic,.heif,.zip,.rar"
            className="sr-only"
            onChange={(e) => {
              void agregarFiles(Array.from(e.target.files ?? []));
              e.target.value = ""; // re-soltar el MISMO archivo funciona
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-label="Elegir fotos de actas para la cola"
            className="min-h-[44px] inline-flex items-center gap-2 px-4 rounded-xl bg-brand-greendark/60 border border-brand-green/60 font-mono text-[11px] font-bold uppercase tracking-wider text-brand-green hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
          >
            <StitchStackIcon className="w-4 h-4" />
            ELEGIR FOTOS
          </button>
          <p className="mt-2 font-mono text-[10px] tracking-wider text-gray-500 uppercase">
            {filas.length === 0
              ? "SUELTA FOTOS DE ACTAS AQUÍ"
              : "SUELTA MÁS FOTOS AQUÍ — SE SUMAN A LA COLA"}
          </p>
          {guardando > 0 && (
            <p
              className="mt-2 inline-block rounded-full border border-brand-borderdim px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-gray-300"
              role="status"
              aria-live="polite"
            >
              GUARDANDO {guardando}…
            </p>
          )}
        </div>

        {/* ---------- BARRA DE PROGRESO DEL LOTE ---------- */}
        {hayCola && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-brand-surfacelight border border-brand-border px-3 py-2">
            <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-gray-300 truncate">
              PROCESANDO {terminadas}/{filas.length}
              {filaActiva && progreso && (
                <span className="text-gray-500 font-medium">
                  {" "}
                  — {filaActiva.nombre} · {progreso.etapa}{" "}
                  {Math.round(progreso.fraccion * 100)}%
                </span>
              )}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500 shrink-0">
              {corriendo ? "COLA ACTIVA" : pendientes > 0 ? `${pendientes} EN COLA` : "COLA QUIETA"}
            </p>
          </div>
        )}

        {/* KIT e14-masiva-ux-v1 (T2.4): mismo aviso que ScanView (F-HEIC) —
            solo cuando la fila en curso sea HEIC/HEIF (el decode corre dentro
            del pipeline, fileToCaptureDataUrl del core). Sin toasts (D2). */}
        {filaActiva && /\.(heic|heif)$/i.test(filaActiva.nombre) && (
          <p
            role="status"
            aria-live="polite"
            className="rounded-xl border border-amber-400/60 bg-amber-400/10 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-400"
          >
            CONVIRTIENDO HEIC… LA CONVERSIÓN PUEDE TARDAR UNOS SEGUNDOS
          </p>
        )}

        {/* ---------- BANDEJA: FILTROS + LOTE ---------- */}
        {hayCola && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por estado">
            {FILTROS.map(({ valor, label }) => (
              <button
                key={valor}
                type="button"
                onClick={() => setFiltro(valor)}
                aria-pressed={filtro === valor}
                className={`min-h-[32px] px-2.5 py-1 rounded-full border font-mono text-[10px] font-bold uppercase tracking-wider focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60 ${
                  filtro === valor
                    ? "border-brand-green text-brand-green bg-brand-green/10"
                    : "border-brand-border text-gray-400 hover:text-gray-200"
                }`}
              >
                {label}
              </button>
            ))}
            {/* KIT e14-masiva-ux-v1 (T3.4): conteos del lote — mismo estilo
                que los filtros (texto pequeño mono uppercase). */}
            <span
              className="font-mono text-[10px] uppercase tracking-wider text-gray-500"
              aria-label={`Conteos: ${enviadas} enviadas, ${enCola} en cola, ${pendientes} pendientes, ${errores} errores`}
            >
              ENVIADAS {enviadas} · EN COLA {enCola} · PENDIENTES {pendientes} · ERRORES {errores}
            </span>
            {advertenciasPend > 0 && !corriendo && (
              <button
                type="button"
                onClick={() => void enviarLote("ADVERTENCIA")}
                aria-label={`Enviar ${advertenciasPend} actas con advertencia`}
                className="ml-auto min-h-[36px] px-3 rounded-full border border-amber-400/60 text-amber-400 bg-amber-400/10 font-mono text-[10px] font-bold uppercase tracking-wider hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60"
              >
                ENVIAR ADVERTENCIAS ({advertenciasPend})
              </button>
            )}
          </div>
        )}

        {/* ---------- BANDEJA: FILAS ---------- */}
        {hayCola && (
          <ul className="flex flex-col gap-2 max-h-96 overflow-y-auto pr-1" aria-label="Bandeja de resultados">
            {visibles.map((f) => {
              const pildora = pildoraDe(f);
              const esActiva = progreso?.id === f.id && f.estado === "PROCESANDO";
              return (
                <li
                  key={f.id}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 bg-brand-surface ${
                    esActiva ? "border-brand-green/60 ring-1 ring-brand-green/60" : "border-brand-border"
                  }`}
                >
                  {/* Thumb 40px (o cuadrado pendiente) */}
                  {f.thumb ? (
                    <img
                      src={f.thumb}
                      alt={`Miniatura de ${f.nombre}`}
                      className="w-10 h-10 rounded-lg object-cover bg-black/40 border border-brand-borderdim shrink-0"
                    />
                  ) : (
                    <div
                      aria-hidden
                      className="w-10 h-10 rounded-lg bg-black/40 border border-brand-borderdim flex items-center justify-center text-gray-600 shrink-0"
                    >
                      <StitchStackIcon className="w-4 h-4" />
                    </div>
                  )}

                  {/* Nombre + estado/motivo */}
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[11px] font-bold text-white uppercase truncate">
                      {f.nombre}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      <span
                        className={`px-2 py-0.5 rounded-full border font-mono text-[9px] font-bold uppercase tracking-wider ${pildora.clases}`}
                      >
                        {pildora.label}
                      </span>
                      {f.estado === "ERROR" && f.error && (
                        <span className="font-mono text-[9px] uppercase tracking-wider text-red-400/80 truncate">
                          {f.error}
                        </span>
                      )}
                      {f.motivo && f.statusActa === "RECHAZADA" && (
                        <span className="font-mono text-[9px] uppercase tracking-wider text-red-400/80">
                          {f.motivo}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Score · página · nivel (desktop) */}
                  <div className="hidden sm:flex items-center gap-3 shrink-0 font-mono text-[10px] uppercase tracking-wider text-gray-400">
                    {typeof f.score === "number" && (
                      <span className="text-gray-200 font-bold">{f.score.toFixed(1)}</span>
                    )}
                    <span>{f.pagina ?? "-/-"}</span>
                    {f.nivel && (
                      <span
                        className={`px-1.5 py-0.5 rounded border ${
                          f.nivel === "AUTO"
                            ? "border-brand-green/50 text-brand-green"
                            : "border-brand-borderdim text-gray-500"
                        }`}
                      >
                        {f.nivel}
                      </span>
                    )}
                  </div>

                  {/* Acciones por fila */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {f.estado === "LISTA" && (
                      <button
                        type="button"
                        onClick={() => void abrirActa(f.id)}
                        aria-label={`Abrir ${f.nombre} en revisión`}
                        className="min-h-[44px] min-w-[44px] px-2.5 rounded-lg border border-brand-border text-gray-300 font-mono text-[10px] font-bold uppercase tracking-wider hover:border-brand-green hover:text-brand-green focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60"
                      >
                        ABRIR
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void quitar(f.id)}
                      aria-label={`Quitar ${f.nombre} de la cola`}
                      className="min-h-[44px] min-w-[44px] rounded-lg text-gray-500 hover:text-red-400 font-mono text-[10px] font-bold uppercase tracking-wider focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
                    >
                      QUITAR
                    </button>
                  </div>
                </li>
              );
            })}
            {visibles.length === 0 && (
              <li className="rounded-xl border border-brand-borderdim bg-brand-surface/40 px-3 py-4 text-center font-mono text-[10px] uppercase tracking-wider text-gray-500">
                SIN FILAS CON ESE FILTRO
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
