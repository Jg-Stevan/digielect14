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
  /** D66 — KIT e14-decode-unico-precalor-v1 (T3.2/T3.5): flag TRANSITORIO
   *  del precalor — esta fila PENDIENTE ya tiene master (blob JPEG a escala
   *  de trabajo) esperando en el mapa del precalor. SOLO memoria del
   *  mini-store: NUNCA viaja a IDB (al recargar se pierde y el precalor
   *  vuelve a precalentar si aplica — kit T3.2 literal). El chip PREPARADA
   *  de la bandeja lo pinta; consumirMaestro/descartarMaestro lo limpian. */
  precalentada?: boolean;
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
  // ---------- D66 — KIT e14-decode-unico-precalor-v1 (T4) ----------
  /** ms SOLO del decodificado a MASTER (T4: separado de procesoMs, que
   *  conserva su semántica). Filas precalentadas → 0 (el decode ya pasó en
   *  el precalor; el coste vive en precalorMs). Sin master (fallback a la
   *  ruta de siempre / fila ERROR / registros previos) → campo AUSENTE
   *  (jamás inventar). */
  decodeMs?: number;
  /** D66 (T4): quién fabricó el master — el decode nativo del navegador o
   *  la reserva wasm (heic2any). null/ausente = sin master (fallback). */
  origenDecode?: "nativo" | "wasm" | null;
  /** D66 (T4): el desenlace nació de un master PRECALENTADO (el runner lo
   *  consumió del precalor — decode ≈ 0). Documenta el PROVENANCE del
   *  desenlace y SÍ persiste (a diferencia del flag transitorio de
   *  FilaMasiva, que es estado vivo de la cola). */
  precalentada?: boolean;
  /** D66 (T4): ms TOTALES del precalor para esta fila (solo precalentadas;
   *  null = no precalentada). */
  precalorMs?: number | null;

  // ─── D65 — KIT e14-progreso-watchdog-dedup-v1: trazas aditivas (kit T1.4/T2.3) ───
  // REPARACIÓN del merge #57: el resolver PISÓ este bloque con el de D66
  // (ambos son aditivos — deben CONVIVIR). Contrato D57: campos NUEVOS AL
  // FINAL — los previos no cambian de nombre ni de lugar. Ausente = registro
  // pre-D65 (el instrumento no existía); JAMÁS se inventa un valor.

  /** (T1) intentos consumidos por el watchdog: 0 = ningún intento murió;
   *  1 = el 1.º venció a los 75 s y el reintento tomó el desenlace;
   *  2 = ambos vencieron → rechazo de siempre con trazas. Solo filas que
   *  pasaron por el pipeline (la gemela copiada no corre pipeline → sin campo). */
  watchdog?: number;
  /** (T1) etapa del pipeline al morir el ÚLTIMO intento vencido — vocabulario
   *  del kit: "decodificando" | "deteccion" | "ocr" | "verificacion". El
   *  recorte/realce caen en "deteccion" (cola de la fase de encuadre).
   *  null/ausente = sin señal de progreso antes de morir (jamás inventar). */
  etapaAlMorir?: string | null;
  /** (T1) duración (ms) del intento que murió — hoy era null y escondía los
   *  ~175 s del informe 20261020-122235. null/ausente = sin dato. */
  elapsedMs?: number | null;
  /** (T2) dedup v2 por CONTENIDO: "v2" = gemela matcheada (Hamming ≤ 6);
   *  "sin-match" = hasheada sin gemela. Ausente = pre-D65 o hash falló
   *  (decode — la fila procesa normal, conservador). */
  dedup?: "v2" | "sin-match";
  /** (T2) distancia de Hamming del match v2 (0–64). Solo filas con
   *  dedup === "v2" lo traen; sin match no hay distancia (no se inventa). */
  dedupDistancia?: number | null;
}

/** KIT e14-carga-masiva-v1 (helper compartido runner/store): página corta del
 *  acta para la fila — "1/2" cuando el OCR la leyó, "-/-" si viajó null
 *  (honestidad del kit actas-vivas-paginas-v1, FASE B). */
export function paginaDeActa(acta: Acta): string {
  return acta.pagina ? `${acta.pagina.index}/${acta.pagina.total}` : "-/-";
}

/** D59 — KIT e14-info-acta-filas-v1 (T1) · REVISIÓN D59REV — KIT
 *  e14-titulo-compacto-v1: título compuesto con la info reconocida del acta,
 *  EXACTAMENTE como el diseño (decisión textual del dueño: «Según el diseño
 *  solo aparece el país-puesto, mesa, d/t, pág. Déjalo así, porque no cabe
 *  tanta info en el espacio»):
 *
 *  "{dep.codigo} {dep.nombre} - {puesto.nombre} - {tipo} - MESA {nnn} - PAG {i} DE {t}"
 *
 *  (unido con " - ", en mayúsculas). Contrato CONGELADO (D59REV §2):
 *  · Campos SOLO de ClasificacionE14 — único fallback honesto: puesto →
 *    acta.titulo (tabla §0 del kit). Se ELIMINAN los fallbacks
 *    ubicacion.mesa/acta.pagina del D59 (no están en el diseño).
 *  · Campo ausente → se OMITE ese trozo y sus guiones sobrantes (jamás
 *    «—», «N/A» ni vacíos). Prohibido AGREGAR nada (T2): sin municipio,
 *    score, nivel, tiempos, «ACTA», ni segundo renglón.
 *  · SIN clasificacion → null → la fila solo pinta el nombre de archivo
 *    (mata el leak de la plantilla ACTA_MOCK «ROMA - CONSULADO» del D59,
 *    hallazgo §2 de su REPORTE).
 *  · PAG solo si hay index Y total, SIN tilde («PAG 1 DE 2» — mockup).
 *  · Mesa zero-pad 3 («MESA 001», mismo estilo del chip REVISIÓN).
 *  · La fila lo pinta con truncate + title= (MasivaView D59 T4 intacto). */
export function tituloDeActa(acta: Acta): string | null {
  const c = acta.clasificacion;
  if (!c) return null; // D59REV: sin clasificación NUNCA hay título (honestidad)
  const partes: string[] = [];
  const depto = c.departamento
    ? [c.departamento.codigo, c.departamento.nombre].filter(Boolean).join(" ").trim()
    : null;
  if (depto) partes.push(depto);
  const puesto = c.puesto?.nombre?.trim() || acta.titulo?.trim() || null;
  if (puesto) partes.push(puesto);
  if (c.tipo) partes.push(c.tipo);
  if (c.mesa != null) partes.push(`MESA ${String(c.mesa).padStart(3, "0")}`);
  if (c.pagina && c.pagina.index != null && c.pagina.total != null)
    partes.push(`PAG ${c.pagina.index} DE ${c.pagina.total}`);
  const t = partes.join(" - ").toUpperCase();
  return t.length > 0 ? t : null;
}
