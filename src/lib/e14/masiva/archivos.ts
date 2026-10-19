/**
 * KIT e14-masiva-ux-v1 (T2): clasificación y extracción de archivos para la
 * cola MASIVA — imágenes sueltas (con o sin MIME), HEIC/HEIF (el decode ya
 * lo resuelve `fileToCaptureDataUrl` del core DENTRO del pipeline — misma
 * vía que ScanView) y comprimidos .zip/.rar (extracción client-side, sin
 * red). Módulo PURO (sin React) — el store lo consume desde `agregarFiles`.
 *
 * D47: los imports de fflate/node-unrar-js son DIFERIDOS (`await import(...)`)
 * SOLO cuando llega un comprimido — impacto ~0 en el bundle inicial y en el
 * LCP de Vercel (kit §3-T2.1). El wasm de unrar viaja dentro del paquete npm
 * (se le pasa `wasmBinary` explícito — el locateFile del emscripten no sirve
 * en el bundle: `public/**` y `src/assets/**` son intocables, kit §0.3).
 */

/** Entradas de comprimido que son imágenes (por extensión — kit T2.2). */
const EXT_IMAGEN = /\.(jpe?g|png|webp|bmp|gif|avif|heic|heif)$/i;
/** Entradas anidadas: NO se extraen (guard ARCHIVO_ANIDADO). */
const EXT_COMPRIMIDO_ANIDADO = /\.(zip|rar)$/i;
/** Tope de imágenes extraídas por comprimido (kit T2.2). */
const TOPE_POR_COMPRIMIDO = 500;

/**
 * ¿El archivo entra a la cola como imagen? El MISMO criterio de ScanView
 * (F-IMPORT L602-607 — copiado, no inventado): MIME image/* o extensión
 * conocida. HEIC de Android llega con MIME vacío → la extensión manda.
 */
export function pareceImagenMasiva(archivo: File): boolean {
  return (
    archivo.type.startsWith("image/") ||
    /\.(heic|heif|jpe?g|png|webp|bmp|gif|avif)$/i.test(archivo.name)
  );
}

/** Guard del kit T2.2 que NO invalida el lote (viajan junto a las imágenes
 *  extraídas — el store los convierte en filas ERROR con motivo corto). */
export type MotivoExtraccion =
  | "PROTEGIDO_O_CORRUPTO"
  | "ARCHIVO_ANIDADO"
  | "LIMITE_500_POR_COMPRIMIDO";

export interface ErrorExtraccion {
  nombre: string;
  motivo: MotivoExtraccion;
}

/** ADAPTACIÓN documentada (REPORTE §desviaciones): la firma del kit era
 *  `Promise<File[]>`, pero sus PROPIOS guards (anidado dentro del lote +
 *  límite 500 con encolado parcial) exigen devolver también las filas de
 *  error — File[] solo no puede materializarlos. Los errores de contraseña/
 *  corrupción SÍ lanzan (motivo como message — el store crea la fila). */
export interface ResultadoExtraccion {
  archivos: File[];
  errores: ErrorExtraccion[];
}

/** Basename plano para la bandeja (las entradas traen rutas internas). */
function nombreDeEntrada(ruta: string): string {
  return ruta.split("/").pop() ?? ruta;
}

/** File desde una entrada extraída (mismo contenido, nombre plano).
 *  `.slice()` → copia con ArrayBuffer propio (el typing estricto de TS 5.7
 *  no acepta la vista genérica como BlobPart). */
function archivoDeEntrada(nombre: string, datos: Uint8Array): File {
  return new File([datos.slice().buffer as ArrayBuffer], nombre, {
    lastModified: Date.now(),
  });
}

/** Punto de entrada (kit T2.2): .zip → fflate · .rar → node-unrar-js ·
 *  lo demás NO debería llegar aquí (el store clasifica antes). */
export async function extraerArchivo(archivo: File): Promise<ResultadoExtraccion> {
  if (/\.zip$/i.test(archivo.name)) return extraerZip(archivo);
  if (/\.rar$/i.test(archivo.name)) return extraerRar(archivo);
  throw new Error("FORMATO_NO_SOPORTADO");
}

/** ZIP con fflate (sync, ~8 KB). Contraseña/corrupto → unzipSync lanza →
 *  el guard del kit convierte en fila ERROR PROTEGIDO_O_CORRUPTO. */
async function extraerZip(archivo: File): Promise<ResultadoExtraccion> {
  const { unzipSync } = await import("fflate");
  let entradas: Record<string, Uint8Array>;
  try {
    entradas = unzipSync(new Uint8Array(await archivo.arrayBuffer()));
  } catch {
    // fflate no descifra: zip protegido/corrupto/truncado cae aquí.
    throw new Error("PROTEGIDO_O_CORRUPTO");
  }
  const archivos: File[] = [];
  const errores: ErrorExtraccion[] = [];
  for (const [ruta, datos] of Object.entries(entradas)) {
    if (ruta.endsWith("/")) continue; // directorio
    if (EXT_COMPRIMIDO_ANIDADO.test(ruta)) {
      // Kit T2.2: anidado NO se extrae — fila ERROR (por entrada).
      errores.push({ nombre: nombreDeEntrada(ruta), motivo: "ARCHIVO_ANIDADO" });
      continue;
    }
    if (!EXT_IMAGEN.test(ruta)) continue; // sin extensión de imagen → descartada (no es error)
    if (archivos.length >= TOPE_POR_COMPRIMIDO) {
      // Kit T2.2: primeras 500 encoladas + UNA fila ERROR de límite.
      errores.push({ nombre: archivo.name, motivo: "LIMITE_500_POR_COMPRIMIDO" });
      break;
    }
    archivos.push(archivoDeEntrada(nombreDeEntrada(ruta), datos));
  }
  if (!archivos.length && !errores.length) throw new Error("SIN_IMAGENES_DENTRO");
  return { archivos, errores };
}

/** RAR con node-unrar-js (wasm MIT). El wasmBinary viaja EXPLÍCITO desde el
 *  propio paquete (asset de node_modules resuelto por el bundler — ver
 *  cabecera del módulo). Contraseña/corrupto → fila ERROR (kit T2.2). */
async function extraerRar(archivo: File): Promise<ResultadoExtraccion> {
  const [{ createExtractorFromData }, wasmBinario] = await Promise.all([
    import("node-unrar-js"),
    fetchWasmUnrar(),
  ]);
  let extractor: Awaited<ReturnType<typeof createExtractorFromData>>;
  try {
    extractor = await createExtractorFromData({
      wasmBinary: wasmBinario,
      data: await archivo.arrayBuffer(),
    });
  } catch {
    throw new Error("PROTEGIDO_O_CORRUPTO");
  }
  const archivos: File[] = [];
  const errores: ErrorExtraccion[] = [];
  let protegiDoAvisado = false;
  try {
    const extraidos = extractor.extract({});
    for (const entrada of extraidos.files) {
      const cabecera = entrada.fileHeader;
      if (cabecera.flags.directory) continue;
      if (cabecera.flags.encrypted) {
        // Entrada cifrada: el guard del kit manda (una fila por archivo).
        if (!protegiDoAvisado) {
          protegiDoAvisado = true;
          errores.push({ nombre: archivo.name, motivo: "PROTEGIDO_O_CORRUPTO" });
        }
        continue;
      }
      if (EXT_COMPRIMIDO_ANIDADO.test(cabecera.name)) {
        errores.push({
          nombre: nombreDeEntrada(cabecera.name),
          motivo: "ARCHIVO_ANIDADO",
        });
        continue;
      }
      if (!EXT_IMAGEN.test(cabecera.name)) continue; // descartada (no es error)
      const datos = entrada.extraction;
      if (!datos) continue; // entrada fallida (raro) — sin inventar motivos
      if (archivos.length >= TOPE_POR_COMPRIMIDO) {
        errores.push({ nombre: archivo.name, motivo: "LIMITE_500_POR_COMPRIMIDO" });
        break;
      }
      archivos.push(archivoDeEntrada(nombreDeEntrada(cabecera.name), datos));
    }
  } catch (err) {
    const razon = (err as { reason?: string })?.reason ?? "";
    // Contraseña del archivo entero / cabecera cifrada / RAR corrupto.
    if (archivos.length === 0) throw new Error("PROTEGIDO_O_CORRUPTO");
    // Extracción PARCIAL: lo conseguido se encola + fila del fallo.
    errores.push({ nombre: archivo.name, motivo: "PROTEGIDO_O_CORRUPTO" });
    void razon;
  }
  if (!archivos.length && !errores.length) throw new Error("SIN_IMAGENES_DENTRO");
  return { archivos, errores };
}

/** Bytes del unrar.wasm del PROPIO paquete npm (sin red, sin public/).
 *  `new URL(..., import.meta.url)` es el mecanismo de assets estáticos de
 *  los bundlers (webpack/turbopack emiten el archivo junto al chunk). */
async function fetchWasmUnrar(): Promise<ArrayBuffer> {
  const url = new URL("node-unrar-js/esm/js/unrar.wasm", import.meta.url);
  const respuesta = await fetch(url);
  if (!respuesta.ok) throw new Error("PROTEGIDO_O_CORRUPTO");
  return await respuesta.arrayBuffer();
}
