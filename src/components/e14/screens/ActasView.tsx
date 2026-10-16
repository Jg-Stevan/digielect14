"use client";

/**
 * ACTAS (§7.6 / C1) — "CONTROL ACTAS E-14": puesto ACTUAL (el de la ÚLTIMA
 * clasificación archivada — regla del dueño: SOLO un puesto en pantalla) con
 * la cantidad de mesas DIVIPOL del puesto, y acordeón con TODAS las mesas de
 * ESE puesto (1..countTable; PENDIENTE lo no archivado). MODO SIMULACIÓN:
 * toggle que llena la vista con el puesto demo (seed §6.4) cuando NO hay
 * puesto real — jamás escribe en archivadas (overlay de vista). Sin datos →
 * estado vacío honesto. La alerta «N MESAS INCOMPLETAS» quedó FUERA.
 */
import { useEffect, useMemo, useState } from "react";
import { useE14Store, type ActaArchivada, type PuestoActual } from "@/lib/e14/store";
// KIT actas-vivas-paginas-v1 (FASE A): mesasIniciales ya NO se importa — el
// guion del SIM vive en el store (mesas) y avanzan con el tick de 5 s.
import { PUESTO_SIMULADO } from "@/lib/e14/seed";
import { cargarDivipol, mesasDePuesto } from "@/lib/e14/divipol";
import type { Mesa, MesaPagina } from "@/lib/e14/types";
import { ChevronDownIcon, MapPinIcon, SensorsIcon } from "../icons";

function chipPagina(p: MesaPagina): { label: string; clases: string } {
  switch (p.estado) {
    case "OK":
      return { label: `P${p.pagina} ✓`, clases: "px-2 py-0.5 bg-[#00E676]/10 border border-[#00E676]/40 text-brand-green font-mono" };
    case "RESCANEO":
      return { label: `P${p.pagina} ⚠ Rescaneo`, clases: "px-2 py-0.5 bg-red-500/10 border border-red-500/40 text-red-500 font-mono" };
    case "EN_PROCESO":
      return { label: `P${p.pagina} ⏳`, clases: "px-2 py-0.5 bg-amber-400/10 border border-amber-400/40 text-amber-400 font-mono" };
    default:
      return { label: `P${p.pagina}`, clases: "px-2 py-0.5 bg-brand-surfacelight border border-brand-border text-gray-400 font-mono" };
  }
}

function estadoMesa(mesa: Mesa): { label: string; clases: string; dot: string } {
  switch (mesa.estado) {
    case "COMPLETADA":
      return { label: `COMPLETADA ${mesa.progresoPct}%`, clases: "bg-brand-surface border-brand-green/30 text-brand-green", dot: "bg-brand-green" };
    case "EN_PROCESO":
      return { label: "EN PROCESO", clases: "bg-amber-950/60 border-amber-500 text-amber-400", dot: "bg-amber-400" };
    default:
      return { label: "PENDIENTE", clases: "bg-brand-surface border-brand-border text-gray-400", dot: "bg-gray-400" };
  }
}

function CardMesa({ mesa, abierta, onToggle }: { mesa: Mesa; abierta: boolean; onToggle: () => void }) {
  const grupos: { tipo: "DELEGADOS" | "TRANSMISIÓN"; paginas: MesaPagina[] }[] = [
    { tipo: "DELEGADOS", paginas: mesa.paginas.filter((p) => p.tipo === "DELEGADOS") },
    { tipo: "TRANSMISIÓN", paginas: mesa.paginas.filter((p) => p.tipo === "TRANSMISIÓN") },
  ];
  const estado = estadoMesa(mesa);

  return (
    <div className="bg-brand-surface border border-brand-border p-2.5 flex flex-col gap-2 rounded-2xl">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={abierta}
        className="flex justify-between items-center cursor-pointer select-none w-full"
      >
        <span className="text-lg font-mono font-bold text-white flex items-center gap-2">
          {mesa.id}
          <ChevronDownIcon
            className={`w-4 h-4 text-gray-400 transition-transform duration-100 ease-linear ${
              abierta ? "rotate-180" : ""
            }`}
          />
        </span>
        <span
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-mono text-[10px] font-bold uppercase tracking-wider ${estado.clases}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${estado.dot}`} aria-hidden />
          {estado.label}
        </span>
      </button>
      {abierta && (
        <div className="grid grid-cols-2 gap-1 text-[12px] pt-1">
          {grupos.map(({ tipo, paginas }) => (
            <div key={tipo} className="p-2 bg-brand-black/40 border border-brand-border rounded-xl flex flex-col gap-1">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-gray-400">{tipo}</span>
              <div className="flex gap-1 flex-wrap">
                {paginas.map((p) => {
                  const chip = chipPagina(p);
                  return (
                    <span key={`${p.tipo}-${p.pagina}`} className={`${chip.clases} rounded-full text-[10px] whitespace-nowrap`}>
                      {chip.label}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ActasView() {
  const archivadas = useE14Store((s) => s.archivadas);
  const puestoReal = useE14Store((s) => s.puestoActual);
  const modoSimulacion = useE14Store((s) => s.modoSimulacion);
  const alternarModoSimulacion = useE14Store((s) => s.alternarModoSimulacion);
  // KIT actas-vivas-paginas-v1 (FASE A): guion VIVO del SIM (store) —
  // avanzarSimulacion marca una página OK cada 5 s; el tick se detiene
  // SOLO al completar el guion (simCompleta).
  const mesas = useE14Store((s) => s.mesas);
  const simCompleta = useE14Store((s) => s.simCompleta);
  const simUltima = useE14Store((s) => s.simUltima);
  const avanzarSimulacion = useE14Store((s) => s.avanzarSimulacion);
  const online = useE14Store((s) => s.online);
  const alternarConexion = useE14Store((s) => s.alternarConexion);
  const [mesaAbierta, setMesaAbierta] = useState<string | null>(null);
  const [totalMesas, setTotalMesas] = useState<number | null>(null);

  // Puesto mostrado: el real manda; en simulación (sin puesto real) el demo.
  const puestoActual: PuestoActual | null = puestoReal ?? (modoSimulacion ? PUESTO_SIMULADO : null);
  const enSimulacion = !puestoReal && modoSimulacion;

  // Cantidad de mesas del puesto (countTable DIVIPOL §1). En simulación:
  // fija 3 (mesas del mock). Base en caché de módulo → consulta instantánea.
  useEffect(() => {
    let vivo = true;
    if (enSimulacion) {
      setTotalMesas(3);
      return () => {
        vivo = false;
      };
    }
    if (!puestoReal) {
      setTotalMesas(null);
      return;
    }
    const [dep, mun, zon, std] = puestoReal.clave.split("-");
    cargarDivipol().then((base) => {
      if (vivo) setTotalMesas(mesasDePuesto(base, dep, mun, zon, std));
    });
    return () => {
      vivo = false;
    };
  }, [enSimulacion, puestoReal]);

  // Mesas DEL PUESTO ACTUAL: 1..countTable (PENDIENTE lo no archivado) +
  // defensivamente archivadas fuera de rango. Sin base → solo las archivadas.
  const mesasDelPuesto = useMemo<Mesa[]>(() => {
    if (!puestoReal) return [];
    const prefijo = `${puestoReal.clave}-`;
    const porNumero = new Map<number, ActaArchivada>();
    for (const [clave, entrada] of Object.entries(archivadas)) {
      if (!clave.startsWith(prefijo)) continue;
      const numero = Number.parseInt(clave.slice(prefijo.length), 10);
      if (Number.isFinite(numero)) porNumero.set(numero, entrada);
    }
    const construir = (numero: number, entrada: ActaArchivada | undefined): Mesa => {
      const total = Math.min(2, entrada?.clasificacion.pagina?.total ?? 2);
      const paginas: MesaPagina[] = [];
      for (const tipo of ["DELEGADOS", "TRANSMISIÓN"] as const) {
        for (let p = 1; p <= total; p += 1) {
          paginas.push({
            tipo,
            pagina: p as 1 | 2,
            // KIT actas-vivas-paginas-v1 (FASE C): el estado de la página
            // viene del hueco REAL (OK | RESCANEO) — el chip «P# ⚠ Rescaneo»
            // ya existía muerto; con RESCANEO la mesa queda EN PROCESO
            // (ocupadas cuenta SOLO OK) y el re-archivo del mismo hueco la
            // sube a ✓ (AC-RC5).
            estado:
              entrada?.huecos.find((h) => h.tipo === tipo && h.pagina === p)?.estado ??
              ("PENDIENTE" as const),
          });
        }
      }
      const ocupadas = paginas.filter((p) => p.estado === "OK").length;
      return {
        id: `MESA ${String(numero).padStart(2, "0")}`,
        estado:
          ocupadas === 0 ? "PENDIENTE" : ocupadas === paginas.length ? "COMPLETADA" : "EN_PROCESO",
        progresoPct: Math.round((ocupadas / paginas.length) * 100),
        paginas,
      };
    };
    const numeros =
      totalMesas != null
        ? Array.from({ length: totalMesas }, (_, i) => i + 1)
        : [...porNumero.keys()].sort((a, b) => a - b);
    const lista = numeros.map((n) => construir(n, porNumero.get(n)));
    for (const [n, entrada] of porNumero) {
      if (totalMesas != null && n > totalMesas) lista.push(construir(n, entrada));
    }
    return lista;
  }, [archivadas, puestoReal, totalMesas]);

  // Vista efectiva: simulación (sin puesto real) = guion VIVO del store
  // (KIT actas-vivas-paginas-v1, FASE A — mesasIniciales() se recreaba en
  // cada render y por eso el mock nunca avanzaba); si no, real.
  const mesasMostradas: Mesa[] = enSimulacion ? mesas : mesasDelPuesto;

  // KIT actas-vivas-paginas-v1 (FASE A): progreso del puesto demo (páginas
  // OK del guion vivo) — contador bajo «MESAS SIMULADAS».
  const paginasOcupadas = mesas.reduce(
    (n, m) => n + m.paginas.filter((p) => p.estado === "OK").length,
    0,
  );
  const paginasTotales = mesas.reduce((n, m) => n + m.paginas.length, 0);

  // KIT actas-vivas-paginas-v1 (FASE A): tick del SIM VIVO — cada 5 s sube
  // un acta (avanzarSimulacion en el store). Se detiene SOLO al completar
  // el guion (AC-SIM1, sin ticks colgando); OFF→ON reinicia el guion en el
  // store (AC-SIM2). Con puesto real no corre (real manda — AC-SIM4).
  useEffect(() => {
    if (!enSimulacion || simCompleta) return;
    const t = window.setInterval(avanzarSimulacion, 5000);
    return () => window.clearInterval(t);
  }, [enSimulacion, simCompleta, avanzarSimulacion]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll bg-brand-black flex flex-col">
      <header className="sticky top-0 z-40 w-full bg-brand-black/95 backdrop-blur border-b border-brand-border/60 flex items-center justify-between px-4 h-14 shrink-0">
        <h1 className="font-mono text-sm font-bold tracking-widest text-brand-green uppercase">
          CONTROL ACTAS E-14
        </h1>
      </header>

      <div className="flex-grow flex flex-col gap-6 px-4 pt-4 pb-6 max-w-md mx-auto w-full">
        {/* Puesto actual — REAL (última clasificación archivada) o SIMULADO.
            Píldoras: EN LÍNEA (siempre) + SIMULACIÓN (toggle del dueño). */}
        <section className="flex justify-between items-end border-b border-brand-border pb-2">
          <div className="flex flex-col gap-1 w-full">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-gray-400">
              PUESTO ACTUAL
            </span>
            <h2 className="text-xl font-bold text-white uppercase tracking-wide">
              {puestoActual?.titulo ?? "SIN PUESTO"}
            </h2>
            <div className="flex items-center justify-between mt-1">
              <span className="font-mono text-xs text-gray-400">
                {puestoActual
                  ? `${puestoActual.municipio} > ZONA ${puestoActual.zona} > PUESTO ${puestoActual.puesto}` +
                    (totalMesas != null ? ` · ${totalMesas} MESAS` : "")
                  : "ESCANEA UN ACTA PARA IDENTIFICAR EL PUESTO"}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={alternarModoSimulacion}
                  aria-pressed={modoSimulacion}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-mono text-[11px] font-bold uppercase tracking-wider ${
                    modoSimulacion
                      ? "bg-amber-950/60 border-amber-500 text-amber-400"
                      : "bg-brand-surface border-brand-border text-gray-400"
                  } ${enSimulacion && !simCompleta ? "animate-pulse-sync" : ""}`}
                >
                  SIM
                </button>
                <button
                  type="button"
                  onClick={alternarConexion}
                  aria-pressed={!online}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-mono text-[11px] font-bold uppercase tracking-wider ${
                    online
                      ? "bg-brand-greendark border-brand-green/40 text-brand-green"
                      : "bg-amber-950/60 border-amber-500 text-amber-400"
                  }`}
                >
                  <SensorsIcon className={`w-3 h-3 ${online ? "text-brand-green animate-pulse-sync" : "text-amber-400"}`} />
                  {online ? "EN LÍNEA" : "OFFLINE"}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Acordeón de mesas DEL PUESTO ACTUAL (1..countTable DIVIPOL o seed
            en simulación). La alerta «N MESAS INCOMPLETAS» quedó FUERA. */}
        <div className="flex flex-col gap-4">
          {puestoActual && (
            <div className="flex items-center gap-2 pt-1">
              <MapPinIcon className="w-3.5 h-3.5 text-brand-green shrink-0" />
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-brand-green">
                {enSimulacion ? "MESAS SIMULADAS" : "MESAS DEL PUESTO"} ({totalMesas ?? mesasMostradas.length})
              </span>
              <span className="h-px flex-1 bg-brand-border" />
            </div>
          )}
          {/* KIT actas-vivas-paginas-v1 (FASE A): feedback del SIM VIVO —
              última página subida + progreso del guion; al completarse,
              fila verde PUESTO COMPLETADO ✓ (estilo del bloque ENVIADO). */}
          {enSimulacion && (
            <div className="flex flex-col gap-1 -mt-3">
              <p className="font-mono text-[11px] tracking-wider text-gray-400">
                ÚLTIMA: {simUltima ?? "—"}
              </p>
              <p className="font-mono text-[11px] tracking-wider text-gray-400">
                PROGRESO: {paginasOcupadas} DE {paginasTotales} PÁGINAS
              </p>
              {simCompleta && (
                <div className="flex items-center justify-center px-3 py-2.5 rounded-2xl bg-brand-greendark/60 border border-brand-green/60">
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-brand-green">
                    PUESTO COMPLETADO ✓
                  </span>
                </div>
              )}
            </div>
          )}
          {mesasMostradas.length === 0 && (
            <p className="font-mono text-[11px] uppercase tracking-wider text-gray-500">
              {puestoActual ? "SIN MESAS ARCHIVADAS" : "AÚN NO HAY ACTAS ESCANEADAS"}
            </p>
          )}
          {mesasMostradas.map((mesa) => (
            <CardMesa
              key={mesa.id}
              mesa={mesa}
              abierta={mesaAbierta === mesa.id}
              onToggle={() => setMesaAbierta(mesaAbierta === mesa.id ? null : mesa.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
