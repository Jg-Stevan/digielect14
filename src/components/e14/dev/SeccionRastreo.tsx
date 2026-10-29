"use client";

/**
 * SeccionRastreo — KIT e14-rastreo-tiempos-v1 · sección 9 del PanelDev
 * («modo desarrollador»): test/rastréo AUTOMATIZADO de los tiempos de
 * digitalización, midiendo el flujo COMO LO USARÍA UN USUARIO NORMAL.
 *
 * Cómo funciona (sin tocar el pipeline — observación pasiva del store):
 *  · ACTIVAR abre una sesión cronometrada; a partir de ahí TODO lo que el
 *    operador haga con la app queda medido: capturas, pipeline (con el
 *    desglose interno real del diagnóstico: decode/detección/OCR/calidad),
 *    revisión humana, envíos, re-escaneos, mesas archivadas y navegación.
 *  · El panel muestra en VIVO: actas rastreadas, enviadas, promedio por
 *    acta, ritmo (actas/hora) y un cronómetro de la fase en curso.
 *  · DETENER sella la sesión (sobrevive a recargas) y la deja disponible
 *    para los tres formatos de informe: JSON (IA/programas), TXT (humano)
 *    y CSV (hoja de cálculo).
 *
 * Las actas de SIMULACIÓN (chips TEST SCORES) se miden aparte — jamás
 * contaminan los agregados de tiempos reales. PRIVACIDAD: solo tiempos/
 * estados — sin actas, sin OCR, sin puesto/mesa en claro; ids con hash.
 */
import { useEffect, useState } from "react";
import { useE14Store } from "@/lib/e14/store";
import {
  activarRastreo,
  detenerRastreo,
  descartarRastreo,
  estaActivo,
  sesionActiva,
  faseActual,
  type FaseRastreo,
} from "@/lib/e14/rastreo/motor";
import {
  descargarRastreo,
  resumenDeSesion,
  type FormatoRastreo,
  type ResumenSesion,
} from "@/lib/e14/rastreo/informe";

/** Timeout del armado — el MISMO patrón de «reiniciar jornada» (4 s). */
const ARMADO_MS = 4000;

function msLegible(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const seg = Math.round(s - m * 60);
  return seg > 0 ? `${m}m ${seg}s` : `${m}m`;
}

function Titulo() {
  return (
    <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
      9 · Rastreo de tiempos
    </h3>
  );
}

function Kpi({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-[#0b1117] px-3 py-2 flex flex-col gap-0.5 min-w-0">
      <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-slate-400 truncate">
        {etiqueta}
      </span>
      <span className={`font-mono text-[13px] font-bold tabular-nums truncate ${tono ?? "text-slate-200"}`}>
        {valor}
      </span>
    </div>
  );
}

/** Interruptor de fila (mismo patrón visual del SwitchFila del panel). */
function SwitchGrande({
  etiqueta,
  nota,
  activo,
  onAlternar,
}: {
  etiqueta: string;
  nota: string;
  activo: boolean;
  onAlternar: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      onClick={onAlternar}
      className="w-full min-h-11 flex items-center justify-between gap-3 rounded-xl px-3 hover:bg-slate-800/40 focus-visible:bg-slate-800/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10b981]/60 transition-colors text-left cursor-pointer"
    >
      <span className="min-w-0 flex flex-col gap-0.5">
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-slate-200">
          {etiqueta}
        </span>
        <span className="text-[11px] leading-snug text-slate-400">{nota}</span>
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

export function SeccionRastreo() {
  // Ticks de 1 s SOLO mientras el panel está montado (cero timers globales).
  const [tick, setTick] = useState(0);
  const [armadoActivar, setArmadoActivar] = useState(false);
  const [armadoDetener, setArmadoDetener] = useState(false);
  const [armadoVaciar, setArmadoVaciar] = useState(false);
  const [exportando, setExportando] = useState<FormatoRastreo | null>(null);
  const [listo, setListo] = useState<FormatoRastreo | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);

  // La vista ACTAS/RESUMEN manda el conteo de mesas del puesto (contexto).
  const vista = useE14Store((s) => s.vista);

  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!armadoActivar) return;
    const t = window.setTimeout(() => setArmadoActivar(false), ARMADO_MS);
    return () => window.clearTimeout(t);
  }, [armadoActivar]);
  useEffect(() => {
    if (!armadoDetener) return;
    const t = window.setTimeout(() => setArmadoDetener(false), ARMADO_MS);
    return () => window.clearTimeout(t);
  }, [armadoDetener]);
  useEffect(() => {
    if (!armadoVaciar) return;
    const t = window.setTimeout(() => setArmadoVaciar(false), ARMADO_MS);
    return () => window.clearTimeout(t);
  }, [armadoVaciar]);

  const activo = estaActivo();
  const sesion = sesionActiva();
  const fase: FaseRastreo = faseActual();
  const resumen: ResumenSesion | null = sesion ? resumenDeSesion(sesion) : null;
  const hayDatos = !!sesion && sesion.actas.length > 0;

  // FIX lint (react-hooks/preserve-manual-memoization): `exportar` NO vive en
  // ningún array de deps (solo onClick) → función plana; el guard de
  // re-entrada y el feedback UI (`exportando`/`listo`) quedan idénticos.
  const exportar = async (formato: FormatoRastreo) => {
    if (exportando) return;
    setExportando(formato);
    setListo(null);
    setMotivo(null);
    try {
      await descargarRastreo(formato);
      setListo(formato);
      window.setTimeout(() => setListo(null), 1500);
    } catch (err) {
      const crudo = err instanceof Error ? err.message : String(err);
      setMotivo((crudo.replace(/\s+/g, " ").trim().slice(0, 48) || "NO SE PUDO GENERAR").toUpperCase());
    } finally {
      setExportando(null);
    }
  };

  return (
    <section aria-label="Rastreo de tiempos de digitalización" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Titulo />
        <span
          className={`font-mono text-[9px] font-black uppercase tracking-wider rounded px-1.5 py-0.5 border ${
            activo
              ? "border-[#10b981]/60 bg-[#10b981]/15 text-[#10b981] animate-pulse-sync"
              : "border-slate-700 bg-slate-800/60 text-slate-400"
          }`}
        >
          {activo ? "● MIDENDO" : "OFF"}
        </span>
      </div>

      <p className="rounded-xl border border-slate-800 bg-[#0b1117] px-3.5 py-2 text-[11.5px] leading-relaxed text-slate-400">
        Test automatizado de tiempos: al activarlo, cada acta se cronometra
        <b className="text-slate-300"> como lo usaría un usuario normal</b> — captura →
        pipeline (OCR real) → revisión → envío — con re-escaneos y navegación incluidos.
        Opera la app con normalidad y exporta el informe al terminar.
      </p>

      {/* Cronómetro de fase en vivo */}
      {activo && (
        <div className="rounded-2xl border border-[#10b981]/40 bg-[#0b1117] px-3.5 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
              FASE ACTUAL
            </span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-300">
              VISTA: {fase.vista.toUpperCase()}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <span
              className={`font-mono text-lg font-extrabold tabular-nums ${
                fase.unidadAbierta ? "text-[#10b981]" : "text-slate-500"
              }`}
            >
              {fase.unidadAbierta
                ? `${fase.fase} ${msLegible(fase.msFase)}`
                : "EN ESPERA"}
            </span>
            <span className="font-mono text-[10px] text-slate-400 tabular-nums">
              {fase.unidadAbierta ? `intento ${fase.intentosUnidad + 1}` : "sin acta en curso"}
            </span>
          </div>
          {fase.msVista !== null && (
            <p className="mt-0.5 font-mono text-[9.5px] text-slate-500 tabular-nums">
              permanencia en {fase.vista}: {msLegible(fase.msVista)}
            </p>
          )}
        </div>
      )}

      {/* KPIs en vivo de la sesión */}
      {resumen && (
        <div className="grid grid-cols-2 gap-2">
          <Kpi
            etiqueta="Actas reales"
            valor={`${resumen.actasReales}`}
            tono="text-white"
          />
          <Kpi
            etiqueta="Enviadas"
            valor={`${resumen.enviadas}${resumen.autoEnvios > 0 ? ` · ${resumen.autoEnvios} auto` : ""}`}
            tono="text-[#10b981]"
          />
          <Kpi
            etiqueta="Promedio / acta"
            valor={msLegible(resumen.total.mediaMs)}
          />
          <Kpi
            etiqueta="Ritmo"
            valor={resumen.actasPorHora !== null ? `${resumen.actasPorHora}/h` : "—"}
          />
          <Kpi
            etiqueta="Pipeline p50 · p95"
            valor={`${msLegible(resumen.pipeline.p50Ms)} · ${msLegible(resumen.pipeline.p95Ms)}`}
          />
          <Kpi
            etiqueta="Re-escaneos"
            valor={`${resumen.reescaneos}`}
            tono={resumen.reescaneos > 0 ? "text-amber-400" : "text-slate-200"}
          />
          {resumen.actasSim > 0 && (
            <Kpi
              etiqueta="SIM (aparte)"
              valor={`${resumen.actasSim}`}
              tono="text-amber-400"
            />
          )}
          <Kpi
            etiqueta="Duración sesión"
            valor={msLegible(resumen.duracionMs)}
          />
        </div>
      )}

      {/* Switch de activación (con confirmación — coherencia D4) */}
      <div className="rounded-2xl border border-slate-800 bg-[#0b1117] py-1">
        {!activo ? (
          <>
            <SwitchGrande
              etiqueta="RASTREO ACTIVO"
              nota="Abre una sesión cronometrada y mide todo el flujo de digitalización. Solo corre mientras el modo desarrollador esté activo."
              activo={false}
              onAlternar={() => setArmadoActivar(true)}
            />
            {armadoActivar && (
              <ConfirmInline
                pregunta="¿Activar el rastreo de tiempos? Medirá tus capturas, revisiones y envíos (solo metadatos, nada sale del dispositivo)."
                onSi={() => {
                  setArmadoActivar(false);
                  activarRastreo();
                  setTick((n) => n + 1);
                }}
                onNo={() => setArmadoActivar(false)}
              />
            )}
          </>
        ) : (
          <>
            <SwitchGrande
              etiqueta="RASTREO ACTIVO"
              nota="Sesión en curso — deténerla la sella y la deja lista para los informes."
              activo={true}
              onAlternar={() => setArmadoDetener(true)}
            />
            {armadoDetener && (
              <ConfirmInline
                pregunta="¿Detener y cerrar la sesión de rastreo? Queda archivada para los informes."
                onSi={() => {
                  setArmadoDetener(false);
                  detenerRastreo();
                  setTick((n) => n + 1);
                }}
                onNo={() => setArmadoDetener(false)}
              />
            )}
          </>
        )}
      </div>

      {/* Exportación — 3 formatos */}
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["json", "{} JSON"],
            ["txt", "TXT"],
            ["csv", "CSV"],
          ] as const
        ).map(([formato, etiqueta]) => (
          <button
            key={formato}
            type="button"
            onClick={() => void exportar(formato)}
            disabled={!hayDatos || exportando !== null}
            aria-label={`Descargar informe de rastreo en formato ${formato}`}
            className="min-h-[44px] px-2 rounded-xl border border-[#10b981]/60 bg-[#10b981]/10 hover:bg-[#10b981]/20 text-[#10b981] font-mono text-[10px] font-black uppercase tracking-wider transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1"
          >
            {exportando === formato ? "…" : listo === formato ? "✓" : `⬇ ${etiqueta}`}
          </button>
        ))}
      </div>
      {!hayDatos && (
        <p
          role="note"
          className="rounded-xl border border-slate-800 bg-[#0b1117] px-3.5 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400"
        >
          SIN ACTAS RASTREADAS AÚN — ACTIVA EL RASTREO Y DIGITALIZA UN ACTA
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

      {/* Protocolo de prueba sugerido */}
      <details className="rounded-xl border border-slate-800 bg-[#0b1117] px-3.5 py-2">
        <summary className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-300 cursor-pointer select-none">
          PROTOCOLO DE PRUEBA SUGERIDO
        </summary>
        <ol className="mt-2 list-decimal list-inside text-[11.5px] leading-relaxed text-slate-400 flex flex-col gap-1">
          <li>Activa el rastreo (arriba) — empieza el cronómetro de sesión.</li>
          <li>
            Digitaliza 5–10 actas reales con CÁMARA (o IMPORTAR) operando con
            normalidad: captura, revisión, envío; re-escanea las rechazadas.
          </li>
          <li>
            Metas de fluidez: acta completa ≤ 90 s · pipeline ≤ 45 s (gama media,
            OCR caliente). El informe marca las que se pasen.
          </li>
          <li>Detén la sesión y descarga el informe (JSON para IA · TXT para leer · CSV para Excel).</li>
          <li>
            Repite la prueba por tipo de dispositivo (gama baja/media/alta) — el
            informe trae el tier y el plan de hilos OCR como contexto.
          </li>
        </ol>
      </details>

      {/* Zona peligrosa: vaciar datos (armado) */}
      <button
        type="button"
        onClick={() => {
          if (!armadoVaciar) {
            setArmadoVaciar(true);
            return;
          }
          setArmadoVaciar(false);
          descartarRastreo();
          setTick((n) => n + 1);
        }}
        aria-label="Vaciar todos los datos del rastreo"
        className={`min-h-[40px] px-3 rounded-lg border font-mono text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ef4444]/60 ${
          armadoVaciar
            ? "border-red-500 text-red-400 bg-red-500/15"
            : "border-slate-700 bg-slate-800/60 hover:border-red-500/60 hover:text-red-400 text-slate-400"
        }`}
      >
        {armadoVaciar ? "¿SEGURO? TOCA DE NUEVO PARA BORRAR TODO" : "VACIAR DATOS DEL RASTREO"}
      </button>

      {/* tick consumido — mantiene el cronómetro vivo sin warnings */}
      <span className="hidden" data-tick={tick} data-vista={vista} aria-hidden />
    </section>
  );
}
