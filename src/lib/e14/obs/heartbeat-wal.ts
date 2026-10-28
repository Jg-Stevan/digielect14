/**
 * KIT e14-obs-hang-atribucion-v1 (§C.2, T3) — WRITE-AHEAD LOG del hang
 * EN CURSO (DB PROPIA `e14-hang-wal` v1 — jamás abrir `e14-obs` ni la de
 * la cola masiva: patrón buffer.ts).
 *
 * EL PUNTO CIEGO ESTRUCTURAL (§0): un `longtask` solo emite al TERMINAR y
 * el drift al REANUDAR — el hang que dispara «Página no responde» y muere
 * con la página JAMÁS se registra. Este WAL es la marca que SOBREVIVE:
 *  (i)   el main reanuda → beats vuelven → el worker BORRA la marca (el
 *        drift ya contó ese hang completo);
 *  (ii)  la página muere LIMPIO → `pagehide` → lápida (best-effort);
 *  (iii) la página muere COLGADA → el main colgado no procesa pagehide →
 *        la marca SOBREVIVE → el próximo arranque la drena y emite el
 *        hang que hoy es invisible (cierre del punto ciego).
 *
 * NÚCLEO PURO y exportado (testeado sin IDB): `debeMarcar` ·
 * `debeDesmarcar` · `decidirDrenaje` · `eventoDeMarca`. El acceso IDB
 * (worker o main) es try/catch SILENCIOSO de punta a punta — la doctrina
 * del conservador: sin soporte → degradación honesta (sensor off), jamás
 * lanza, jamás bloquea.
 *
 * PRIVACIDAD dura (qa-obs-privacidad): SOLO timestamps, números e ids de
 * sesión — jamás contenido de actas, jamás `console.`, jamás
 * `localStorage.setItem`.
 */

/** Umbral del hang-en-curso (§C.5): bajo el letrero Android (5 s) y
 *  coherente con DRIFT_UMBRAL_MS (3000). SIN flag nuevo de umbral — el
 *  kill-switch del dueño es `hangEnCurso` (§D). */
export const HANG_EN_CURSO_UMBRAL_MS = 3000;

/** DB PROPIA del WAL (§1) — store único `marcas` con keyPath `id`. */
const DB_NOMBRE = "e14-hang-wal";
const DB_VERSION = 1;
const STORE_MARCAS = "marcas";
const CLAVE_ACTIVO = "activo";
const CLAVE_LIMPIO = "limpio";

/** Marca de hang EN CURSO escrita por el worker (§C.3). `sesion`/
 *  `appVersion` son de la sesión de ORIGEN (la que colgó) — viajan dentro
 *  del evento drenado como `sesionOrigen`/`appVersionOrigen`. */
export interface MarcaHangEnCurso {
  id: "activo";
  inicio: number; // epoch ms del último beat ANTES del silencio
  detectadoEn: number; // epoch ms en que el worker cruzó el umbral
  umbralMs: number;
  visible: boolean;
  sesion: string;
  appVersion: string;
}

/** Lápida del desenlace LIMPIO (pagehide procesado — best-effort). */
export interface LapidaWal {
  id: "limpio";
  en: number;
}

type RegistroWal = MarcaHangEnCurso | LapidaWal;

// ─── decisiones PURAS (testeables sin IDB) ─────────────────────────────────

/** ¿Escribir la marca ahora? visible + silencio ≥ umbral + no-doble. */
export function debeMarcar(e: {
  msDesdeBeat: number;
  visible: boolean;
  yaMarcada: boolean;
  umbralMs: number;
}): boolean {
  return e.visible && e.msDesdeBeat >= e.umbralMs && !e.yaMarcada;
}

/** ¿Borrar la marca? (el main reanudó — beats vuelven; el drift ya contó
 *  ese hang completo). Solo si hay marca y el silencio cayó bajo el umbral. */
export function debeDesmarcar(e: {
  msDesdeBeat: number;
  umbralMs: number;
  yaMarcada: boolean;
}): boolean {
  return e.yaMarcada && e.msDesdeBeat < e.umbralMs;
}

/** Resultado del drenaje (§C.4): la LÁPIDA GANA sobre la marca (un
 *  pagehide procesado = desenlace limpio — borrar y callar); sin lápida,
 *  la marca sobreviviente se emite; sin nada, null. */
type DrenajeWal = { limpio: true } | { marca: MarcaHangEnCurso } | null;

export function decidirDrenaje(registros: RegistroWal[]): DrenajeWal {
  if (registros.some((r) => r.id === CLAVE_LIMPIO)) return { limpio: true };
  const marca = registros.find(
    (r): r is MarcaHangEnCurso => r.id === CLAVE_ACTIVO,
  );
  return marca ? { marca } : null;
}

/** Evento obs del hang drenado (PURO) — «jamás inventar» (§1):
 *  · `duracionMs = umbralMs` — el MÍNIMO demostrable (la duración real
 *    murió con la página; lo único que sabemos es que cruzó el umbral).
 *  · `gapHastaReinicioMs` — cuánto tardó el próximo arranque en
 *    descubrirla (Date.now() del drenaje − inicio).
 *  · `breadcrumbs: []` — los breadcrumbs de la sesión colgada murieron con
 *    ella (honesto: sin dato, no invención).
 *  · `op: undefined` — el drenaje corre en el arranque NUEVO: ninguna
 *    operación del origen es atribuible (§A — ausente = sin registro). */
export function eventoDeMarca(
  m: MarcaHangEnCurso,
  ahora: number,
): {
  fuente: "hang-en-curso";
  duracionMs: number;
  umbralMs: number;
  breadcrumbs: [];
  visible: boolean;
  inicio: number;
  detectadoEn: number;
  gapHastaReinicioMs: number;
  sesionOrigen: string;
  appVersionOrigen: string;
} {
  return {
    fuente: "hang-en-curso",
    duracionMs: m.umbralMs, // mínimo DEMOSTRABLE (§1 — jamás inventar)
    umbralMs: m.umbralMs,
    breadcrumbs: [],
    visible: m.visible,
    inicio: m.inicio,
    detectadoEn: m.detectadoEn,
    gapHastaReinicioMs: ahora > m.inicio ? ahora - m.inicio : 0,
    sesionOrigen: m.sesion,
    appVersionOrigen: m.appVersion,
  };
}

// ─── acceso IDB (worker o main — TODO silencioso) ──────────────────────────

let dbPromesa: Promise<IDBDatabase> | null = null;

function abrirWal(): Promise<IDBDatabase> {
  if (dbPromesa) return dbPromesa;
  dbPromesa = new Promise<IDBDatabase>((resolve, reject) => {
    try {
      if (typeof indexedDB === "undefined") {
        reject(new Error("sin-indexeddb"));
        return;
      }
      const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_MARCAS)) {
            db.createObjectStore(STORE_MARCAS, { keyPath: "id" });
          }
        } catch {
          /* silencioso */
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("wal-open"));
      req.onblocked = () => reject(new Error("wal-blocked"));
    } catch (e) {
      reject(e instanceof Error ? e : new Error("wal-open"));
    }
  });
  dbPromesa.catch(() => {
    dbPromesa = null; // el próximo intento re-abre (resiliente)
  });
  return dbPromesa;
}

async function conStore<T>(
  modo: IDBTransactionMode,
  usar: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  try {
    const db = await abrirWal();
    return await new Promise<T>((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_MARCAS, modo);
        const req = usar(tx.objectStore(STORE_MARCAS));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? new Error("wal-tx"));
        tx.onabort = () => reject(tx.error ?? new Error("wal-tx"));
      } catch (e) {
        reject(e instanceof Error ? e : new Error("wal-tx"));
      }
    });
  } catch {
    return null; // degradación honesta — la observabilidad jamás lanza
  }
}

/** Escribe/actualiza la marca activa (el worker — §C.3). false = fallo
 *  silencioso (el sensor sigue — la marca es best-effort). */
export async function escribirMarca(m: MarcaHangEnCurso): Promise<boolean> {
  const r = await conStore("readwrite", (s) => s.put(m as RegistroWal));
  return r !== null;
}

/** Escribe la LÁPIDA del desenlace limpio (pagehide — §C.3/C.4). */
export async function escribirLapida(): Promise<boolean> {
  const r = await conStore("readwrite", (s) =>
    s.put({ id: CLAVE_LIMPIO, en: Date.now() } satisfies LapidaWal as RegistroWal),
  );
  return r !== null;
}

/** Borra la marca activa (el main reanudó — el drift ya contó el hang). */
export async function borrarMarcaActiva(): Promise<boolean> {
  const r = await conStore("readwrite", (s) => s.delete(CLAVE_ACTIVO));
  return r !== null;
}

/** Drenaje del arranque (§C.4): lee TODO el store, decide con
 *  `decidirDrenaje` (lápida gana) y LIMPIA el store completo — la marca
 *  procesada jamás se re-emite. null = WAL vacío/ilegible (honesto). */
export async function leerYLimpiar(): Promise<DrenajeWal> {
  try {
    const registros = await conStore("readonly", (s) =>
      s.getAll() as IDBRequest<RegistroWal[]>,
    );
    if (registros === null) return null;
    const decision = decidirDrenaje(registros);
    // Limpia TODO sea cual sea el desenlace (marca emitida O lápida callada
    // O contenido ilegible — el WAL se consume en cada arranque).
    await conStore("readwrite", (s) => s.clear());
    return decision;
  } catch {
    return null;
  }
}
