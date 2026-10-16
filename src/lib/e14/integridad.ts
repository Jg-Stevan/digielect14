/**
 * KIT identificacion-codigo-v1 (FASE F, Task 120): marcas fiduciales de
 * esquina — señal POSITIVA de «acta completa (sin recortar)». Fuente:
 * ANALISIS §5.1 (docs/research/PATRON-identificacion-actas-e14.md): el acta
 * imprime un cuadrado negro relleno cerca de cada una de las 4 esquinas
 * (visible en las 12 páginas de las muestras). Detecta recortes SUPERIORES
 * que la señal de contenido del kit 118 (`faltaSeccionInferior`, solo
 * inferior: SUMA TOTAL/FIRMA) no ve.
 *
 * Presente = núcleo oscuro CON anillo blanco alrededor (distingue la marca
 * de una mesa oscura / de una esquina recortada). Umbrales ajustables SOLO
 * con comentario `// Fuente:` y evidencia de captura real (§5 del kit).
 * El QR queda FUERA (ANALISIS §6: blob criptográfico opaco — documentado,
 * sin jsQR/zxing: §6 inmutables del kit).
 */

/** tl=sup-izq · tr=sup-der · bl=inf-izq · br=inf-der. */
export interface EsquinasActa {
  tl: boolean;
  tr: boolean;
  bl: boolean;
  br: boolean;
}

/** Todas las esquinas «medidas presentes» — valor NEUTRO para los casos en
 *  que la señal no se puede medir (SIM sin calibrar / decode fallido): la
 *  política del repo es «sin señal honesta no se condena» (página
 *  desconocida → false en faltaSeccionInferior; mismo espíritu). */
export const ESQUINAS_OK: EsquinasActa = { tl: true, tr: true, bl: true, br: true };

/**
 * Marcas fiduciales de esquina sobre el crop YA enderezado (mismo contenido
 * que evalúa calidadDeActa — el bridge le pasa la fotoProcesada warpeada).
 * Canvas mínimo del acta: 80×120 (menos → no medible).
 */
export function marcasEsquina(canvas: HTMLCanvasElement): EsquinasActa {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || canvas.width < 80 || canvas.height < 120)
    return { tl: false, tr: false, bl: false, br: false };
  const W = canvas.width;
  const H = canvas.height;
  const lum = (x0: number, y0: number, w: number, h: number): number => {
    const d = ctx.getImageData(x0, y0, w, h).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4) / 255;
  };
  const esquina = (cx: 0 | 1, cy: 0 | 1): boolean => {
    const x0 = cx === 0 ? Math.round(W * 0.02) : Math.round(W * 0.91);
    const y0 = cy === 0 ? Math.round(H * 0.015) : Math.round(H * 0.955);
    const w = Math.round(W * 0.07);
    const h = Math.round(H * 0.03);
    const nucleo = lum(x0, y0, w, h);
    const anillo = lum(
      Math.max(0, x0 - w),
      Math.max(0, y0 - h),
      Math.min(W, x0 + 2 * w) - Math.max(0, x0 - w),
      Math.min(H, y0 + 2 * h) - Math.max(0, y0 - h),
    );
    // // Fuente: ANALISIS §5.1 (núcleo 2-8% de la esquina oscuro + anillo
    // blanco); umbrales de arranque del kit — a calibrar con captura real
    // (QA G-D del dueño) ANTES de tocarlos.
    return nucleo < 0.45 && anillo > 0.75;
  };
  return { tl: esquina(0, 0), tr: esquina(1, 0), bl: esquina(0, 1), br: esquina(1, 1) };
}

/** Primer LADO faltante (prioridad tl→tr→bl→br) con el copy del aviso
 *  display («RECORTADA sup-izq») — null si las 4 están presentes. */
export function ladoEsquinaFaltante(e: EsquinasActa): string | null {
  if (!e.tl) return "sup-izq";
  if (!e.tr) return "sup-der";
  if (!e.bl) return "inf-izq";
  if (!e.br) return "inf-der";
  return null;
}

/** Traza para el log de auditoría: `esquinas=OK` · `esquinas=FALTA_tl` ·
 *  `esquinas=n/d` (no medible — el null del bridge). */
export function trazaEsquinas(e: EsquinasActa | null): string {
  if (e === null) return "n/d";
  const faltan = (["tl", "tr", "bl", "br"] as const).filter((k) => !e[k]);
  return faltan.length === 0 ? "OK" : `FALTA_${faltan.join("+")}`;
}
