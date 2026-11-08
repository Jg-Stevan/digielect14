/**
 * KIT e14-heic-deteccion-temprana-v1 (Ola 6 §6.13 — F20) — detector de HEIC
 * por MAGIC BYTES, el artefacto app-side del kit.
 *
 * Por qué existe AQUÍ y también en el paquete: el punto donde HOY se invoca
 * heic2any es `@jg-stevan/scanner-core/core/image-processor`
 * (`convertHeicToJpegBlob` → `import("heic2any")`), y el paquete NO puede
 * importar código de la app (independencia del motor — misma regla de los
 * helpers gemelos jornada.ts/cola.ts: duplicados a propósito, jamás refactor
 * cruzado que rompa suites). Este módulo es la copia CANÓNICA del lado app:
 *   · `esHeic(bytes)`          — firma ftyp + marca en los primeros 12 bytes.
 *   · `leerPrimerosBytes(blob)`— los bytes para alimentarla (16 bastan).
 *
 * Comportamiento integrado (ver `esHeicMagicBytes`/`cabeceraBlob` del
 * image-processor del paquete): con el rescate ACTIVADO (flags
 * `heicTopeMp > 0`), un archivo cuyos magic bytes dicen HEIC/HEIF se rechaza
 * ANTES de despachar a heic2any con `ErrorRescateHeic` — el camino de error
 * existente de D82 pinta la franja «FOTO HEIC MUY GRANDE · PASA LA ACTA A
 * JPEG» y registra la traza (evento obs `heic:rechazo-temprano` + la línea
 * del bridge/uso del gancho). El kill-switch `{"heicTopeMp":0}` devuelve el
 * camino anterior byte-idéntico (conversión completa) y el `heicLimiteMs`
 * queda como red (watchdog) para lo que pase el olfateo.
 *
 * Formato ISOBMFF: bytes 4-7 = 'ftyp' · bytes 8-11 = marca
 * (heic | heix | mif1 | msf1 — HEIF/HEIC real; AVIF u otras marcas → false).
 */

/** Marcas de contenedor HEIC/HEIF que este producto reconoce. */
const MARCAS_HEIC: ReadonlySet<string> = new Set(["heic", "heix", "mif1", "msf1"]);

/** ¿Los `bytes` comienzan con la firma de un contenedor HEIC/HEIF?
 *  Conservador: sin 12 bytes, sin 'ftyp' o con marca desconocida → false
 *  (lo desconocido NO se rechaza — D23/D41). */
export function esHeic(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const firma = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  if (firma !== "ftyp") return false;
  const marca = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  return MARCAS_HEIC.has(marca);
}

/** Lee los PRIMEROS bytes del blob (16 por defecto — la cabecera ftyp del
 *  ISOBMFF vive ahí y leer 16 bytes cuesta microsegundos aunque el archivo
 *  pese 12 MB). null si la lectura falla (blob cerrado, entorno raro). */
export async function leerPrimerosBytes(blob: Blob, n = 16): Promise<Uint8Array | null> {
  try {
    const buf = await blob.slice(0, n).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}
