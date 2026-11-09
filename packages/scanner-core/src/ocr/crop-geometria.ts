/**
 * Geometría pura de una caja de línea (4 puntos) — UNA sola fuente para el
 * recorte real (`cropLinea`) y para el ratio estimado de los crops perezosos
 * (C2). Si cada uno calcula la geometría por su cuenta, el filtro `leibles` y
 * el ancho del tensor del rec pueden derivar (H5 de la auditoría). Sin DOM ni
 * canvas.
 *
 * Devuelve medidas EXACTAS (sin redondear): el ratio del filtro alimenta
 * `maxRatio` del tensor del rec, y redondear ahí cambiaría px del motor. El
 * redondeo a píxel vive donde el canvas lo exige (cropLinea).
 */
export interface PuntoCaja {
  x: number;
  y: number;
}

export function medidasDeCaja(box: readonly PuntoCaja[]): { w: number; h: number } {
  const d = (a: PuntoCaja, b: PuntoCaja) => Math.hypot(b.x - a.x, b.y - a.y);
  const [p0, p1, p2, p3] = box;
  const w = Math.max(d(p0, p1), d(p2, p3));
  const h = Math.max(d(p0, p3), d(p1, p2));
  return { w, h };
}
