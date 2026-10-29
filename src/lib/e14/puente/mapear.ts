/**
 * KIT e14-puente-supervision-v1 (§3) — MAPEADOR Acta → EntradaPuente (PURE:
 * sin estado global, sin I/O salvo el FileReader del helper blobADataUrl —
 * los registros recuperados de IDB pueden traer la foto como Blob, kit e68).
 *
 * JOIN DIVIPOL ESTRICTO (el receptor cruza por idEnlace): una acta solo es
 * mapeable con clasificación COMPLETA — departamento + municipio + puesto
 * (código) + mesa + página + tipo de copia. Si falta CUALQUIER pieza → null
 * (el acta se SALTA: es un acta sin join, no un error del puente).
 *
 * Mapeo de TipoCopia (verificado en clasificador.ts L30):
 *   `type TipoCopia = "TRANSMISION" | "DELEGADOS"` — la banda se lee SIN
 *   tilde y d9=2 (CÓNSUL/EMBAJADOR del código 1D) ya se normaliza a
 *   "DELEGADOS" en tipoDeDigito(). Por tanto el mapeo es IDENTIDAD:
 *   "TRANSMISION" → "TRANSMISION" · "DELEGADOS" → "DELEGADOS"; cualquier
 *   otro valor (tipo null / desconocido) → null (se salta).
 */
import type { Acta } from "../types";
import type { ClasificacionE14, TipoCopia } from "../clasificador";
import type { EntradaPuente, FormularioPuente, ImpresionPuente } from "./tipos";

/** Acta mapeable: igual al contrato Acta pero tolerante a la foto como Blob
 *  (formato e68 de la cola histórica — el slot en RAM siempre trae string). */
export type ActaMapeable = Omit<Acta, "fotoProcesada"> & {
  fotoProcesada?: string | Blob;
};

/** Blob → dataURL (FileReader del navegador — null si falla; el caller
 *  salta el acta en vez de inventar una foto). Gemelo de jornada.ts. */
export function blobADataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const lector = new FileReader();
      lector.onload = () =>
        resolve(typeof lector.result === "string" ? lector.result : null);
      lector.onerror = () => resolve(null);
      lector.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
  });
}

/** Código DIVIPOL que puede llegar como string o number → string limpio.
 *  null/undefined/… → null (el join se salta). */
function codigoDe(valor: string | number | undefined | null): string | null {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  return s.length > 0 ? s : null;
}

/** Formulario del receptor a partir del TipoCopia REAL del clasificador —
 *  identidad (ver comentario de cabecera); otro valor → null. */
function formularioDe(tipo: TipoCopia | null | undefined): FormularioPuente | null {
  if (tipo === "TRANSMISION") return "TRANSMISION";
  if (tipo === "DELEGADOS") return "DELEGADOS";
  return null;
}

/**
 * Mapear un acta ENVIADA al sobre del hub. null = no mapeable (sin join
 * DIVIPOL completo o sin foto procesada) — el caller la salta en silencio.
 */
export async function mapearActaAPuente(
  acta: ActaMapeable,
): Promise<EntradaPuente | null> {
  try {
    // Foto PROCESADA obligatoria (string dataURL; Blob → FileReader).
    let srcFoto: string | null = null;
    if (typeof acta.fotoProcesada === "string" && acta.fotoProcesada.length > 0) {
      srcFoto = acta.fotoProcesada;
    } else if (acta.fotoProcesada instanceof Blob) {
      srcFoto = await blobADataUrl(acta.fotoProcesada);
    }
    if (!srcFoto) return null;

    // Clasificación completa (join DIVIPOL) — una pieza ausente → saltar.
    const c: ClasificacionE14 | undefined = acta.clasificacion;
    if (!c) return null;
    const dept = codigoDe(c.departamento?.codigo);
    const mun = codigoDe(c.municipio?.codigo);
    const zona = codigoDe(c.zona?.codigo);
    const puesto = codigoDe(c.puesto?.codigo);
    if (!dept || !mun || !puesto || c.mesa == null || !c.pagina) return null;
    const formulario = formularioDe(c.tipo);
    if (!formulario) return null;

    // Piezas normalizadas del contrato (DIVIPOL plano del hub).
    const zonaPad = (zona ?? "000").padStart(3, "0"); // zona null → "000"
    const puestoPad = puesto.padStart(2, "0");
    const mesa = String(c.mesa).padStart(3, "0");
    const idEnlace = `${dept}_${mun}_${zonaPad}_${puestoPad}`;

    const nombreMun = c.municipio?.nombre ?? "";
    const nombrePuesto = c.puesto?.nombre ?? "";
    const impresion: ImpresionPuente = {
      consulado: dept,
      pais: `${mun} - ${nombreMun}`,
      zona: zonaPad,
      puesto: puestoPad,
      mesa,
      lugar: `${nombreMun} - ${nombrePuesto}`,
      ...(acta.codigoBarras ? { barcode: acta.codigoBarras } : {}),
      etiquetaFormulario:
        formulario === "TRANSMISION" ? "TRANSMISIÓN" : "CÓNSUL/EMBAJADOR",
    };

    return {
      idEnlace,
      mesa,
      formulario,
      paginaIndex: c.pagina.index,
      paginaTotal: c.pagina.total,
      srcFoto,
      impresion,
      nombreArchivo: `E14_${[dept, mun, zonaPad, puestoPad].join("_")}_${mesa}_${formulario === "DELEGADOS" ? "CONSUL_EMBAJADOR" : "TRANSMISION"}-${c.pagina.index}.png`,
      score: acta.score,
      statusActa: acta.status,
    };
  } catch {
    return null; // jamás romper por un mapeo (regla de oro del kit)
  }
}
