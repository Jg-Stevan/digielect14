/** KIT e14-carga-masiva-v1: tipos del módulo MASIVA — cola de fotos que
 *  alimenta al bridge REAL (mismo pipeline §5, mismo gate). Sin duplicación:
 *  aquí SOLO vive la orquestación. */
import type { Acta } from "../types";

/** KIT e14-masiva-tiempos-v1 (PR-1): DUPLICADA = gemela por hash perceptual
 *  (dhash Hamming ≤ 6, dedup.ts) — estado SOLO visual: al procesar REUTILIZA
 *  el resultado de la original (runner) sin correr el pipeline. «PROCESAR
 *  IGUAL» la devuelve a PENDIENTE (reproceso completo — kit §2). */
export type EstadoEntrada = "PENDIENTE" | "PROCESANDO" | "LISTA" | "ERROR" | "DUPLICADA";

/** Fila LIVIANA en memoria (lo que pinta la bandeja) — NUNCA trae la foto:
 *  RAM acotada (lección L7). El acta completa duerme en IndexedDB. */
export interface FilaMasiva {
  id: string;
  nombre: string;
  agregadaEn: number;
  estado: EstadoEntrada;
  /** Presente cuando estado === "LISTA". */
  statusActa?: Acta["status"];
  score?: number;
  nivel?: string | null; // clasificacion?.nivel
  pagina?: string | null; // "1/2" · "-/-"
  /** Copy corto del motivo de rechazo (acta.rechazo?.tipo). */
  motivo?: string | null;
  thumb?: string; // dataURL JPEG ≤320px, ~20-40 KB
  enviadaAuto?: boolean; // ÓPTIMA → envío automático del runner
  /** KIT e14-masiva-ux-v1 (T3): el envío quedó «EN COLA» (offline —
   *  acta.hashSha256 === "EN COLA"); se drena al reactivar conexión. */
  envioEnCola?: boolean;
  error?: string | null; // estado ERROR (decode/IDB/pipeline)
  /** KIT e14-masiva-tiempos-v1 (PR-1): hash perceptual dhash 64-bit (hex 16,
   *  dedup.ts) calculado al ENCOLAR en background — null si falló el decode. */
  hashDedup?: string | null;
  /** KIT e14-masiva-tiempos-v1 (PR-1): id de la fila ORIGINAL cuando la fila
   *  está DUPLICADA (Hamming ≤ 6) — el runner copia SU resultado. */
  dupOf?: string | null;
  /** D59 — KIT e14-info-acta-filas-v1 (T1): título compuesto con la info
   *  reconocida del acta (idea del dueño, mockup Stitch corregido).
   *  string|null: null = sin datos → la fila solo pinta el nombre de archivo
   *  (honestidad, jamás inventar). */
  infoTitulo?: string | null;
}

/** Registro PERSISTENTE en IndexedDB — el Blob original + el acta completa. */
export interface RegistroMasiva {
  id: string;
  nombre: string;
  agregadaEn: number;
  estado: EstadoEntrada;
  archivo?: Blob; // el File original (queda en IDB, no en RAM)
  acta?: Acta; // desenlace completo (recortable en REVISIÓN)
  /** DESVIACIÓN ADITIVA documentada (kit §3 no lo trae): la miniatura
   *  persiste junto al registro para pintar la bandeja tras recargar —
   *  mismo dataURL ≤320px (~20-40 KB), sigue durmiendo en IDB, no en RAM. */
  thumb?: string;
  /** KIT e14-masiva-ux-v1 (T2): motivo corto de las filas ERROR SIN acta
   *  (guards de extracción/formato — PROTEGIDO_O_CORRUPTO, etc.). */
  error?: string;
  /** KIT e14-masiva-tiempos-v1 (PR-1): dedup persistente — sobrevive la
   *  recarga (la fila sigue DUPLICADA y el runner puede copiar igual). */
  hashDedup?: string;
  dupOf?: string;
  /** D59 — KIT e14-info-acta-filas-v1 (T1): el título compuesto PERSISTE
   *  junto al registro (misma desviación aditiva documentada de thumb) —
   *  la bandeja lo repinta tras recargar sin re-procesar nada. */
  infoTitulo?: string | null;
}

/** KIT e14-carga-masiva-v1 (helper compartido runner/store): página corta del
 *  acta para la fila — "1/2" cuando el OCR la leyó, "-/-" si viajó null
 *  (honestidad del kit actas-vivas-paginas-v1, FASE B). */
export function paginaDeActa(acta: Acta): string {
  return acta.pagina ? `${acta.pagina.index}/${acta.pagina.total}` : "-/-";
}

/** D59 — KIT e14-info-acta-filas-v1 (T1): título compuesto con la info
 *  reconocida del acta (idea del dueño, mockup Stitch corregido) —
 *  "335 EGIPTO - EL CAIRO CONSULADO - DELEGADOS - MESA 001 - PÁG 1 DE 2".
 *  NO exige pipeline nuevo: todos los trozos YA existen en
 *  Acta.clasificacion (ClasificacionE14): departamento {codigo,nombre} ·
 *  puesto.nombre (fallback: acta.titulo) · tipo · mesa (number, zero-pad 3
 *  — mismo estilo del chip REVISIÓN «MESA 012»; fallback: ubicacion.mesa
 *  numérica) · pagina {index,total} (fallback: acta.pagina).
 *  string|null: null = sin datos → la fila solo pinta el nombre de archivo
 *  (honestidad del repo: jamás inventar — PÁG «-/-» cuando es null). */
export function tituloDeActa(acta: Acta): string | null {
  const c = acta.clasificacion;
  const partes: string[] = [];
  const depto = c?.departamento
    ? [c.departamento.codigo, c.departamento.nombre].filter(Boolean).join(" ").trim()
    : null;
  if (depto) partes.push(depto);
  const puesto = c?.puesto?.nombre?.trim() || acta.titulo?.trim() || null;
  if (puesto) partes.push(puesto);
  if (c?.tipo) partes.push(c.tipo);
  const mesa = c?.mesa ?? (/^\d+$/.test(acta.ubicacion?.mesa ?? "") ? Number(acta.ubicacion.mesa) : null);
  if (mesa != null) partes.push(`MESA ${String(mesa).padStart(3, "0")}`);
  const pag = c?.pagina ?? acta.pagina;
  if (pag) partes.push(`PÁG ${pag.index} DE ${pag.total}`);
  const t = partes.join(" - ").toUpperCase();
  return t.length > 0 ? t : null; // sin clasificación ni título → null
}
