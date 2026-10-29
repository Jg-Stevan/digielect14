/**
 * KIT e14-puente-supervision-v1 (§1) — CONTRATO del puente hacia el hub
 * `supervision-e14` (desplegado en Workers — el panel de supervisión en vivo
 * del dueño). DOMINIO del sobre EXACTO que ya consume el receptor:
 *
 *   POST /actas  ← { dispositivo, actas: EntradaPuente[] } (tope 10/lote)
 *   GET  /actas?desde=<epoch ms>  → { ok, ahora, total, actas }
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
}
