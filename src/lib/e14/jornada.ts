/**
 * KIT L6 (ROADMAP fase lógica): persistencia de la JORNADA — IndexedDB
 * VANILLA (mismo patrón de masiva/cola.ts: cero dependencias nuevas, kit
 * §0.3) para que un cierre de navegador / pestaña matada / batería agotada
 * NO pierda el turno del operador (7 días de votación, celulares gama baja).
 *
 * Qué persiste:
 *  · store «estado» (registro «jornada»): el estado LIVIANO del turno —
 *    archivadas (huecos por mesa), puestoActual, historial (tope 200),
 *    contadores y motivosNoEnvio. SIN fotos, SIN actas completas.
 *  · store «acta» (registro «en-revision»): el actaActual CON sus fotos
 *    (dataURLs ~7-14 MB — IDB lo aguanta, localStorage NO) para restaurar
 *    un crash a mitad de REVISIÓN. Solo actas reales (fuente CAMARA/
 *    ARCHIVO); SIMULACIÓN y origen MASIVA jamás ocupan el slot (la cola
 *    masiva ya persiste las suyas).
 *
 * Qué NO persiste (documentado):
 *  · `mesas` — DERIVADA: se reconstruye de archivadas+puestoActual con
 *    DIVIPOL (mesasRealesDe) al arrancar y al apagar el SIM (fix M10: el
 *    guion del SIM jamás queda quemado como si fuera real).
 *  · `fuente` («nunca se persiste la última fuente», §D1), `online`
 *    (toggle de sesión), `paginaObjetivo` (se recalcula por escaneo),
 *    overlays del SIM (D6: la simulación JAMÁS contamina la jornada real).
 *
 * Errores de IDB NUNCA tumban la app: la jornada vive mejor en RAM que
 * romper el escaneo (mismo criterio del kit carga-masiva §3).
 */
import type { Acta } from "./types";
import type { ActaArchivada, PuestoActual } from "./store";
import type { HistorialRow, Mesa, MesaPagina } from "./types";

const DB_NOMBRE = "e14-jornada-v1";
const DB_VERSION = 1;
const STORE_ESTADO = "estado";
const STORE_ACTA = "acta";
const KEY_ESTADO = "jornada";
const KEY_ACTA = "en-revision";

/** Tope del historial persistido (filas livianas — KBs; crece sin control
 *  en una jornada de 100+ actas con re-escaneos). */
export const TOPE_HISTORIAL = 200;

const VERSION_FORMATO = 1;

/** Estado liviano de la jornada (lo que sobrevive a una recarga). */
export interface EstadoJornada {
  version: number;
  archivadas: Record<string, ActaArchivada>;
  puestoActual: PuestoActual | null;
  historial: HistorialRow[];
  completadas: number;
  asignadasHoy: number;
  actasSesion: number;
  colaOffline: number;
  solicitudesRescaneo: number;
  motivosNoEnvio: Record<string, number>;
}

let dbSingleton: IDBDatabase | null = null;

function abrirJornada(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (dbSingleton) {
      resolve(dbSingleton);
      return;
    }
    if (typeof indexedDB === "undefined") {
      reject(new Error("SIN_INDEXEDDB"));
      return;
    }
    const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ESTADO)) {
        db.createObjectStore(STORE_ESTADO);
      }
      if (!db.objectStoreNames.contains(STORE_ACTA)) {
        db.createObjectStore(STORE_ACTA);
      }
    };
    req.onsuccess = () => {
      dbSingleton = req.result;
      dbSingleton.onclose = () => {
        dbSingleton = null;
      };
      resolve(dbSingleton);
    };
    req.onerror = () => reject(req.error ?? new Error("IDB_JORNADA_NO_ABRIO"));
    req.onblocked = () => reject(new Error("IDB_JORNADA_BLOQUEADA"));
  });
}

function pedir<T>(req: IDBRequest<T>, contexto: string): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(contexto));
  });
}

/** Carga la jornada persistida. null si no hay registro o la versión del
 *  formato no es la esperada (arranque fresco honesto — sin migraciones
 *  frágiles entre versiones de desarrollo). */
export async function cargarJornada(): Promise<EstadoJornada | null> {
  try {
    const db = await abrirJornada();
    const registro = await pedir<EstadoJornada | undefined>(
      db.transaction(STORE_ESTADO, "readonly").objectStore(STORE_ESTADO).get(KEY_ESTADO),
      "IDB_JORNADA_LEER",
    );
    if (!registro || registro.version !== VERSION_FORMATO) return null;
    return registro;
  } catch {
    return null; // IDB caída → arranque fresco (honesto)
  }
}

export async function guardarJornada(estado: EstadoJornada): Promise<void> {
  try {
    const db = await abrirJornada();
    const tx = db.transaction(STORE_ESTADO, "readwrite");
    // FIX (hallazgo E2E): el store «estado» nació SIN keyPath → la clave va
    // EXPLÍCITA en el put (sin ella, put() lanza DataError síncrono y el
    // catch lo tragaba en silencio: la jornada jamás se persistía).
    tx.objectStore(STORE_ESTADO).put(estado, KEY_ESTADO);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IDB_JORNADA_GUARDAR"));
      tx.onabort = () => reject(tx.error ?? new Error("IDB_JORNADA_GUARDAR_ABORTADA"));
    });
  } catch {
    /* la jornada vive en RAM — nunca tumba el flujo */
  }
}

/** Slot del acta en REVISIÓN (null = limpiar el slot). */
export async function guardarActaEnRevision(acta: Acta | null): Promise<void> {
  try {
    const db = await abrirJornada();
    const tx = db.transaction(STORE_ACTA, "readwrite");
    tx.objectStore(STORE_ACTA).put(acta, KEY_ACTA);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IDB_ACTA_GUARDAR"));
      tx.onabort = () => reject(tx.error ?? new Error("IDB_ACTA_GUARDAR_ABORTADA"));
    });
  } catch {
    /* idem — sin slot persistido la REVISIÓN simplemente no se restaura */
  }
}

export async function leerActaEnRevision(): Promise<Acta | null> {
  try {
    const db = await abrirJornada();
    const acta = await pedir<Acta | null>(
      db.transaction(STORE_ACTA, "readonly").objectStore(STORE_ACTA).get(KEY_ACTA),
      "IDB_ACTA_LEER",
    );
    return acta ?? null;
  } catch {
    return null;
  }
}

// ---------- Derivación del guion real (fix M10) ----------

/**
 * Guion REAL de mesas a partir de la jornada archivada — la fuente de
 * verdad de «qué falta» cuando NO hay simulación.
 * Fuente: src/components/e14/screens/ActasView.tsx L156-204 (mesasDelPuesto)
 * — MISMA lógica de mapeo (prefijo de clave DIVIPOL → número de mesa →
 * huecos OK/RESCANEO), extraída para que el STORE también pueda derivar el
 * guion al arrancar la jornada persistida y al APAGAR el SIM (antes el
 * progreso falso del SIM quedaba quemado en `mesas` y `proximaPagina`
 * devolvía null para siempre — auditoría 2-a M10).
 * `total` = countTable DIVIPOL del puesto (null → solo las archivadas).
 */
export function mesasRealesDe(
  archivadas: Record<string, ActaArchivada>,
  puesto: PuestoActual,
  total: number | null,
): Mesa[] {
  const prefijo = `${puesto.clave}-`;
  const porNumero = new Map<number, ActaArchivada>();
  for (const [clave, entrada] of Object.entries(archivadas)) {
    if (!clave.startsWith(prefijo)) continue;
    const numero = Number.parseInt(clave.slice(prefijo.length), 10);
    if (Number.isFinite(numero)) porNumero.set(numero, entrada);
  }
  const construir = (numero: number, entrada: ActaArchivada | undefined): Mesa => {
    const totalPag = Math.min(2, entrada?.clasificacion.pagina?.total ?? 2);
    const paginas: MesaPagina[] = [];
    for (const tipo of ["DELEGADOS", "TRANSMISIÓN"] as const) {
      for (let p = 1; p <= totalPag; p += 1) {
        paginas.push({
          tipo,
          pagina: p as 1 | 2,
          estado:
            entrada?.huecos.find((h) => h.tipo === tipo && h.pagina === p)?.estado ??
            ("PENDIENTE" as const),
        });
      }
    }
    const ocupadas = paginas.filter((p) => p.estado === "OK").length;
    return {
      id: `MESA ${String(numero).padStart(2, "0")}`,
      estado:
        ocupadas === 0 ? "PENDIENTE" : ocupadas === paginas.length ? "COMPLETADA" : "EN_PROCESO",
      progresoPct: Math.round((ocupadas / paginas.length) * 100),
      paginas,
    };
  };
  const numeros =
    total != null
      ? Array.from({ length: total }, (_, i) => i + 1)
      : [...porNumero.keys()].sort((a, b) => a - b);
  const lista = numeros.map((n) => construir(n, porNumero.get(n)));
  for (const [n, entrada] of porNumero) {
    if (total != null && n > total) lista.push(construir(n, entrada));
  }
  return lista;
}
