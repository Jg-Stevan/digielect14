"use client";

/**
 * ACTAS (§7.6 / C1) — "CONTROL ACTAS E-14": puesto ACTUAL (el de la ÚLTIMA
 * clasificación archivada — regla del dueño: SOLO un puesto en pantalla) con
 * la cantidad de mesas DIVIPOL del puesto, y acordeón con TODAS las mesas de
 * ESE puesto (1..countTable; PENDIENTE lo no archivado). MODO SIMULACIÓN:
 * toggle que llena la vista con el puesto demo (seed §6.4) cuando NO hay
 * puesto real — jamás escribe en archivadas (overlay de vista). Sin datos →
 * estado vacío honesto. La alerta «N MESAS INCOMPLETAS» quedó FUERA.
 * Task 3 (agente B): responsive 360→1280 — contenedor hasta max-w-3xl,
 * tarjetas de mesa en grid de 2 columnas en xl+ (acordeón intacto) y
 * cabecera/buscador con más aire en lg+.
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
      return { label: `P${p.pagina} ✓`, clases: "px-2.5 py-1 bg-[#10b981]/15 border border-[#10b981]/40 text-[#10b981] font-mono font-bold shadow-xs" };
    case "RESCANEO":
      return { label: `P${p.pagina} ⚠ Rescaneo`, clases: "px-2.5 py-1 bg-[#ef4444]/15 border border-[#ef4444]/40 text-[#ef4444] font-mono font-bold shadow-xs" };
    case "EN_PROCESO":
      return { label: `P${p.pagina} ⏳`, clases: "px-2.5 py-1 bg-amber-400/15 border border-amber-400/40 text-amber-400 font-mono font-bold shadow-xs" };
    default:
      return { label: `P${p.pagina}`, clases: "px-2.5 py-1 bg-slate-800/60 border border-slate-700/60 text-slate-400 font-mono" };
  }
}

function estadoMesa(mesa: Mesa): { label: string; clases: string; dot: string } {
  switch (mesa.estado) {
    case "COMPLETADA":
      return { label: `COMPLETADA ${mesa.progresoPct}%`, clases: "bg-[#10b981]/10 border-[#10b981]/40 text-[#10b981]", dot: "bg-[#10b981]" };
    case "EN_PROCESO":
      return { label: `EN PROCESO ${mesa.progresoPct}%`, clases: "bg-amber-400/10 border-amber-400/40 text-amber-400", dot: "bg-amber-400" };
    default:
      return { label: "PENDIENTE", clases: "bg-slate-800/40 border-slate-700/40 text-slate-400", dot: "bg-slate-500" };
  }
}

function CardMesa({ mesa, abierta, onToggle }: { mesa: Mesa; abierta: boolean; onToggle: () => void }) {
  const grupos: { tipo: "DELEGADOS" | "TRANSMISIÓN"; paginas: MesaPagina[] }[] = [
    { tipo: "DELEGADOS", paginas: mesa.paginas.filter((p) => p.tipo === "DELEGADOS") },
    { tipo: "TRANSMISIÓN", paginas: mesa.paginas.filter((p) => p.tipo === "TRANSMISIÓN") },
  ];
  const estado = estadoMesa(mesa);

  return (
    <div className={`bg-[#10161f] border transition-all duration-200 p-3.5 flex flex-col gap-2.5 rounded-2xl shadow-sm ${
      mesa.estado === "COMPLETADA" ? "border-[#10b981]/30 hover:border-[#10b981]/50" : "border-slate-800 hover:border-slate-700"
    }`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={abierta}
        className="flex justify-between items-center cursor-pointer select-none w-full text-left min-h-[44px]"
      >
        <span className="text-base font-mono font-bold text-white flex items-center gap-2">
          {mesa.id}
          <ChevronDownIcon
            className={`w-4 h-4 text-slate-400 transition-transform duration-200 ease-out ${
              abierta ? "rotate-180 text-white" : ""
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-800/80">
          {grupos.map(({ tipo, paginas }) => (
            <div key={tipo} className="p-2.5 bg-[#090d12]/60 border border-slate-800/70 rounded-xl flex flex-col gap-1.5">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">{tipo}</span>
              <div className="flex gap-1.5 flex-wrap">
                {paginas.map((p) => {
                  const chip = chipPagina(p);
                  return (
                    <span key={`${p.tipo}-${p.pagina}`} className={`${chip.clases} rounded-lg text-[10px] whitespace-nowrap`}>
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
  // avanzarSimulacion marca una página OK cada 5 s.
  // KIT e14-esquinas-suaves-v1 (T-R): el TICK se SUBIÓ al shell (page.tsx) —
  // corre en TODAS las vistas (en ACTAS se pausaba al navegar a RESUMEN).
  // Aquí SOLO queda la lectura del guion (mesas/simCompleta/simUltima).
  const mesas = useE14Store((s) => s.mesas);
  const simCompleta = useE14Store((s) => s.simCompleta);
  const simUltima = useE14Store((s) => s.simUltima);
  const online = useE14Store((s) => s.online);
  const alternarConexion = useE14Store((s) => s.alternarConexion);
  const [mesaAbierta, setMesaAbierta] = useState<string | null>(null);
  const [totalMesas, setTotalMesas] = useState<number | null>(null);
  const [busqueda, setBusqueda] = useState<string>("");

  // Puesto mostrado: el real manda; en simulación (sin puesto real) el demo.
  const puestoActual: PuestoActual | null = puestoReal ?? (modoSimulacion ? PUESTO_SIMULADO : null);
  // KIT e14-luz-sim-puntos-v1 (T-S): el SIM corre TAMBIÉN con puesto real
  // (llena el puesto del acta escaneada — decisión del dueño ⑤). El guion
  // vive en store.mesas (guionDePuesto); archivadas/puestoActual NUNCA se
  // tocan (D6). Apagar devuelve la vista real exacta.
  const enSimulacion = modoSimulacion;

  // Cantidad de mesas del puesto (countTable DIVIPOL §1). En simulación:
  // fija 3 (mesas del mock). Base en caché de módulo → consulta instantánea.
  useEffect(() => {
    let vivo = true;
    if (enSimulacion) {
      // KIT e14-luz-sim-puntos-v1 (T-S): con puesto real el encabezado
      // muestra el total DIVIPOL REAL (el mismo del guion); sin real, 3.
      if (puestoReal) {
        const [dep, mun, zon, std] = puestoReal.clave.split("-");
        cargarDivipol().then((base) => {
          if (vivo) setTotalMesas(mesasDePuesto(base, dep, mun, zon, std));
        });
      } else {
        setTotalMesas(3);
      }
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

  const mesasFiltradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return mesasMostradas;
    return mesasMostradas.filter((m) => m.id.toLowerCase().includes(q));
  }, [mesasMostradas, busqueda]);

  // Progreso del puesto demo o real
  const paginasOcupadas = mesas.reduce(
    (n, m) => n + m.paginas.filter((p) => p.estado === "OK").length,
    0,
  );
  const paginasTotales = mesas.reduce((n, m) => n + m.paginas.length, 0);
  const pctGeneral = paginasTotales > 0 ? Math.round((paginasOcupadas / paginasTotales) * 100) : 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll bg-[#090d12] flex flex-col">
      <header className="sticky top-0 z-40 w-full bg-[#090d12]/92 backdrop-blur-xl border-b border-slate-800/80 px-4 h-14 shrink-0 shadow-xs">
        {/* Task 3: el contenido de la barra se alinea al ancho del contenedor
            de la vista (en lg+ ya no queda pegado al borde del viewport). */}
        <div className="max-w-md lg:max-w-2xl xl:max-w-3xl mx-auto w-full h-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#10b981]" />
            <h1 className="font-mono text-sm font-bold tracking-widest text-[#10b981] uppercase">
              CONTROL ACTAS E-14
            </h1>
          </div>
          <span className="font-mono text-[11px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-md border border-slate-700/60">
            {mesasFiltradas.length} {mesasFiltradas.length === 1 ? "MESA" : "MESAS"}
          </span>
        </div>
      </header>

      <div className="flex-grow flex flex-col gap-5 px-4 pt-4 pb-8 max-w-md lg:max-w-2xl xl:max-w-3xl mx-auto w-full">
        {/* Puesto actual — Card Ejecutiva (Task 3: aire en lg+) */}
        <section className="bg-[#10161f] border border-slate-800 rounded-2xl p-4 lg:p-5 shadow-sm flex flex-col gap-3 lg:gap-4">
          <div className="flex justify-between items-start gap-2">
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                PUESTO DE VOTACIÓN
              </span>
              <h2 className="text-lg lg:text-xl font-bold text-white uppercase tracking-wide truncate">
                {puestoActual?.titulo ?? "SIN PUESTO REGISTRADO"}
              </h2>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={alternarModoSimulacion}
                aria-pressed={modoSimulacion}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full border font-mono text-[10px] font-bold uppercase tracking-wider transition ${
                  modoSimulacion
                    ? "bg-amber-400/20 border-amber-400 text-amber-400 shadow-xs shadow-amber-400/10"
                    : "bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white"
                } ${enSimulacion && !simCompleta ? "animate-pulse-sync" : ""}`}
              >
                SIM
              </button>
              <button
                type="button"
                onClick={alternarConexion}
                aria-pressed={!online}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-mono text-[10px] font-bold uppercase tracking-wider transition ${
                  online
                    ? "bg-[#10b981]/15 border-[#10b981]/40 text-[#10b981]"
                    : "bg-amber-400/20 border-amber-400 text-amber-400"
                }`}
              >
                <SensorsIcon
                  className={`w-3 h-3 ${
                    online
                      ? // Regresión #5 (audit 4f9c871) restaurada en B3: el
                        // pulso del indicador EN LÍNEA (mismo patrón del botón
                        // SIM de arriba — animate-pulse-sync vive en
                        // globals.css).
                        "animate-pulse-sync text-[#10b981]"
                      : "text-amber-400"
                  }`}
                />
                {online ? "EN LÍNEA" : "OFFLINE"}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs lg:text-[13px] font-mono text-slate-400 border-t border-slate-800/80 pt-2.5">
            <span className="truncate">
              {puestoActual
                ? `${puestoActual.municipio} › ZONA ${puestoActual.zona} › PTO ${puestoActual.puesto}`
                : "Escanee un acta para identificar el puesto"}
            </span>
            {totalMesas != null && (
              <span className="shrink-0 font-bold text-slate-300 ml-2">
                {totalMesas} MESAS
              </span>
            )}
          </div>

          {/* Barra de progreso global del puesto */}
          <div className="flex flex-col gap-1.5 mt-1">
            <div className="flex justify-between items-center text-[11px] font-mono">
              <span className="text-slate-400">PROGRESO DEL PUESTO:</span>
              <span className="font-bold text-[#10b981]">{pctGeneral}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-slate-800/80 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#10b981] to-[#059669] transition-all duration-300 rounded-full"
                style={{ width: `${pctGeneral}%` }}
              />
            </div>
          </div>
        </section>

        {/* Buscador de Mesas — Task 3: más cómodo en lg+ (alto 44px, texto sm). */}
        <div className="relative w-full">
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar mesa... (ej. 01, 12)"
            className="w-full h-10 lg:h-11 pl-9 pr-10 bg-[#10161f] border border-slate-800 rounded-xl text-xs lg:text-sm text-white placeholder-slate-500 font-mono focus:outline-none focus:border-[#10b981]/60 focus:ring-1 focus:ring-[#10b981]/30 transition shadow-xs"
          />
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs"
            aria-hidden
          >
            🔍
          </span>
          {busqueda && (
            <button
              type="button"
              onClick={() => setBusqueda("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1.5 text-xs"
              aria-label="Limpiar búsqueda"
            >
              ✕
            </button>
          )}
        </div>

        {/* Acordeón de mesas */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 pt-1">
            <MapPinIcon className="w-3.5 h-3.5 text-[#10b981] shrink-0" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#10b981]">
              {enSimulacion ? "MESAS SIMULADAS" : "MESAS DEL PUESTO"} ({mesasFiltradas.length})
            </span>
            <span className="h-px flex-1 bg-slate-800" />
          </div>

          {/* Feedback de simulación */}
          {enSimulacion && (
            <div className="flex flex-col gap-1 -mt-1 p-2.5 rounded-xl bg-[#10161f]/60 border border-slate-800 text-[11px] font-mono text-slate-400">
              <div className="flex justify-between">
                <span>ÚLTIMA TRANSMISIÓN:</span>
                <span className="text-white font-bold">{simUltima ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>TRANSMITIDAS:</span>
                <span className="text-[#10b981] font-bold">{paginasOcupadas} DE {paginasTotales} PÁGINAS</span>
              </div>
              {simCompleta && (
                <div className="mt-1 flex items-center justify-center py-1.5 rounded-lg bg-[#10b981]/15 border border-[#10b981]/40 text-[#10b981] font-bold uppercase">
                  PUESTO COMPLETADO ✓
                </div>
              )}
            </div>
          )}

          {mesasFiltradas.length === 0 && (
            <div className="p-6 text-center rounded-2xl bg-[#10161f]/50 border border-slate-800/60">
              <p className="font-mono text-xs uppercase tracking-wider text-slate-400">
                {busqueda
                  ? `NO SE ENCONTRARON MESAS PARA "${busqueda}"`
                  : puestoActual
                    ? "SIN MESAS ARCHIVADAS"
                    : "AÚN NO HAY ACTAS ESCANEADAS"}
              </p>
            </div>
          )}

          {/* Task 3 (agente B): en xl+ las tarjetas de mesa van en 2 columnas
              (items-start: una abierta no estira a su vecina). El acordeón
              interno (CardMesa/onToggle) queda INTACTO — mismos handlers. */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 xl:gap-4 items-start">
            {mesasFiltradas.map((mesa) => (
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
    </div>
  );
}
