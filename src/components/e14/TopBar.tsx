"use client";

/**
 * TopBar — solo en REVISIÓN. STITCH REDESIGN (SPEC-e14-redesign-stitch
 * §3.2.1, mock 6/2/4): [retro ← verde w-10 h-10] · [píldora de estado:
 * dot ping del color + score font-mono del color + label blanco uppercase
 * 11px; contenedor bg-brand-surface con borde del color (rechazada
 * border-red-500/40 · advertencia bg-amber-950/60 + glow · óptima
 * border-brand-green/30 + glow verde)] · [nube de transmisión: verde
 * (bg-brand-greenDark) online+transmitida · roja offline/rechazada ·
 * ámbar pendiente de envío — mapeo §6.4/AC11].
 * La lógica de datos (palabra real por estado, score real, alternar
 * conexión) queda INTACTA de D1 — solo re-vestida.
 */
import { useE14Store } from "@/lib/e14/store";
import type { Acta, ActaStatus } from "@/lib/e14/types";
import { StitchArrowLeftIcon, StitchCloudCheckIcon } from "./icons";
// KIT e14-observabilidad-v1 (agente 2 · C2): badge DEV — chip no intrusivo
// que recuerda que el modo de diagnóstico está activo. Re-render barato:
// evento DOM intra-pestaña + storage cross-pestaña (CERO timers — dev/puente).
import { useModoDev } from "./dev/puente";

/** D1: estilo por estado — palabra + colores del mock vinculante. */
function estiloTopBar(status: ActaStatus, score: number) {
  switch (status) {
    case "ENVIADA":
    case "OPTIMA":
      // Misma regla del consumidor canónico (ReviewView ENVIADA): ≥8 ÓPTIMA,
      // <8 ENVIADA CON ADVERTENCIA (envío observado).
      return {
        palabra: score >= 8 ? "ÓPTIMA" : "ENVIADA CON ADVERTENCIA",
        pill: "bg-brand-surface border border-brand-green/30 shadow-[0_0_12px_rgba(0,230,118,0.15)]",
        dot: "bg-brand-green",
        ping: true,
        score: "text-brand-green",
      };
    case "ADVERTENCIA":
      // Mock 4: píldora ámbar con glow (bg amber-950/60).
      return {
        palabra: "ADVERTENCIA",
        pill:
          "bg-amber-950/60 border border-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.25)]",
        dot: "bg-amber-400",
        ping: false,
        score: "text-amber-400",
      };
    case "RECHAZADA":
      return {
        palabra: "RECHAZADA",
        pill: "bg-brand-surface border border-red-500/40 shadow-sm",
        dot: "bg-red-500",
        ping: true,
        score: "text-red-500",
      };
    case "EN_REVISION_HUMANA":
      return {
        palabra: "REVISIÓN HUMANA",
        pill:
          "bg-amber-950/60 border border-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.25)]",
        dot: "bg-amber-400",
        ping: false,
        score: "text-amber-400",
      };
    case "DUPLICADA":
      // e66 — gemela reutilizada: desenlace COPIADO (cero pipeline propio,
      // cero envío propio). Píldora gris — no es veredicto del gate ni del
      // score; el envío real vive en la original.
      return {
        palabra: "DUPLICADA",
        pill: "bg-brand-surface border border-gray-500/40 shadow-sm",
        dot: "bg-gray-500",
        ping: false,
        score: "text-gray-300",
      };
  }
}

/** Nube de transmisión (§6.4/AC11 — mapeo implementado):
 *  · VERDE  = online y (ENVIADA u ÓPTIMA a punto de auto-enviarse)
 *  · ROJA   = offline (cola pendiente) o RECHAZADA (no se transmite)
 *  · ÁMBAR  = ADVERTENCIA / EN_REVISION_HUMANA online (pendiente de envío) */
function nubeTransmision(status: ActaStatus, online: boolean) {
  if (!online || status === "RECHAZADA") {
    return "bg-red-500/20 border border-red-500/40 text-red-500";
  }
  if (status === "ENVIADA" || status === "OPTIMA") {
    return "bg-brand-greendark border border-brand-green/40 text-brand-green";
  }
  return "bg-amber-950/60 border border-amber-500 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.25)]";
}

function PillEstado({ acta }: { acta: Acta }) {
  const est = estiloTopBar(acta.status, acta.score);
  return (
    <div
      className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs transition-all ${est.pill}`}
      role="status"
    >
      {est.ping ? (
        <span className="relative flex h-2 w-2">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${est.dot} opacity-75`} />
          <span className={`relative inline-flex rounded-full h-2 w-2 ${est.dot}`} />
        </span>
      ) : (
        <span className={`w-2 h-2 rounded-full shrink-0 ${est.dot}`} aria-hidden />
      )}
      <span className={`font-mono font-bold text-xs tracking-tight ${est.score}`}>{acta.score.toFixed(1)}/10</span>
      <span className="text-gray-200 font-semibold uppercase tracking-wider text-[10px]">
        {est.palabra}
      </span>
    </div>
  );
}

export function TopBar() {
  const online = useE14Store((s) => s.online);
  const alternarConexion = useE14Store((s) => s.alternarConexion);
  const navegar = useE14Store((s) => s.navegar);
  const acta = useE14Store((s) => s.actaActual);
  // KIT ux-masiva-fixes-v1 (T2/§B, UX-3): volver al ORIGEN — si el acta se
  // abrió desde la bandeja MASIVA (store.ts:1349), la flecha regresa ahí.
  // SOLO-LECTURA del flag: la lógica de masivaOrigen vive en el store.
  const masivaOrigen = useE14Store((s) => s.masivaOrigen);
  // KIT e14-observabilidad-v1 (agente 2 · C2): modo dev reactivo.
  const modoDev = useModoDev();

  const nube = acta ? nubeTransmision(acta.status, online) : null;

  return (
    <header className="relative z-30 pt-safe shrink-0 bg-brand-black/95 backdrop-blur border-b border-brand-border/60">
      <div className="max-w-md lg:max-w-2xl mx-auto px-4 pt-4 pb-2.5 flex items-center justify-between gap-2">
        <button
          aria-label={masivaOrigen ? "Volver a la bandeja masiva" : "Volver al menú de escaneo"}
          type="button"
          onClick={() => navegar(masivaOrigen ? "masiva" : "escanear")}
          className="w-10 h-10 rounded-full flex items-center justify-center text-brand-green hover:bg-brand-surfacelight tap-action transition-colors"
        >
          <StitchArrowLeftIcon />
        </button>
        {/* KIT e14-observabilidad-v1 (agente 2 · C2): badge DEV en la esquina
            del contenido central — jamás intrusivo, solo recuerda el modo. */}
        <div className="relative min-w-0">
          {acta ? (
            <PillEstado acta={acta} />
          ) : (
            <h1 className="font-mono font-bold text-[11px] uppercase tracking-wider text-brand-green text-center">
              REVISIÓN DE ACTA
            </h1>
          )}
          {modoDev && (
            <span
              title="Modo de diagnóstico activo"
              className="absolute -top-2 -right-2 pointer-events-none font-mono text-[8px] font-black tracking-widest px-1.5 py-px rounded-md border border-[#10b981]/60 bg-[#090d12] text-[#10b981] shadow-sm"
            >
              DEV
            </span>
          )}
        </div>
        {nube ? (
          <button
            type="button"
            onClick={alternarConexion}
            aria-pressed={online}
            aria-label={
              online
                ? "En línea — tocar para simular sin conexión"
                : "Sin conexión — tocar para reconectar"
            }
            title={
              online
                ? "En línea — los envíos se transmiten al servidor"
                : "Sin conexión — los envíos se acumulan en cola local"
            }
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs tap-action transition-colors hover:bg-brand-surfacelight focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60 ${nube}`}
          >
            <StitchCloudCheckIcon className="w-4 h-4" />
            <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />
          </button>
        ) : (
          <div className="w-10 h-10" aria-hidden />
        )}
      </div>
    </header>
  );
}
