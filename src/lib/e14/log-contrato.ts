/**
 * 7.9 (plan de remediación, cierra C4) — CONSTRUCTOR ÚNICO del log-contrato
 * D51. El contrato son los tokens grep-ables de la traza de auditoría
 * (`[e14] pipeline … total=…ms (decode=… motor=…)` y su espejo de recorte):
 * hasta hoy se construía por CONCATENACIÓN MANUAL de ~30 líneas en los DOS
 * pipelines, con la regla «tokens NUEVOS AL FINAL» sostenida a pulso y sin
 * test de formato. Aquí la regla es CÓDIGO:
 *
 *  · los tokens conocidos se emiten en `ordenFijo` (el contrato canónico,
 *    con huecos: la clave ausente no emite nada — `votos=… SIN_VOTOS
 *    recortada=1` vs `votos=skip-pag2` comparten orden);
 *  · cualquier token FUERA de `ordenFijo` se añade AL FINAL, en orden de
 *    inserción — la regla D51 de los campos aditivos, imposible de violar
 *    por accidente;
 *  · `true` emite el token desnudo (el `SIN_VOTOS` histórico), `false` no
 *    emite nada (condicional apagado), string/number emite `k=v`.
 *
 * Formato de salida byte-idéntico al de la concatenación manual que
 * reemplaza (golden: log-contrato.test.ts — casos de oro del formato real).
 * Los token REPETIDOS del contrato real (`ocr=` aparece como ms del OCR y
 * como `ocr=rapidocr`) viajan como entradas duplicadas: `ordenFijo` las
 * consume en orden — un `Record` no puede expresarlo, por eso la entrada es
 * una lista de pares y no un objeto.
 */

/** Valor de un token: `true` = token DESNUDO (el `SIN_VOTOS` histórico — el
 *  único del contrato) · `false` = condicional apagado, omitido ·
 *  string/number = `k=v` (los flags `ocrValido=true` / `recortada=1` viajan
 *  como `String(...)` / `1`, no como boolean). */
export type CampoD51 = string | number | boolean;

/** Entrada `[clave, valor]` — lista (no Record) porque el contrato real
 *  tiene tokens duplicados (`ocr`). */
export type EntradaD51 = readonly [string, CampoD51];

/**
 * Orden canónico del segmento entre paréntesis del log-contrato D51 (el
 * `(...)` tras `total=…ms`). SUPERCONJUNTO de los dos logs: el escaneo trae
 * decode/detect y el recorte manual/escudo-manual — las claves ausentes no
 * emiten. La lista es la autoridad: añadir tokens NUEVOS al FINAL de esta
 * lista es el cambio de contrato documentado (kit §4-A.3).
 */
export const ORDEN_LOG_D51: readonly string[] = [
  // tiempos por etapa (el escaneo trae decode/detect; el recorte no)
  "decode",
  "detect",
  "proceso",
  "calidad",
  // motor del warp + OCR (el primer `ocr=` son los ms; el segundo es rapidocr)
  "ocr",
  "motor",
  "ocrValido",
  "cabeceraE14",
  // gate: completa/senal/vacia/votos (+ condicionales del sitio)
  "completa",
  "senal",
  "vacia",
  "votos",
  "SIN_VOTOS",
  "recortada",
  "lado",
  "lazo",
  "esquinas",
  // evidencia del guard-borde (§3c) y trazas as-is/manual
  "recorte",
  "borde",
  "tintaFilo",
  "franja",
  "fondo",
  "perdon",
  "manual",
  "escudo-manual",
  // quad + score-lectura + desenlace
  "quad",
  "piso10",
  "origen",
  "score",
  "filtro",
  "ocrIn",
  "ocr", // 2ª aparición: `ocr=rapidocr` (el par duplicado se consume en orden)
  "conf",
  "det",
  "rec",
  "lectura",
  "anclas",
  "piso",
  "clasif",
  "crop",
  "metricas",
];

/**
 * Construye la línea de tokens `k=v` del contrato D51.
 *
 * @param entradas  pares [clave, valor] EN ORDEN de inserción (los
 *                  condicionales se añaden solo cuando aplican).
 * @param ordenFijo orden canónico (típicamente `ORDEN_LOG_D51`); vacío =
 *                  todos los tokens van al final en orden de inserción
 *                  (el sufijo del paréntesis — sim/diag/detectOrigen/…).
 * @returns tokens separados por UN espacio — listo para interpolar entre el
 *          prefijo `[e14] … total=…ms (` y el `)` de cierre.
 */
export function construirLogD51(
  entradas: readonly EntradaD51[],
  ordenFijo: readonly string[],
): string {
  const consumidas = new Array<boolean>(entradas.length).fill(false);
  const emitidas: string[] = [];
  const emitir = ([clave, valor]: EntradaD51): void => {
    if (valor === false) return; // condicional apagado — el token no existe
    emitidas.push(valor === true ? clave : `${clave}=${valor}`);
  };
  // 1) pase canónico: cada clave de ordenFijo consume su PRIMERA entrada
  //    no consumida (soporta claves duplicadas como `ocr`).
  for (const clave of ordenFijo) {
    const idx = entradas.findIndex((e, i) => !consumidas[i] && e[0] === clave);
    if (idx === -1) continue; // hueco del contrato: la clave no aplica aquí
    consumidas[idx] = true;
    emitir(entradas[idx]);
  }
  // 2) campos aditivos: los no consumidos van AL FINAL, en inserción —
  //    la regla D51 («tokens NUEVOS AL FINAL») como código.
  entradas.forEach((entrada, i) => {
    if (!consumidas[i]) {
      consumidas[i] = true;
      emitir(entrada);
    }
  });
  return emitidas.join(" ");
}
