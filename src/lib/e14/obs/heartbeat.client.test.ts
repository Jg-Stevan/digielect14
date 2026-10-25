/**
 * Tests — KIT e14-aa-quickwins-bfcache-v1 (§A.2, T1 ≥ 5): FIX bfcache del
 * sensor hang-en-curso (desviación D-104-2 — el worker autocerrado en
 * `pagehide` dejaba el sensor MUERTO en una página restaurada de bfcache).
 *
 *  · restore reconstruye: 2.ª instancia fabricada, la vieja terminada,
 *    beats repostando a la nueva (variable de MÓDULO), intervals sin
 *    acumulación y baseline de visibilidad del momento.
 *  · restore CONSUME el WAL SIN EMITIR (lápida y marca sin lápida — jamás
 *    doble conteo con el drift de hang.ts; la espejo del arranque).
 *  · carga normal (persisted=false) no toca NADA.
 *  · kill-switch OFF en restore → sin reconstrucción y SIN drenaje (§A.1.1).
 *
 * Infraestructura (patrones del repo): fake-IDB mínimo a mano sobre
 * `globalThis.indexedDB` (MISMO patrón de heartbeat-wal.test.ts — una sola
 * fake viva para todo el archivo: el WAL cachea su open en `dbPromesa`),
 * seam de fábrica `__setFabricaWorkerHeartbeatParaTest` (espejo de
 * sondeo-qr.client.ts:218) y window/document stub con capture de listeners
 * e intervals (entorno node — nada toca IndexedDB real). flags corre REAL
 * sobre window.localStorage stub (overrides `e14-flags-overrides` —
 * patrón export-meta.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./buffer", () => ({
  appendEvento: vi.fn(async () => undefined),
}));

import { appendEvento } from "./buffer";
import {
  __setFabricaWorkerHeartbeatParaTest,
  iniciarSensorHangEnCurso,
  type WorkerHeartbeat,
} from "./heartbeat.client";
import {
  escribirLapida,
  escribirMarca,
  HANG_EN_CURSO_UMBRAL_MS,
  type MarcaHangEnCurso,
} from "./heartbeat-wal";

// ─── fake-IDB (una fake viva para todo el archivo — el WAL cachea el open) ──

/** Fake IDB mínimo (patrón heartbeat-wal.test.ts:104-138): un store con
 *  put/getAll/clear y tx con oncomplete en microtarea. */
const wal = (() => {
  const registros = new Map<string, unknown>();
  const store = {
    put: (v: { id: string }) => {
      registros.set(v.id, v);
      return {} as IDBRequest<IDBValidKey>;
    },
    delete: (k: string) => {
      registros.delete(k);
      return {} as IDBRequest<undefined>;
    },
    getAll: () =>
      ({ result: [...registros.values()] }) as unknown as IDBRequest<unknown[]>,
    clear: () => {
      registros.clear();
      return {} as IDBRequest<undefined>;
    },
  };
  const db = {
    transaction: () => {
      const tx = {
        objectStore: () => store,
        oncomplete: null as unknown,
        onerror: null as unknown,
        onabort: null as unknown,
      };
      queueMicrotask(() => {
        (tx.oncomplete as ((e: Event) => void) | null)?.({} as Event);
      });
      return tx;
    },
  };
  (globalThis as { indexedDB?: unknown }).indexedDB = {
    open: () => {
      const req = {
        result: db,
        onupgradeneeded: null as ((e: Event) => void) | null,
        onsuccess: null as ((e: Event) => void) | null,
        onerror: null as ((e: Event) => void) | null,
        onblocked: null as ((e: Event) => void) | null,
      };
      queueMicrotask(() => {
        req.onupgradeneeded?.({} as Event);
        req.onsuccess?.({} as Event);
      });
      return req;
    },
  };
  return { registros };
})();

// ─── seam de fábrica + stubs de DOM ─────────────────────────────────────────

class FakeWorker implements WorkerHeartbeat {
  mensajes: unknown[] = [];
  terminado = false;
  postMessage(m: unknown): void {
    this.mensajes.push(m);
  }
  terminate(): void {
    this.terminado = true;
  }
}

const instancias: FakeWorker[] = [];
const fabrica = vi.fn((): WorkerHeartbeat | null => {
  const w = new FakeWorker();
  instancias.push(w);
  return w;
});

type Handler = (ev: unknown) => void;

/** window/document stub con captura de listeners + intervals manuales
 *  (determinista — sin fake timers). Devuelve `valores` MUTABLE: el test
 *  cambia los overrides de flags a mitad de vida (kill-switch en restore). */
function stubDom(visibility = "visible"): {
  handlers: Map<string, Handler>;
  valores: Record<string, string>;
  intervalsActivos: () => { cb: () => void }[];
} {
  const valores: Record<string, string> = {};
  const handlers = new Map<string, Handler>();
  const intervals: { cb: () => void; activo: boolean; id: number }[] = [];
  let nextId = 1;
  vi.stubGlobal("Worker", class W {});
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => valores[k] ?? null,
      setItem: () => {},
      removeItem: () => {},
    },
    addEventListener: (tipo: string, h: Handler) => {
      handlers.set(tipo, h);
    },
    setInterval: (cb: () => void): number => {
      const id = nextId++;
      intervals.push({ cb, activo: true, id });
      return id;
    },
    clearInterval: (id: number): void => {
      const it = intervals.find((i) => i.id === id);
      if (it) it.activo = false;
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
  });
  vi.stubGlobal("document", {
    get visibilityState() {
      return visibility;
    },
    addEventListener: () => {},
  });
  return {
    handlers,
    valores,
    intervalsActivos: () => intervals.filter((i) => i.activo).map((i) => ({ cb: i.cb })),
  };
}

/** Override de flags a mitad de vida (kill-switch del dueño — §A.1.1). */
function encenderOverride(valores: Record<string, string>, f: unknown): void {
  valores["e14-flags-overrides"] = JSON.stringify(f);
}

/** Flush de microtareas del fake-IDB (el drenaje del arranque es async). */
const vaciar = (): Promise<void> =>
  new Promise((r) => {
    queueMicrotask(() => setTimeout(r, 0));
  });

const marca = (over: Partial<MarcaHangEnCurso> = {}): MarcaHangEnCurso => ({
  id: "activo",
  inicio: 10_000,
  detectadoEn: 13_000,
  umbralMs: HANG_EN_CURSO_UMBRAL_MS,
  visible: true,
  sesion: "sesion-origen",
  appVersion: "test-bfcache",
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  wal.registros.clear();
  instancias.length = 0;
  fabrica.mockClear();
  __setFabricaWorkerHeartbeatParaTest(() => fabrica());
});

afterEach(() => {
  __setFabricaWorkerHeartbeatParaTest(null); // fábrica de producción + reset
  vi.unstubAllGlobals();
});

describe("KIT e14-aa-quickwins-bfcache-v1 (§A.2) — restore de bfcache", () => {
  it("restore reconstruye: 2.ª instancia, la vieja terminada, beats al nuevo (variable de módulo)", async () => {
    const { handlers, intervalsActivos } = stubDom("visible");
    iniciarSensorHangEnCurso();
    await vaciar(); // el drenaje del arranque consume su WAL (vacío)
    expect(instancias.length).toBe(1);
    handlers.get("pagehide")?.({}); // el worker viejo recibe apagado
    expect(instancias[0].mensajes.some((m) => (m as { tipo: string }).tipo === "apagado")).toBe(true);
    handlers.get("pageshow")?.({ persisted: true });
    expect(instancias.length).toBe(2); // §A.1.3 — reconstruido
    expect(instancias[0].terminado).toBe(true); // terminate del viejo
    expect(instancias[1].terminado).toBe(false);
    const msgs = instancias[1].mensajes.map((m) => (m as { tipo: string }).tipo);
    expect(msgs[0]).toBe("config"); // orden: config → visibilidad → beat
    expect(msgs).toContain("visibilidad"); // baseline del momento (§A.1.3)
    expect(msgs).toContain("beat"); // beat inmediato
    // Beats del main RE-postean al worker NUEVO (variable de MÓDULO — §A.1.4).
    const activos = intervalsActivos();
    expect(activos.length).toBe(1); // sin acumulación de intervals
    activos[0].cb();
    const ultimo = instancias[1].mensajes.at(-1) as { tipo: string };
    expect(ultimo.tipo).toBe("beat");
    // El listener de visibilidad POST-restore también llega al nuevo.
    handlers.get("pagehide")?.({});
    expect(instancias[1].mensajes.some((m) => (m as { tipo: string }).tipo === "apagado")).toBe(true);
  });

  it("restore consume LÁPIDA en silencio: store vacío y appendEvento NO llamado", async () => {
    const { handlers } = stubDom();
    iniciarSensorHangEnCurso();
    await vaciar();
    await escribirLapida(); // desenlace limpio del pagehide previo
    expect(wal.registros.has("limpio")).toBe(true);
    handlers.get("pageshow")?.({ persisted: true });
    await vi.waitFor(() => expect(wal.registros.size).toBe(0)); // CONSUMIDO
    expect(appendEvento).not.toHaveBeenCalled(); // lápida → callar (§A.1.2)
    expect(instancias.length).toBe(2); // y el sensor SÍ quedó reconstruido
  });

  it("restore consume MARCA sin lápida en silencio: jamás doble conteo con el drift", async () => {
    const { handlers } = stubDom();
    iniciarSensorHangEnCurso();
    await vaciar();
    await escribirMarca(marca()); // worker murió a mitad de hang (raro)
    handlers.get("pageshow")?.({ persisted: true });
    await vi.waitFor(() => expect(wal.registros.size).toBe(0)); // CONSUMIDA
    expect(appendEvento).not.toHaveBeenCalled(); // la página VIVE — el drift ya contó (§A.1.2)
  });

  it("carga normal (persisted=false) no toca NADA: misma instancia y WAL intacto", async () => {
    const { handlers, intervalsActivos } = stubDom();
    iniciarSensorHangEnCurso();
    await vaciar();
    await escribirLapida(); // lápida plantada DESPUÉS del arranque
    handlers.get("pagehide")?.({});
    handlers.get("pageshow")?.({ persisted: false }); // §A.1.5 — no toca
    expect(instancias.length).toBe(1); // misma instancia
    expect(wal.registros.has("limpio")).toBe(true); // WAL intacto
    expect(intervalsActivos().length).toBe(1); // mismo interval
    expect(appendEvento).not.toHaveBeenCalled();
  });

  it("kill-switch OFF en restore: sin nueva instancia y SIN drenar la marca", async () => {
    const { handlers, valores } = stubDom();
    iniciarSensorHangEnCurso(); // ON al arranque
    await vaciar();
    await escribirMarca(marca());
    encenderOverride(valores, { hangEnCurso: false }); // apagado a mitad de sesión
    handlers.get("pageshow")?.({ persisted: true });
    await vaciar();
    expect(instancias.length).toBe(1); // §A.1.1 — nada se reconstruye
    expect(wal.registros.has("activo")).toBe(true); // y la marca NO se drena
    expect(appendEvento).not.toHaveBeenCalled();
  });

  it("doble restore consecutivo: una instancia por restore, intervals sin acumulación", async () => {
    const { handlers, intervalsActivos } = stubDom();
    iniciarSensorHangEnCurso();
    await vaciar();
    handlers.get("pageshow")?.({ persisted: true });
    handlers.get("pageshow")?.({ persisted: true });
    await vaciar();
    expect(instancias.length).toBe(3); // 1 arranque + 1 por restore
    expect(instancias[0].terminado).toBe(true);
    expect(instancias[1].terminado).toBe(true);
    expect(instancias[2].terminado).toBe(false); // solo la última viva
    expect(intervalsActivos().length).toBe(1); // §A.1.4 — cero acumulación
  });
});
