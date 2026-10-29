/**
 * KIT e14-puente-supervision-v1 (§4) — RECUPERACIÓN de actas históricas del
 * navegador hacia la cola del puente: las ENVIADAS que quedaron en la cola
 * de la carga masiva (DB `e14-masiva-v1`, store `archivos` — el módulo masiva
 * fue retirado del repo pero sus DBs VIVEN en los dispositivos de campo) y
 * la que esté en el slot de revisión (jornada.ts).
 *
 * Fronteira DEFENSIVA (los registros viejos pueden traer formas variadas y
 * Blobs en las fotos — formato e68): toma `registro.acta` si existe, si no
 * el propio registro SOLO si parece un acta (fotoProcesada|fotoOriginal +
 * status). Todo pasa por mapear.ts — lo no mapeable se cuenta y se salta.
 *
 * REGLAS:
 *  · JAMÁS abre `e14-obs` ni `e14-puente-v1` aquí (la cola del puente solo
 *    se toca vía encolarActa — un solo escritor de forma).
 *  · La DB masiva puede no existir (SIN_DB) → {recuperadas:0, saltadas:0}.
 *  · TODO try/catch silencioso: la recuperación jamás rompe la app.
 */
import { logger } from "../../logger";
import { leerActaEnRevision } from "../jornada";
import { encolarActa } from "./cola";
import { mapearActaAPuente, type ActaMapeable } from "./mapear";

const DB_MASIVA = "e14-masiva-v1";
const VERSION_MASIVA = 1;
const STORE_ARCHIVOS = "archivos";

/** Contador del barrido. */
export interface RecuentoRecuperacion {
  recuperadas: number;
  saltadas: number;
}

/** ¿Parece un acta? (guard de forma para los registros SIN envoltorio). */
function pareceActa(registro: unknown): registro is ActaMapeable {
  if (typeof registro !== "object" || registro === null) return false;
  const r = registro as Record<string, unknown>;
  const conFoto = "fotoProcesada" in r || "fotoOriginal" in r;
  return conFoto && typeof r.status === "string";
}

/** Extraer la forma ActaMapeable de un registro crudo de la cola vieja. */
function actaDeRegistro(registro: unknown): ActaMapeable | null {
  try {
    if (typeof registro !== "object" || registro === null) return null;
    const conActa = registro as { acta?: unknown };
    if (typeof conActa.acta === "object" && conActa.acta !== null) {
      return pareceActa(conActa.acta) ? conActa.acta : null;
    }
    return pareceActa(registro) ? (registro as ActaMapeable) : null;
  } catch {
    return null;
  }
}

/** Barrido del store `archivos` de la cola masiva histórica (getAll — la
 *  cola era de cientos de filas MAX; getAll de una vez es suficiente y el
 *  try/catch cubre cuotas/excepciones). null si la DB no existe. */
async function leerArchivosMasiva(): Promise<unknown[] | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null); // SSR/tests
        return;
      }
      const req = indexedDB.open(DB_MASIVA, VERSION_MASIVA);
      // JAMÁS crear la DB: si el dispositivo nunca tuvo masiva, el open con
      // onupgradeneeded VACÍO falla en versionchange de una DB inexistente…
      // en realidad la crearía vacía — por eso el guard: sin el store, salida
      // honesta (no sembrar DBs nuevas con este barrido).
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_ARCHIVOS)) {
          req.transaction?.abort(); // aborta el open → onerror → null
        }
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_ARCHIVOS)) {
            db.close();
            resolve(null);
            return;
          }
          const getAll = db
            .transaction(STORE_ARCHIVOS, "readonly")
            .objectStore(STORE_ARCHIVOS)
            .getAll();
          getAll.onsuccess = () => {
            db.close();
            resolve(Array.isArray(getAll.result) ? getAll.result : null);
          };
          getAll.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null); // SIN_DB — formato del kit
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Mapear + encolar una acta; true si viajó a la cola. */
async function encolarSiMapea(acta: ActaMapeable): Promise<boolean> {
  const entrada = await mapearActaAPuente(acta);
  if (!entrada) return false;
  await encolarActa(entrada);
  return true;
}

/**
 * Recuperar lo recuperable: cola masiva histórica + slot de revisión.
 * Devuelve {recuperadas, saltadas} — 0/0 en cualquier fallo (SIN_DB, SSR).
 */
export async function recuperarActasPuente(): Promise<RecuentoRecuperacion> {
  const conteo: RecuentoRecuperacion = { recuperadas: 0, saltadas: 0 };
  try {
    // 1) Cola masiva histórica (DB del módulo retirado — solo lectura).
    const registros = await leerArchivosMasiva();
    if (registros) {
      for (const registro of registros) {
        try {
          const acta = actaDeRegistro(registro);
          if (!acta) {
            conteo.saltadas += 1;
            continue;
          }
          if (await encolarSiMapea(acta)) conteo.recuperadas += 1;
          else conteo.saltadas += 1;
        } catch {
          conteo.saltadas += 1; // fila podrida — el barrido sigue
        }
      }
    }

    // 2) Slot de revisión (el actaActual persistida — jornada.ts L305).
    try {
      const enRevision = await leerActaEnRevision();
      if (enRevision && (await encolarSiMapea(enRevision))) {
        conteo.recuperadas += 1;
      }
    } catch {
      /* silencioso — el slot es best-effort */
    }
  } catch {
    /* silencioso — la recuperación jamás rompe la app */
  }
  try {
    if (conteo.recuperadas > 0) {
      logger.info(
        `[e14] puente: recuperación ${conteo.recuperadas} listas · ${conteo.saltadas} saltadas (sin join DIVIPOL o sin foto)`,
      );
    }
  } catch {
    /* silencioso */
  }
  return conteo;
}
