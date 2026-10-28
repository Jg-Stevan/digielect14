"use client";

/**
 * BottomNav — STITCH REDESIGN (SPEC-e14-redesign-stitch §3.1.3, mocks):
 * barra `bg-[#080C0A] border-t border-brand-borderdim/80 px-4 py-2` con
 * 3 ítems flex justify-around.
 *  · Ítem ACTIVO (ESCANEAR): cápsula `w-10 h-8 rounded-full
 *    bg-brand-green/20 border border-brand-green text-brand-green
 *    shadow-[0_0_10px_rgba(0,230,118,0.2)]` + label 10px bold verde.
 *  · Inactivos: icono 20px gris-400 + label 10px medium gris-400.
 *  · ACTAS: conteo real «(N)» en el MISMO label (data-driven del store).
 *  · Home indicator: `w-32 h-1 bg-white/30 rounded-full` (mock 1) /
 *    `h-1 w-28 bg-gray-700/60` (mocks 2-6).
 *  · La vista `revision` sigue contando como ESCANEAR activo (el flujo de
 *    revisión ES el flujo del escáner) — solo presentación, `navegar`
 *    intacto. El slot `children` (CTAs de ReviewCtas) se conserva.
 *  · NOTA (eliminación del módulo masiva): el ítem MASIVA y la regla de
 *    origen (`masivaOrigen` → MASIVA activo en REVISIÓN) se retiraron con
 *    el módulo — REVISIÓN vuelve a activar ESCANEAR, como siempre.
 */
import type { ReactNode } from "react";
import { useE14Store, type Vista } from "@/lib/e14/store";
import {
  StitchCameraIcon,
  StitchDocIcon,
  StitchGrid2Icon,
} from "./icons";

const ITEMS: { vista: Vista; label: string; Icon: typeof StitchCameraIcon }[] = [
  { vista: "escanear", label: "ESCANEAR", Icon: StitchCameraIcon },
  { vista: "actas", label: "ACTAS", Icon: StitchDocIcon },
  { vista: "resumen", label: "RESUMEN", Icon: StitchGrid2Icon },
];

export function BottomNav({ mode = "dark", children }: { mode?: "dark" | "app"; children?: ReactNode }) {
  const vista = useE14Store((s) => s.vista);
  const navegar = useE14Store((s) => s.navegar);
  const actasSesion = useE14Store((s) => s.actasSesion);

  return (
    <footer className="relative z-30 shrink-0 pb-safe">
      {/* Slot de CTAs (modo dark/REVISIÓN): sobre la barra */}
      {children && <div className="max-w-lg mx-auto px-4 pt-1 pb-2">{children}</div>}
      <nav
        className="bg-[#090d12]/92 backdrop-blur-2xl border-t border-slate-800/80 shadow-[0_-8px_32px_rgba(0,0,0,0.55)]"
        aria-label="Navegación principal"
        data-mode={mode}
      >
        <div className="max-w-md mx-auto px-3 py-1.5 flex justify-around items-center">
          {ITEMS.map(({ vista: v, label, Icon }) => {
            const activo =
              vista === v ||
              (vista === "revision" && v === "escanear");
            return (
              <button
                key={v}
                type="button"
                onClick={() => navegar(v)}
                aria-current={activo ? "page" : undefined}
                className="flex flex-col items-center gap-1 group py-1 px-3 select-none transition-all duration-150 min-h-[48px] justify-center"
              >
                <div
                  className={`relative flex items-center justify-center transition-all duration-200 rounded-2xl ${
                    activo
                      ? "w-11 h-8 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shadow-[0_0_14px_rgba(16,185,129,0.22)] scale-105"
                      : "w-9 h-7 text-gray-400 group-hover:text-gray-200 group-hover:bg-white/5"
                  }`}
                >
                  <Icon className={`w-4 h-4 transition-transform duration-150 ${activo ? "scale-105" : ""}`} />
                  {v === "actas" && actasSesion > 0 && (
                    <span className="absolute -top-1 -right-1 px-1.5 py-0.2 bg-emerald-500 text-black font-mono font-bold text-[9px] rounded-full shadow-sm">
                      {actasSesion}
                    </span>
                  )}
                </div>
                <span
                  className={`text-[9.5px] tracking-wider uppercase font-sans transition-colors ${
                    activo ? "font-bold text-emerald-400" : "font-medium text-gray-400 group-hover:text-gray-300"
                  }`}
                >
                  {label}
                  {v === "actas" && actasSesion === 0 ? "" : ""}
                </span>
              </button>
            );
          })}
        </div>
        {/* Home indicator minimalista */}
        <div className="w-24 h-1 bg-white/20 rounded-full mx-auto my-1.5" aria-hidden />
      </nav>
    </footer>
  );
}
