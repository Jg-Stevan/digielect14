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
 *    para restaurar un crash a mitad de REVISIÓN. Solo actas reales
 *    (fuente CAMARA/ARCHIVO); SIMULACIÓN y origen MASIVA jamás ocupan el
 *    slot (la cola masiva ya persiste las suyas). KIT e69: las fotos ya NO
 *    duermen como dataURLs base64 (+33 % de inflación sobre los bytes
 *    reales, 2.4–16.9 MB por acta) sino como Blobs NATIVOS — mismo patrón
 *    e68 de masiva/cola.ts: compactar al escribir, materializar al leer;
 *    el contrato Acta en RAM queda INTACTO (consumidores con dataURLs).
 *    Desenlace ENVIADA → fotoOriginal fuera (liberada — §3 del plan e68).
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

// ─── e69-blob-jornada-v1 — MIGRACIÓN base64 → Blob (fotos del slot) ───
// Mismo patrón e68 de masiva/cola.ts (compactar al escribir, materializar
// al leer) — helpers DUPLICADOS a propósito: extraerlos tocaría cola.ts y
// los QA del repo escanean literales de código ahí (jamás romper suites
// por una refactorización). El contrato Acta NO cambia (consumidores con
// dataURLs en RAM) — la transformación vive SOLO en la frontera IDB.

/** e69 — envoltorio del slot: el acta DUERME sin dataURLs (salen del
 *  structured clone) y las fotos al lado como Blobs nativos. Los registros
 *  previos a e69 guardaban el Acta CRUDO con Strings base64 — se detectan
 *  por ausencia de la llave «acta» (Acta jamás tiene un campo `acta`). */
interface SlotActa {
  acta: Acta;
  fotoOriginalBlob?: Blob;
  fotoProcesadaBlob?: Blob;
}

function esSlotActa(registro: unknown): registro is SlotActa {
  if (typeof registro !== "object" || registro === null) return false;
  const conActa = registro as { acta?: unknown };
  return typeof conActa.acta === "object" && conActa.acta !== null;
}

/** dataURL → Blob: los bytes EXACTOS del base64 (Uint8Array → Blob con su
 *  MIME). null si no parsea (el caller CONSERVA el string — jamás perder
 *  una foto por un parseo). Gemelo de cola.ts (comentario arriba). */
function dataUrlABlob(dataUrl: string): Blob | null {
  // Sin flag `s` (target < es2018): el base64 de canvas/FileReader jamás
  // trae saltos de línea.
  const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] });
  } catch {
    return null;
  }
}

/** Blob → dataURL (FileReader del navegador — determinista: mismos bytes +
 *  MIME ⇒ mismo string; null si falla — el caller sigue sin foto y los
 *  guards existentes degradan honesto). Gemelo de cola.ts. */
function blobADataUrl(blob: Blob): Promise<string | null> {
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

/** e69 §3 — ¿el desenlace ya NO necesita la foto original? ENVIADA (el
 *  envío realizó — reintento/recorte manual son raros, plan §3 del e68) o
 *  DUPLICADA (gemela copiada — su foto ES la de la original). HOY solo
 *  ENVIADA es alcanzable en este slot: DUPLICADA es concepto del runner
 *  MASIVA y el suscriptor del store ya excluye `masivaOrigen` (guard
 *  L1448-1452) — se deja por simetría con el plan (defensiva, un status
 *  futuro no rompería el cleanup). */
function desenlaceSinOriginal(acta: Acta): boolean {
  return acta.status === "ENVIADA" || acta.status === "DUPLICADA";
}

/** e69 §2 — COMPACTAR para IDB: las dataURLs del acta (base64, +33 % en el
 *  structured clone) se HOISTEAN a Blobs nativos del slot y salen de la
 *  copia persistida del acta. Reglas:
 *  · String presente → se convierte; fallo de parseo → el string SE QUEDA
 *    (jamás perder la foto) — salvo cleanup (abajo), que manda sobre todo.
 *  · Cleanup (§3): ENVIADA/DUPLICADA → fotoOriginal FUERA (blob Y string —
 *    «fotoOriginal = null» literal del plan; libera 2.4–16.9 MB/acta).
 *    fotoProcesada SE CONSERVA (REVISIÓN muestra la enviada).
 *  · Actas sin fotos (PENDIENTE de análisis, RECHAZADA temprana) → slot
 *    sin Blobs, sin cambios de forma. */
function compactarActa(acta: Acta): SlotActa {
  let fotoOriginalBlob: Blob | undefined;
  let fotoProcesadaBlob: Blob | undefined;
  let fotoOriginal: string | undefined = acta.fotoOriginal;
  let fotoProcesada: string | undefined = acta.fotoProcesada;
  if (fotoOriginal) {
    const blob = dataUrlABlob(fotoOriginal);
    if (blob) {
      fotoOriginalBlob = blob;
      fotoOriginal = undefined; // sale del acta — duerme como Blob
    }
  }
  if (fotoProcesada) {
    const blob = dataUrlABlob(fotoProcesada);
    if (blob) {
      fotoProcesadaBlob = blob;
      fotoProcesada = undefined; // ídem
    }
  }
  if (desenlaceSinOriginal(acta)) {
    // Cleanup §3: el desenlace ya no necesita la ORIGINAL (blob o string
    // que fuera — «fotoOriginal = null» del plan). Masiva solo baja el
    // Blob (M-e68-2); aquí el string también sale porque el cleanup es el
    // ÚNICO punto donde soltarlo es seguro y explícito.
    fotoOriginalBlob = undefined;
    fotoOriginal = undefined;
  }
  const actaCompacta: Acta = { ...acta };
  if (fotoOriginal) actaCompacta.fotoOriginal = fotoOriginal;
  else delete actaCompacta.fotoOriginal;
  if (fotoProcesada) actaCompacta.fotoProcesada = fotoProcesada;
  else delete actaCompacta.fotoProcesada;
  const slot: SlotActa = { acta: actaCompacta };
  if (fotoOriginalBlob) slot.fotoOriginalBlob = fotoOriginalBlob;
  if (fotoProcesadaBlob) slot.fotoProcesadaBlob = fotoProcesadaBlob;
  // §4 — observabilidad: bytes REALES que duermen en IDB (Blob.size = el
  // monitor de IDB deja de reportar len×4/3 del base64). Solo con foto.
  if (slot.fotoOriginalBlob || slot.fotoProcesadaBlob || fotoOriginal || fotoProcesada) {
    console.info("[e14] memoria acta", {
      statusActa: acta.status,
      fuente: acta.fuente ?? null,
      fotoOriginalBytes: slot.fotoOriginalBlob?.size ?? 0,
      fotoProcesadaBytes: slot.fotoProcesadaBlob?.size ?? 0,
      originalLiberada: !slot.fotoOriginalBlob && !fotoOriginal && desenlaceSinOriginal(acta),
    });
  }
  return slot;
}

/** e69 — MATERIALIZAR al leer: reconstruye las dataURLs del acta desde los
 *  Blobs (contrato Acta en RAM INTACTO — REVISIÓN/recorte/UI las consumen
 *  como siempre). Fallo del FileReader → el campo queda ausente (guards
 *  existentes degradan honesto — jamás inventar). */
async function materializarActa(slot: SlotActa): Promise<Acta> {
  const acta = slot.acta;
  const necesitaOriginal = !acta.fotoOriginal && slot.fotoOriginalBlob;
  const necesitaProcesada = !acta.fotoProcesada && slot.fotoProcesadaBlob;
  if (!necesitaOriginal && !necesitaProcesada) return acta;
  const [fotoOriginal, fotoProcesada] = await Promise.all([
    necesitaOriginal ? blobADataUrl(slot.fotoOriginalBlob as Blob) : Promise.resolve(null),
    necesitaProcesada ? blobADataUrl(slot.fotoProcesadaBlob as Blob) : Promise.resolve(null),
  ]);
  return {
    ...acta,
    ...(fotoOriginal ? { fotoOriginal } : {}),
    ...(fotoProcesada ? { fotoProcesada } : {}),
  };
}

/** Slot del acta en REVISIÓN (null = limpiar el slot). e69: el acta real
 *  se compacta ANTES del put (dataURLs → Blobs — ver compactarActa). */
export async function guardarActaEnRevision(acta: Acta | null): Promise<void> {
  try {
    const db = await abrirJornada();
    const tx = db.transaction(STORE_ACTA, "readwrite");
    tx.objectStore(STORE_ACTA).put(acta ? compactarActa(acta) : null, KEY_ACTA);
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
    const registro = await pedir<SlotActa | Acta | null>(
      db.transaction(STORE_ACTA, "readonly").objectStore(STORE_ACTA).get(KEY_ACTA),
      "IDB_ACTA_LEER",
    );
    if (!registro) return null;
    // Compat pre-e69: registro con dataURLs String dentro del acta (formato
    // anterior) pasa TAL CUAL — el suscriptor del store re-persiste por
    // referencia y su próximo write lo compacta (mismo criterio §2.1 del
    // plan e68: normalizar solo al leer, migración en caliente aparte).
    if (esSlotActa(registro)) return await materializarActa(registro);
    return registro;
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
