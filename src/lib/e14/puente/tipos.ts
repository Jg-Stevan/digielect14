/**
 * KIT e14-puente-supervision-v2 (§1) — CONTRATO del puente hacia el hub
 * `e14-puente` (Workers — panel de supervisión en vivo del mantenedor).
 *
 * ═══ CONTRATO v1 (Ola 0, bloque 0.7) ═══  El sobre es el mismo; cambian las
 * rutas y la autenticación:
 *
 *   POST {hub}/v1/actas  ← { dispositivo, actas: EntradaPuente[] } (tope 10/lote)
 *        headers x-e14-ts + x-e14-firma (HMAC del body crudo — firma.ts)
 *   GET  {hub}/v1/actas?desde=<epoch ms>  → { ok, ahora, total, actas }
 *        Authorization: Bearer (SOLO el panel — el cliente móvil nunca lee)
 *   POST {hub}/actas  (LEGADO) → 410 {error:"CONTRATO_OBSOLETO"} — el cliente
 *        lo trata como «actualiza la PWA»: pausa la cola + banner, NUNCA como
 *        fallo permanente que marque actas como fallidas (H-4b).
 *
 * · idEnlace — DIVIPOL plano `dept_mun_zona(3dig)_puesto(2dig)` (la llave de
 *   join del receptor; la app la deriva de clasificacion + DIVIPOL).
 * · srcFoto — la foto PROCESADA como dataURL (evidencia real del acta).
 * · impresion — la cabecera IMPRESA del formulario (tal cual el OCR/DIVIPOL
 *   la resolvieron) para que el panel muestre el contexto del papel.
 *
 * REGLA DE ORO del kit: este módulo JAMÁS rompe la app — todo consumidor
 * envuelve en try/catch y degrada a no-op silencioso (mismo criterio §2.4
 * de observabilidad).
 */

/** Versión del contrato hablado (fija la ruta `/v1/actas` — bloque 0.7). */
export const VERSION_CONTRATO = "v1" as const;
/** Ruta de escritura autenticada (el legado `/actas` responde 410). */
export const RUTA_ACTAS = "/v1/actas" as const;

/** Tipo de copia que entiende el receptor (literal de la banda SIN tilde —
 *  igual que TipoCopia de clasificador.ts; d9=3 TRANSMISIÓN · d9=2 CÓNSUL/
 *  EMBAJADOR, que el clasificador ya normaliza a "DELEGADOS"). */
export type FormularioPuente = "TRANSMISION" | "DELEGADOS";

/** Cabecera impresa del formulario (contrato EXACTO del hub). */
export interface ImpresionPuente {
  consulado: string;
  pais: string;
  zona: string;
  puesto: string;
  mesa: string;
  lugar: string;
  barcode?: string;
  etiquetaFormulario?: string;
}

/** Una acta ENVIADA lista para el panel de supervisión (sobre plano). */
export interface EntradaPuente {
  idEnlace: string; // DIVIPOL: dept_mun_zona(3dig)_puesto(2dig)
  mesa: string; // 3 dígitos
  formulario: FormularioPuente;
  paginaIndex: number; // 1-based
  paginaTotal: number; // 1-based
  srcFoto: string | null; // dataURL de la foto PROCESADA (o null)
  impresion: ImpresionPuente;
  nombreArchivo: string; // E14_88_335_005_02_001_TRANSMISION-1.png
  score: number; // 0..10
  statusActa: string; // ActaStatus del desenlace
  /** C-08 — SHA-256 REAL (hex 64) de los BYTES de `srcFoto` (la evidencia
   *  que viaja). Opcional: sobres viejos y contextos sin crypto.subtle viajan
   *  sin él — jamás un hash de relleno (doctrina e14-sin-relleno). */
  hashSha256?: string;
  /** P-22 (plan 2026-11-12) — payload EXACTO del código impreso (capa 0 del
   *  móvil), ya NORMALIZADO (trim+NFKD sin diacríticos+mayúsculas). La capa 2
   *  del anti-reproceso del panel: misma página + mismo payload → DUPLICADA
   *  aunque los bytes de la foto difieran (acta re-fotografiada). Opcional:
   *  sin lectura del código viaja ausente — jamás relleno. */
  qrPayload?: string;
  /** P-22 — dhash64 perceptual (hex 16, dhash horizontal 9×8) de la foto
   *  PROCESADA. Capa 3 del anti-reproceso, respaldo SIN QR legible:
   *  Hamming ≤ 6 (umbral D65) contra el índice del panel decide «misma
   *  imagen». Opcional: sin canvas/crypto disponible viaja ausente. */
  dhash64?: string;
  /** C-07 — epoch ms del momento del gate en el móvil (`Date.now()` al armar
   *  el sobre). Nombre NO reservado del hub (el hub reserva seq/ts/
   *  dispositivo/hashHub); opcional para compatibilidad con sobre viejos. */
  tsEscaneo?: number;
}

/** Estado visible del puente (módulo singleton de envio.ts — la tarjeta de
 *  RESUMEN y el panel dev lo leen; NUNCA mutan). */
export interface EstadoPuente {
  activo: boolean; // kill local tras 5 fallos seguidos → false
  pendientes: number; // snapshot al último recuento (UI — la verdad vive en la cola)
  enviadasOk: number; // acumulado de la sesión
  fallosSeguidos: number; // consecutivos (kill local a los 5)
  ultimoError: string | null;
  ultimaSyncTs: number | null; // epoch ms del último ciclo de envío
  /** H-4b — el hub respondió 410 (contrato obsoleto): la cola queda en pausa
   *  y la UI debe mostrar el banner «actualiza la PWA». No es fallo del acta. */
  contratoObsoleto: boolean;
  /** 0.1 — falta provisionar la clave de jornada en este dispositivo: el
   *  puente NO envía a producción sin firma (falla cerrado, cola intacta). */
  sinClaveJornada: boolean;
}
