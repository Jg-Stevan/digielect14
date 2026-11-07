"use client";

/**
 * ANALIZANDO (§7.2) — anillo de progreso + % + línea de escaneo + 4 barras
 * de paso + etapas canónicas.
 * FASE LÓGICA L1: event-driven — el % se deriva de `progresoAnalisis` (eventos
 * del bridge) ponderado por etapa (DETECTANDO .15 · RECORTANDO .15 ·
 * REALZANDO .20 · CALIDAD .15 · OCR .35 — el OCR domina) y se suaviza con un
 * lerp por rAF. Piso escénico D16: el % nunca llega a 100 hasta que el
 * pipeline resolvió Y pasaron ≥1200 ms del montaje; entonces anima a 100
 * (~350 ms) y navega a REVISIÓN (mismo feel de ~2.5 s de la fase gráfica).
 */
import { useEffect, useRef, useState } from "react";
import { useE14Store } from "@/lib/e14/store";
import { leerFlags } from "@/lib/e14/flags";
import type { EtapaAnalisis, ProgresoAnalisis } from "@/lib/e14/fachada";
import { DocScannerIcon, ShieldCheckIcon } from "../icons";

const ETAPAS = [
  "DETECTANDO BORDES",
  "LEYENDO CAMPOS",
  "CALCULANDO SCORE",
  "VALIDACIÓN COMPLETADA CON ÉXITO",
];

/** Pesos por etapa del pipeline (§7 AnalyzingView): el OCR domina. */
const PESOS: Record<EtapaAnalisis, number> = {
  DETECTANDO: 0.15,
  RECORTANDO: 0.15,
  REALZANDO: 0.2,
  CALIDAD: 0.15,
  OCR: 0.35,
};
const ORDEN_ETAPAS: readonly EtapaAnalisis[] = [
  "DETECTANDO",
  "RECORTANDO",
  "REALZANDO",
  "CALIDAD",
  "OCR",
];

/** Piso escénico (D16): mínimo en pantalla antes de poder cerrar al 100 %.
 *  KIT e14-velocidad-5s-v1: ahora es flag (`pisoEscenicoMs`, default 300) —
 *  con el pipeline bajo 5 s, el piso de 1200 ms + el snap de 350 ms eran 1.5 s
 *  de teatro puro sobre el reloj del dueño. override {"pisoEscenicoMs":1200}
 *  ⇒ la animación de siempre (snap 350 incluido). */
/** Constante de tiempo del tween del % (suaviza los saltos de los eventos). */
const TAU_SUAVIZADO_MS = 140;

/** Progreso global 0..1: pesos de etapas completadas + peso × avance actual. */
function progresoPonderado(p: ProgresoAnalisis | null): number {
  if (!p) return 0;
  const avance = Math.min(1, Math.max(0, p.progreso));
  let acumulado = 0;
  for (const etapa of ORDEN_ETAPAS) {
    if (etapa === p.etapa) return acumulado + PESOS[etapa] * avance;
    acumulado += PESOS[etapa];
  }
  return acumulado;
}

const CIRCUNFERENCIA = 427.25; // 2π × r(68)

export function AnalyzingView() {
  const progresoAnalisis = useE14Store((s) => s.progresoAnalisis);
  const analisisResuelto = useE14Store((s) => s.analisisResuelto);
  const analisisCompletado = useE14Store((s) => s.analisisCompletado);
  // Ola 3.2 (U4 — plan 3.2): salida del ANALIZANDO estancado (hasta 120 s de
  // watchdog encerrados sin botón). El store limpia y vuelve a ESCANEAR.
  const cancelarAnalisis = useE14Store((s) => s.cancelarAnalisis);
  const [progreso, setProgreso] = useState(0);
  const [latencia, setLatencia] = useState(0);
  // Ola 4.2.5: anuncio throttled del % para lectores de pantalla — el span
  // aria-live cambia cada ~10 % (no en cada frame, que sería ininterrumpible).
  const [anuncioPct, setAnuncioPct] = useState(0);
  // Ola 3.2: 15 s sin EVENTOS de progreso del pipeline → estancado. Los
  // eventos (no el tween local) son la señal: el tween converge ~1 s después
  // del último evento, así que eventos congelados ≡ % congelado en pantalla.
  const [estancado, setEstancado] = useState(false);

  useEffect(() => {
    // Resuelto (o cambio de progreso) → apaga el botón y re-arma la ventana.
    setEstancado(false);
    if (analisisResuelto) return;
    const t = window.setTimeout(() => setEstancado(true), 15_000);
    return () => window.clearTimeout(t);
  }, [progresoAnalisis, analisisResuelto]);

  // Últimos datos del store, leídos por el loop de rAF (no se re-crea).
  const datosRef = useRef({ ponderado: 0, resuelto: false });
  useEffect(() => {
    datosRef.current.ponderado = progresoPonderado(progresoAnalisis);
    datosRef.current.resuelto = analisisResuelto;
  }, [progresoAnalisis, analisisResuelto]);

  useEffect(() => {
    const pisoEscenicoMs = leerFlags().pisoEscenicoMs;
    const cierreInstantaneo = leerFlags().cierreInstantaneo;
    const inicioReloj = performance.now();
    const inicioFecha = Date.now();
    let raf = 0;
    let anterior = performance.now();
    let mostrado = 0; // fracción 0..1 mostrada (suavizada)
    let ultimoPct = 0;
    let ultimoBoteAnuncio = 0; // Ola 4.2.5: último múltiplo de 10 anunciado
    let cerrado = false; // ya se disparó analisisCompletado
    let cierre: ReturnType<typeof setTimeout> | undefined;

    const tick = (t: number) => {
      const dt = Math.min(Math.max(t - anterior, 1), 120);
      anterior = t;
      const { ponderado, resuelto } = datosRef.current;
      // Piso escénico D16: nunca 100 hasta (pipeline resuelto && ≥piso).
      const puedeCerrar = resuelto && t - inicioReloj >= pisoEscenicoMs;
      // KIT e14-velocidad-5s-v1 (`cierreInstantaneo`): el teatro de abajo gasta
      // ~600 ms del reloj del dueño DESPUÉS de que el trabajo ya terminó (el
      // tween exponencial al 0.995 ≈ 2,3·TAU = 320 ms + el `setTimeout` de
      // cierre). Con el flag, en cuanto se puede cerrar se cierra.
      if (puedeCerrar && !cerrado && cierreInstantaneo) {
        cerrado = true;
        setProgreso(100);
        setAnuncioPct(100);
        analisisCompletado();
        return;
      }
      const objetivo = puedeCerrar ? 1 : Math.min(ponderado, 0.99);
      // Tween corto hacia el objetivo (anti saltos a golpes).
      mostrado += (objetivo - mostrado) * (1 - Math.exp(-dt / TAU_SUAVIZADO_MS));
      mostrado = Math.min(mostrado, puedeCerrar ? 1 : 0.99);

      if (puedeCerrar && mostrado >= 0.995) {
        // Cierre escénico: snap a 100 y navega (el snap NUNCA supera el piso
        // — con piso corto la pantalla no se queda fingiendo después del 100).
        if (!cerrado) {
          cerrado = true;
          setProgreso(100);
          setAnuncioPct(100);
          cierre = setTimeout(() => analisisCompletado(), Math.min(350, pisoEscenicoMs));
        }
        raf = requestAnimationFrame(tick);
        return;
      }

      const pct = Math.round(mostrado * 100);
      if (pct !== ultimoPct) {
        ultimoPct = pct;
        setProgreso(pct);
        // Ola 4.2.5: anuncio SOLO cuando cruza un múltiplo de 10 (throttle
        // — el aria-live no puede hablar en cada frame).
        const bote = Math.floor(pct / 10) * 10;
        if (bote > ultimoBoteAnuncio) {
          ultimoBoteAnuncio = bote;
          setAnuncioPct(bote);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Latencia del beacon: ms REALES desde el montaje (~cada 180 ms).
    const latenciaTimer = setInterval(() => {
      setLatencia(Date.now() - inicioFecha);
    }, 180);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(latenciaTimer);
      if (cierre) clearTimeout(cierre);
    };
  }, [analisisCompletado]);

  const etapa = Math.min(Math.floor((progreso / 100) * ETAPAS.length), ETAPAS.length - 1);
  const offset = CIRCUNFERENCIA - (progreso / 100) * CIRCUNFERENCIA;
  const barras = Math.ceil((progreso / 100) * 4);

  return (
    <div className="flex-1 flex flex-col bg-[#090d12] backdrop-blur pt-safe pb-6 select-none">
      {/* Task 2-b: lg:max-w-lg — el anillo y el checklist ganan aire en
          escritorio sin tocar las medidas fijas del anillo (concentrico). */}
      <div className="flex-1 flex flex-col justify-between items-center w-full max-w-md lg:max-w-lg mx-auto px-4">
        {/* Beacon superior: EN PROCESO + latencia */}
        <div className="w-full flex items-center justify-between pt-4">
          <div className="flex items-center gap-2 bg-[#10161f] border border-slate-800 px-3.5 py-1.5 rounded-full shadow-xs">
            <span className="inline-block w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
            <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-slate-300">
              PROCESANDO MOTOR OCR
            </span>
          </div>
          <span className="font-mono text-xs text-slate-400 tabular-nums bg-slate-800/50 px-2 py-0.5 rounded-md border border-slate-700/50">
            {latencia}ms
          </span>
        </div>

        {/* Área focal: anillo concéntrico */}
        <div className="flex flex-col items-center justify-center my-auto w-full max-w-xs">
          <div className="relative flex items-center justify-center w-52 h-52 mb-6">
            {/* Glow ambiental */}
            <div className="absolute inset-0 rounded-full bg-[#10b981]/15 blur-2xl" aria-hidden />

            {/* Pista + anillo de progreso */}
            <svg
              className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none"
              viewBox="0 0 160 160"
              aria-hidden
            >
              <circle
                className="text-slate-800/80"
                cx="80"
                cy="80"
                fill="none"
                r="68"
                stroke="currentColor"
                strokeWidth="3"
              />
              <circle
                className="text-[#10b981] transition-all duration-200 ease-out"
                cx="80"
                cy="80"
                fill="none"
                r="68"
                stroke="currentColor"
                strokeDasharray={CIRCUNFERENCIA}
                strokeDashoffset={offset}
                strokeLinecap="round"
                strokeWidth="3.5"
              />
            </svg>

            {/* Anillo medio */}
            <div className="absolute w-40 h-40 rounded-full bg-[#10161f] border border-slate-800/80 flex items-center justify-center shadow-lg">
              {/* Núcleo de escaneo */}
              <div className="relative w-30 h-30 rounded-full bg-[#090d12] border border-slate-800 flex flex-col items-center justify-center overflow-hidden">
                <div
                  className="absolute left-[10%] right-[10%] h-[2px] bg-[#10b981] shadow-[0_0_12px_rgba(16,185,129,0.7)] animate-scan"
                  aria-hidden
                />
                <div className="relative z-10 flex items-center justify-center mb-1">
                  <DocScannerIcon className="w-9 h-9 text-[#10b981] drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                </div>
                {/* Ola 4.2.5 (U5 — plan 4.2.5): el % es progressbar con
                    aria-valuenow real y un span role="status" aria-live="polite"
                    que anuncia cada ~10 % (throttle en el loop rAF, sr-only). */}
                <div
                  role="progressbar"
                  aria-label="Progreso del análisis del acta"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progreso)}
                  className="relative z-10 flex flex-col items-center"
                >
                  <span className="font-mono text-xs font-bold text-white tabular-nums">
                    {Math.round(progreso)}%
                  </span>
                  <span role="status" aria-live="polite" className="sr-only">
                    {`Progreso del análisis: ${anuncioPct} por ciento`}
                  </span>
                </div>
              </div>
            </div>

            {/* Micro marcas de esquina */}
            <div className="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-[#10b981]" aria-hidden />
            <div className="absolute -top-1 -right-1 w-3 h-3 border-t-2 border-r-2 border-[#10b981]" aria-hidden />
            <div className="absolute -bottom-1 -left-1 w-3 h-3 border-b-2 border-l-2 border-[#10b981]" aria-hidden />
            <div className="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-[#10b981]" aria-hidden />
          </div>

          {/* Jerarquía tipográfica */}
          <div className="flex flex-col items-center text-center gap-1.5">
            <h2 className="text-xl font-bold text-white tracking-tight">Analizando acta E-14</h2>
            <p className="font-mono text-xs text-[#10b981] tracking-widest uppercase max-w-[280px] min-h-[18px] transition-opacity duration-200 font-semibold">
              {progreso >= 100 ? "VALIDACIÓN COMPLETADA CON ÉXITO" : ETAPAS[etapa]}
            </p>
          </div>

          {/* 4 barras de paso — lg: más anchas, mismo flex-1 reparto */}
          <div className="w-44 lg:w-56 flex items-center justify-between gap-1.5 mt-5">
            {Array.from({ length: 4 }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 rounded-[2px] transition-colors duration-300 ${
                  i < barras ? "bg-[#10b981] shadow-xs shadow-[#10b981]/50" : "bg-slate-800"
                }`}
              />
            ))}
          </div>

          {/* Ola 3.2 (U4): salida del estancamiento — «Cancelar análisis» SOLO
              aparece tras 15 s sin progreso. Live region para que el lector
              anuncie la aparición; fila reservada (min-h) para NO tapar el
              porcentaje ni mover el sello de abajo. */}
          <div aria-live="polite" className="min-h-[64px] flex items-start justify-center pt-3">
            {estancado && !analisisResuelto ? (
              <button
                type="button"
                onClick={cancelarAnalisis}
                className="min-h-11 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 font-mono text-[11px] font-bold uppercase tracking-widest text-amber-300 hover:bg-amber-500/20 active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              >
                Cancelar análisis
              </button>
            ) : (
              <span className="sr-only">Análisis en curso</span>
            )}
          </div>
        </div>

        {/* Sello de integridad */}
        <div className="w-full flex flex-col items-center gap-1 pt-2">
          <div className="flex items-center gap-2 bg-[#10161f] border border-slate-800 px-3.5 py-1.5 rounded-full shadow-xs">
            <ShieldCheckIcon className="w-4 h-4 text-[#10b981]" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-300">
              DIGITALIZADOR OFICIAL E-14
            </span>
          </div>
          <span className="font-mono text-[11px] text-slate-400 text-center">
            VALIDACIÓN AUTOMÁTICA DE REGISTRO ELECTORAL
          </span>
        </div>
      </div>
    </div>
  );
}
