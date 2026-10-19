/** KIT e14-carga-masiva-v1: tipos del módulo MASIVA — cola de fotos que
 *  alimenta al bridge REAL (mismo pipeline §5, mismo gate). Sin duplicación:
 *  aquí SOLO vive la orquestación. */
import type { Acta } from "../types";

export type EstadoEntrada = "PENDIENTE" | "PROCESANDO" | "LISTA" | "ERROR";

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
  error?: string | null; // estado ERROR (decode/IDB/pipeline)
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
}

/** KIT e14-carga-masiva-v1 (helper compartido runner/store): página corta del
 *  acta para la fila — "1/2" cuando el OCR la leyó, "-/-" si viajó null
 *  (honestidad del kit actas-vivas-paginas-v1, FASE B). */
export function paginaDeActa(acta: Acta): string {
  return acta.pagina ? `${acta.pagina.index}/${acta.pagina.total}` : "-/-";
}
