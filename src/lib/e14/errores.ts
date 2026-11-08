/**
 * KIT errores-operador-v1 (plan de remediación — bloque 3.1, cierra C5+U1):
 * clasificador de errores del pipeline → MOTIVO DE OPERADOR. La regla del
 * repo (REGLA DE ORO) manda: el fallo jamás rompe la app y JAMÁS se muestra
 * un stack trace al operador — aquí se traduce la excepción interna a un
 * motivo de una unión cerrada con texto accionable en lenguaje de campo.
 *
 * Consumidores: store.ts (catch de dispararEscaneo + cuota IDB del bloque
 * 6.10-parte), useSesionCamara.ts (fallo de reanudación tras
 * visibilitychange, bloque 3.3) y ScanView.tsx (franja del visor con
 * TEXTO_MOTIVO + Reintentar).
 */

/** Motivos de operador (unión cerrada — el UI nunca muestra strings libres).
 *  Los 5 primeros son del plan 3.1; OTRA_PESTANA_ACTIVA (bloque 6.12) y
 *  HEIC_NO_SOPORTADO (F-IMPORT/HEIC) completan la unión para cubrir los
 *  avisos accionables de las demás olas. */
export type MotivoOperador =
  | "CAMARA_NO_DISPONIBLE"
  | "FOTO_ILEGIBLE"
  | "ANALISIS_INCOMPLETO"
  | "ALMACENAMIENTO_LLENO"
  | "OTRA_PESTANA_ACTIVA"
  | "HEIC_NO_SOPORTADO"
  | "ERROR_DESCONOCIDO";

/** Aviso del visor montado en el ESTADO del store (plan 3.1.2): el catch del
 *  pipeline, la cuota IDB y la reanudación de cámara lo setean; ScanView lo
 *  renderiza. Los de tipo "error" NO se autodestruyen (bloque 4.3.1) — solo
 *  salen por Reintentar/descartar; los "info" son pasajeros. */
export interface AvisoOperador {
  tipo: "error" | "info";
  motivo: MotivoOperador;
  /** "reintentar" → ScanView pinta el botón Reintentar (re-dispara el
   *  escaneo; para CAMARA_NO_DISPONIBLE re-abre la cámara). null → solo
   *  descartable (p. ej. ALMACENAMIENTO_LLENO: la acción es del dueño). */
  accion: "reintentar" | null;
  /** Marca de tiempo (desempate/orden — no se persiste). */
  ts: number;
}

/** Extrae nombre/mensaje de un unknown SIN exponer stack (defensivo: los
 *  errores del bridge pueden ser Error, DOMException, strings o rarezas). */
function nombreYMensaje(err: unknown): { nombre: string; mensaje: string } {
  if (err instanceof Error) {
    return { nombre: err.name ?? "", mensaje: err.message ?? "" };
  }
  if (typeof err === "string") return { nombre: "", mensaje: err };
  if (typeof err === "object" && err !== null) {
    const e = err as { name?: unknown; message?: unknown };
    return {
      nombre: typeof e.name === "string" ? e.name : "",
      mensaje: typeof e.message === "string" ? e.message : "",
    };
  }
  try {
    return { nombre: "", mensaje: String(err) };
  } catch {
    return { nombre: "", mensaje: "" };
  }
}

/**
 * Traduce una excepción del pipeline/captura a un motivo de operador.
 * Mapeo por nombre/tipo de error (orden: cámara → cuota → HEIC →
 * tiempos → decode); default honesto ERROR_DESCONOCIDO. Jamás devuelve
 * detalles internos ni stacks — el texto vive en TEXTO_MOTIVO.
 */
export function clasificarErrorPipeline(err: unknown): MotivoOperador {
  const { nombre, mensaje } = nombreYMensaje(err);
  const nombreL = nombre.toLowerCase();
  const msgL = mensaje.toLowerCase();

  // Familia cámara: permiso denegado, cámara ocupada/inexistente o
  // constraints imposibles (la escalera del hook ya agotó sus niveles).
  if (
    nombreL === "notallowederror" ||
    nombreL === "securityerror" ||
    nombreL === "notfounderror" ||
    nombreL === "notreadableerror" ||
    nombreL === "overconstrainederror" ||
    nombreL === "permissiondeniederror"
  ) {
    return "CAMARA_NO_DISPONIBLE";
  }

  // Cuota de almacenamiento (escrituras IDB / persist del slot).
  if (
    nombreL === "quotaexceedederror" ||
    nombreL === "ns_error_dom_quota_reached" ||
    /quota|almacenamiento lleno|storage full/.test(msgL)
  ) {
    return "ALMACENAMIENTO_LLENO";
  }

  // HEIC/HEIF sin conversión posible (F-IMPORT/HEIC del core).
  if (/heic|heif/.test(msgL) || /heic|heif/.test(nombreL)) {
    return "HEIC_NO_SOPORTADO";
  }

  // Tiempos: watchdog del bridge, takePhoto 8 s, deadlines vencidas.
  if (
    nombreL === "timeouterror" ||
    nombreL === "deadlinexceedederror" ||
    /timeout|tiempo de espera|watchdog|vencid|deadline/.test(msgL)
  ) {
    return "ANALISIS_INCOMPLETO";
  }

  // Decode/ilegible: el archivo llegó pero no se pudo leer como imagen.
  if (
    nombreL === "encodingerror" ||
    /decode|decodific|ilegible|corrupt|dañad|no se pudo leer|formato/.test(msgL)
  ) {
    return "FOTO_ILEGIBLE";
  }

  return "ERROR_DESCONOCIDO";
}

/** Texto de operador por motivo (plan 3.1 — lenguaje de campo, sin jerga
 *  interna, con la acción esperada). ScanView pinta esto en la franja. */
export const TEXTO_MOTIVO: Record<MotivoOperador, string> = {
  CAMARA_NO_DISPONIBLE: "No se pudo usar la cámara. Verifica permisos y reintenta.",
  FOTO_ILEGIBLE: "La foto salió ilegible. Acerca el acta al marco y reintenta.",
  ANALISIS_INCOMPLETO: "El análisis no terminó. Reintenta; si persiste, usa recorte.",
  ALMACENAMIENTO_LLENO: "Memoria llena: envía o elimina actas pendientes.",
  OTRA_PESTANA_ACTIVA:
    "La jornada está abierta en otra pestaña. Usa esa pestaña para seguir trabajando.",
  HEIC_NO_SOPORTADO:
    "El formato HEIC no se pudo convertir. Reintenta o sube la foto en JPG.",
  ERROR_DESCONOCIDO: "Algo falló en el análisis. Reintenta.",
};
