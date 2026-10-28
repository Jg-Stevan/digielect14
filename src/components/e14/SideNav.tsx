"use client";

/**
 * SideNav — Task 2-a (shell responsive): navegación lateral de escritorio
 * (lg+). En móvil/ tablet la navegación la sigue dando BottomNav (oculto
 * en lg desde page.tsx). Reglas de activo idénticas a BottomNav: la vista
 * `revision` cuenta como ESCANEAR activo. NOTA (eliminación del módulo
 * masiva): el ítem MASIVA y la regla de origen (`masivaOrigen`) se
 * retiraron junto con el módulo.
 * Estado vivo del store (solo lectura): online + cola, actas de sesión.
 * «CÓMO FUNCIONA» abre el AyudaOverlay (módulo propio, cero lógica de
 * negocio).
 */
import { useE14Store, type Vista } from "@/lib/e14/store";
import {
  StitchCameraIcon,
  StitchDocIcon,
  StitchGrid2Icon,
} from "./icons";
import { abrirAyuda } from "./AyudaOverlay";

const ITEMS: { vista: Vista; label: string; hint: string; Icon: typeof StitchCameraIcon }[] = [
  { vista: "escanear", label: "ESCANEAR", hint: "Cámara · sim · subir", Icon: StitchCameraIcon },
  { vista: "actas", label: "ACTAS", hint: "Control de mesas", Icon: StitchDocIcon },
  { vista: "resumen", label: "RESUMEN", hint: "Jornada y análisis", Icon: StitchGrid2Icon },
];

/** Marca: documento con brackets de encuadre + línea de escaneo. */
function MarcaE14() {
  return (
    <span
      className="relative w-10 h-10 rounded-xl bg-[#10161f] border border-slate-800 flex items-center justify-center shrink-0"
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none">
        <path
          d="M5 4.5V4a1 1 0 0 1 1-1h1.5M16.5 3H18a1 1 0 0 1 1 1v1.5M19 16.5V18a1 1 0 0 1-1 1h-1.5M7.5 19H6a1 1 0 0 1-1-1v-1.5"
          stroke="#10b981"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M8.5 9.5h7M8.5 12.5h4.5M8.5 15h5.5"
          stroke="#64748b"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path d="M7 7.2C10.5 6.4 14 6.4 17 7.2" stroke="#f59e0b" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function SideNav() {
  const vista = useE14Store((s) => s.vista);
  const navegar = useE14Store((s) => s.navegar);
  const actasSesion = useE14Store((s) => s.actasSesion);
  const online = useE14Store((s) => s.online);
  const colaOffline = useE14Store((s) => s.colaOffline);

  return (
    <aside
      className="hidden lg:flex w-60 shrink-0 flex-col bg-[#0b1117] border-r border-slate-800/80"
      aria-label="Navegación de escritorio"
    >
      {/* Marca */}
      <div className="px-5 pt-6 pb-5 border-b border-slate-800/60 flex items-center gap-3">
        <MarcaE14 />
        <div className="min-w-0">
          <p className="font-mono text-[13px] font-extrabold tracking-tight text-white leading-tight">
            DIGITALIZADOR
            <span className="text-emerald-400"> E-14</span>
          </p>
          <p className="text-[10px] text-slate-400 font-mono uppercase tracking-[0.18em] mt-0.5">
            Precisión electoral
          </p>
        </div>
      </div>

      {/* Navegación */}
      <nav className="flex-1 min-h-0 overflow-y-auto thin-scroll px-3 pt-4 pb-3 flex flex-col gap-1.5">
        {ITEMS.map(({ vista: v, label, hint, Icon }) => {
          const activo =
            vista === v ||
            (vista === "revision" && v === "escanear");
          return (
            <button
              key={v}
              type="button"
              onClick={() => navegar(v)}
              aria-current={activo ? "page" : undefined}
              className={`group relative flex items-center gap-3.5 w-full text-left rounded-xl px-3.5 min-h-11 transition-all duration-150 border ${
                activo
                  ? "bg-emerald-500/12 border-emerald-500/30 text-emerald-300 shadow-[inset_0_0_20px_rgba(16,185,129,0.06)]"
                  : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5"
              }`}
            >
              {/* Barra indicadora */}
              <span
                aria-hidden
                className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-full transition-all ${
                  activo ? "h-6 bg-emerald-400" : "h-0 bg-transparent"
                }`}
              />
              <Icon className={`w-5 h-5 shrink-0 transition-transform ${activo ? "scale-105" : ""}`} />
              <span className="min-w-0 flex-1">
                <span
                  className={`block font-mono text-[11.5px] font-bold uppercase tracking-wider leading-tight ${
                    activo ? "text-emerald-300" : ""
                  }`}
                >
                  {label}
                </span>
                <span className="block text-[10px] text-slate-400 leading-tight mt-0.5 truncate">
                  {hint}
                </span>
              </span>
              {v === "actas" && actasSesion > 0 && (
                <span className="shrink-0 px-1.5 py-0.5 bg-emerald-500 text-black font-mono font-bold text-[10px] rounded-full shadow-sm tabular-nums">
                  {actasSesion}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Estado de sesión + ayuda */}
      <div className="px-4 pb-5 pt-4 border-t border-slate-800/60 flex flex-col gap-3">
        <div className="flex flex-col gap-2 rounded-2xl bg-[#10161f] border border-slate-800 px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 min-w-0">
              <span className="relative flex h-2 w-2 shrink-0">
                {online && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    online ? "bg-emerald-400" : "bg-red-500"
                  }`}
                />
              </span>
              <span
                className={`font-mono text-[10.5px] font-bold uppercase tracking-wider truncate ${
                  online ? "text-emerald-300" : "text-red-400"
                }`}
              >
                {online ? "En línea" : "Sin conexión"}
              </span>
            </span>
            <span className="font-mono text-[10px] text-slate-400 tabular-nums shrink-0">
              {online ? "" : `COLA ${colaOffline}`}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-slate-800/80 pt-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
              Actas de sesión
            </span>
            <span className="font-mono text-sm font-extrabold text-white tabular-nums">
              {String(actasSesion).padStart(2, "0")}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={abrirAyuda}
          className="flex items-center justify-center gap-2 min-h-11 rounded-xl border border-slate-800 bg-[#10161f] text-slate-300 font-mono text-[11px] font-bold uppercase tracking-wider hover:text-white hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
        >
          <span aria-hidden className="text-emerald-400 font-extrabold">
            ?
          </span>
          Cómo funciona
        </button>

        <p className="text-center text-[9px] text-slate-400 font-mono uppercase tracking-[0.2em]">
          E-14 · Precisión electoral
        </p>
      </div>
    </aside>
  );
}
