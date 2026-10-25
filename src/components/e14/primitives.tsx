/**
 * Primitivas del design system STITCH (SPEC-e14-redesign-stitch §1/§3.2).
 * Todo re-vestido con los tokens canónicos del ZIP — NADA del tema
 * anterior (AC9). Tone: "ok" | "warn" | "crit" | "neutral".
 * "use client";
 */

import type { ReactNode } from "react";

/** Tono del design system STITCH — interno del módulo (de-export 3B-B1c:
 *  sin consumidores externos; lo usan Chip/SegmentedBar/etc. de aquí). */
type Tone = "ok" | "warn" | "crit" | "neutral";

const toneDot: Record<Tone, string> = {
  ok: "bg-[#10b981]",
  warn: "bg-[#f59e0b]",
  crit: "bg-[#E52222]",
  neutral: "bg-slate-400",
};

const toneText: Record<Tone, string> = {
  ok: "text-[#10b981]",
  warn: "text-[#f59e0b]",
  crit: "text-[#E52222]",
  neutral: "text-slate-400",
};

/** Chip del chrome (mock §3.2.3): `grid grid-cols-3 gap-2` — el ACTIVO es
 *  relleno sólido del color del estado (mono extrabold xs), los otros 2
 *  surfaceLight con borde. `solid` = relleno del tono. */
export function Chip({
  tone = "neutral",
  solid = false,
  children,
  className = "",
}: {
  tone?: Tone;
  solid?: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (solid) {
    return (
      <span
        className={`py-2 px-2.5 rounded-xl font-mono font-bold text-xs tracking-wider uppercase shadow-md flex items-center justify-center transition-all ${
          tone === "ok"
            ? "bg-[#10b981] text-[#090d12] shadow-[#10b981]/20 font-extrabold"
            : tone === "warn"
              ? "bg-[#f59e0b] text-[#090d12] shadow-[#f59e0b]/20 font-extrabold"
              : tone === "crit"
                ? "bg-[#E52222] text-white shadow-[#E52222]/25 font-extrabold"
                : "bg-slate-800 text-slate-200 border border-slate-700"
        } ${className}`}
      >
        {children}
      </span>
    );
  }
  return (
    <span
      className={`py-2 px-2.5 rounded-xl bg-[#10161f]/90 border border-slate-800 text-slate-200 font-mono font-semibold text-xs tracking-wider uppercase flex items-center justify-center backdrop-blur-sm shadow-sm ${className}`}
    >
      {children}
    </span>
  );
}

/** Barra segmentada (4px) para datos fraccionarios. */
export function SegmentedBar({
  total,
  filled,
  tone = "ok",
  className = "",
}: {
  total: number;
  filled: number;
  tone?: Tone;
  className?: string;
}) {
  const safeTotal = Math.max(1, total);
  return (
    <div
      className={`flex items-center gap-1 w-full h-1.5 ${className}`}
      role="progressbar"
      aria-valuenow={filled}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      {Array.from({ length: safeTotal }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 flex-1 rounded-[2px] transition-all duration-300 ${
            i < filled ? toneDot[tone] : "bg-slate-800/80"
          }`}
        />
      ))}
    </div>
  );
}

/** Botón de la fila de acciones de revisión (Recortar · Rotar 90° ·
 *  Pantalla completa — mock §3.2.5): `py-2 px-2 rounded-xl bg-brand-surface
 *  border border-brand-border text-gray-300 text-xs`. La fila es NEUTRA
 *  (el estado vive en esquinas AR + píldora flotante — la prop `tone`
 *  queda aceptada por compat y NO pinta nada especial). `active` (F-OCR
 *  D39) solo cambia el tinte (borde + texto verde), mismo tamaño. */
export function ToolbarBtn({
  icon,
  label,
  onClick,
  active = false,
  ariaLabel,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  /** D39/F-OCR: distingue el botón cuando ya hay texto reconocido. */
  active?: boolean;
  /** Compat — ignorado (fila neutra, SPEC §3.2.5). */
  tone?: "crit";
  /** G4 (KIT camara-visor-v1): ARIA específico cuando el label corto no
   *  describe la acción completa (p. ej. «Imagen» → «Descargar imagen en
   *  alta calidad»). */
  ariaLabel?: string;
}) {
  const inhabilitado = !onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={inhabilitado}
      aria-disabled={inhabilitado || undefined}
      aria-label={ariaLabel}
      className={`min-h-11 py-2 px-2 rounded-xl border font-sans font-medium text-xs flex items-center justify-center gap-1.5 transition-all duration-150 leading-tight text-center active:scale-[0.98] ${
        active
          ? "bg-[#10b981]/15 border-[#10b981]/50 text-[#10b981] shadow-sm shadow-[#10b981]/10"
          : "bg-[#10161f] border-slate-800 text-slate-300 hover:bg-[#17222f] hover:text-white hover:border-slate-700"
      } ${inhabilitado ? "opacity-35 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span className={`shrink-0 flex items-center justify-center ${active ? "text-[#10b981]" : "text-slate-400"}`}>
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Botón CTA grande del footer (mocks 2-6):
 *  · ok → verde sólido «SEGUIR ESCANEANDO» (py-3.5 rounded-2xl, glow verde)
 *  · crit → rojo sólido «OBLIGATORIO REPETIR FOTO» (py-3.5-4, glow rojo)
 *  · warn → ámbar outline «REPETIR FOTO» (py-2.5 rounded-xl mono)
 *  · outline / outline-* → REVISIÓN HUMANA surface/border (§3.2.6). */
export function PrimaryBtn({
  variant = "ok",
  onClick,
  icon,
  children,
  ariaLabel,
  disabled = false,
}: {
  variant?: "ok" | "warn" | "crit" | "outline" | "outline-crit" | "outline-warn";
  onClick?: () => void;
  icon?: ReactNode;
  children: ReactNode;
  ariaLabel?: string;
  /** Panel §5: GUARDAR UBICACIÓN hasta completar la cascada. */
  disabled?: boolean;
}) {
  const base =
    "flex-1 min-w-0 px-4 flex items-center justify-center gap-2 uppercase tracking-wider leading-tight text-center transition-all duration-150 active:scale-[0.98] cursor-pointer select-none";
  const styles: Record<string, string> = {
    ok: "bg-[#10b981] hover:bg-[#059669] text-[#090d12] font-black text-sm py-3.5 px-6 rounded-2xl shadow-[0_4px_24px_rgba(16,185,129,0.35)]",
    crit: "bg-[#E52222] hover:bg-red-600 text-white font-black text-xs sm:text-sm py-3.5 rounded-2xl shadow-[0_4px_24px_rgba(229,34,34,0.4)]",
    warn: "bg-[#10161f] hover:bg-[#17222f] border border-amber-500/80 text-amber-400 font-mono font-bold text-xs py-3 rounded-xl shadow-sm",
    outline:
      "bg-[#10161f] hover:bg-[#17222f] border border-slate-700 text-slate-200 font-bold text-xs py-3.5 rounded-2xl",
    "outline-crit":
      "bg-[#10161f] hover:bg-[#17222f] border border-red-500/50 text-red-400 font-bold text-xs py-3.5 rounded-2xl",
    "outline-warn":
      "bg-[#10161f] hover:bg-[#17222f] border border-amber-500/50 text-amber-400 font-bold text-xs py-3.5 rounded-2xl",
  };
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-disabled={disabled}
      className={`${base} ${styles[variant]} ${disabled ? "opacity-40 cursor-not-allowed shadow-none active:scale-100" : ""}`}
    >
      {icon && (
        <span
          className={`shrink-0 flex items-center justify-center ${
            variant === "ok" ? "text-[#090d12]" : toneText[variant === "crit" ? "crit" : variant === "warn" ? "warn" : "neutral"]
          }`}
        >
          {icon}
        </span>
      )}
      <span>{children}</span>
    </button>
  );
}
