/**
 * Tests unitarios — KIT e14-observabilidad-v1 (A3-C1): transporte HTTP de
 * reportes. Entorno node (vitest.config: environment node) con:
 *  · fake mínimo de indexedDB (mismo patrón obs.test.ts) — el outbox es un
 *    DB PROPIO (`e14-obs-outbox`) distinto del buffer (`e14-obs`).
 *  · window stub con localStorage en memoria — leerFlags resuelve el
 *    endpoint vía overrides (`e14-flags-overrides`, máxima prioridad).
 *  · fetch falso (sin red) + fake timers — batcher/backoff deterministas.
 *
 * Kit A3-C1 (criterios de aceptación):
 *  1. Sin endpoint (default): no-op TOTAL — cero timers, cero requests,
 *     estadoTransporte().activo === false.
 *  2. Batcher arma lote ≤ 50 y lo purga del outbox al éxito.
 *  3. 3 fallos seguidos → kill local (activo:false, outbox intacto).
 *  4. El scrub respeta la política (depurarParaEnvio — puro).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appendEvento, purgarBuffer } from "./buffer";
import { appVersion, idDispositivo } from "./identidad";
import { guardarOverridesFlags } from "./politica";
import {
  BACKOFF_MS,
  BATCHER_MS,
  FALLOS_KILL_LOCAL,
  LOTE_TOPE,
  __resetTransporteParaTest,
  depurarParaEnvio,
  estadoTransporte,
  iniciarTransporte,
} from "./transporte";
import type { EventoObs, PoliticaDatos } from "./tipos";
import { logger } from "../../logger";

// ─── Fake mínimo de indexedDB (patrón obs.test.ts — DBs por nombre) ────────

class FakeRequest<T> {
  result: T;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  constructor(result: T) {
    this.result = result;
  }
}

function crearFakeIndexedDB(): IDBFactory {
  const dbs = new Map<string, Map<string, Map<string, unknown>>>();
  const fab = {
    open(nombre: string, _version?: number): IDBOpenDBRequest {
      let stores = dbs.get(nombre);
      if (!stores) {
        stores = new Map();
        dbs.set(nombre, stores);
      }
      const reqInt = new FakeRequest<unknown>(null);
      const req = reqInt as unknown as IDBOpenDBRequest;
      queueMicrotask(() => {
        const dbFake = {
          objectStoreNames: { contains: (n: string) => stores.has(n) },
          createObjectStore: (n: string) => {
            stores.set(n, new Map());
            return { createIndex: () => {} };
          },
          transaction: (_modo: string) => {
            const txInt = {
              oncomplete: null as (() => void) | null,
              onerror: null as (() => void) | null,
              onabort: null as (() => void) | null,
              pendientes: 0,
            };
            const quizasCompletar = () => {
              if (txInt.pendientes === 0)
                queueMicrotask(() => {
                  if (txInt.pendientes === 0) txInt.oncomplete?.();
                });
            };
            return {
              objectStore: (n: string) => {
                const datos = stores.get(n)!;
                const reqDe = <T>(resultado: T, mutar?: () => void): IDBRequest<T> => {
                  const r = new FakeRequest(resultado) as unknown as IDBRequest<T>;
                  const rInt = r as unknown as FakeRequest<T>;
                  txInt.pendientes++;
                  queueMicrotask(() => {
                    mutar?.();
                    rInt.onsuccess?.();
                    txInt.pendientes--;
                    quizasCompletar();
                  });
                  return r;
                };
                return {
                  transaction: txInt,
                  put: (v: { id: string }) => reqDe(undefined, () => datos.set(v.id, v)),
                  delete: (k: string) => reqDe(undefined, () => datos.delete(k)),
                  clear: () => reqDe(undefined, () => datos.clear()),
                  count: () => reqDe(datos.size),
                  getAll: () => reqDe([...datos.values()]),
                } as unknown as IDBObjectStore;
              },
            };
          },
          onclose: null,
        };
        reqInt.result = dbFake;
        reqInt.onupgradeneeded?.();
        reqInt.onsuccess?.();
      });
      return req;
    },
    deleteDatabase: () => new FakeRequest(undefined) as unknown as IDBOpenDBRequest,
    cmp: () => 0,
    databases: () => Promise.resolve([] as IDBDatabaseInfo[]),
  };
  return fab as unknown as IDBFactory;
}

// ─── Stubs de window (localStorage en memoria) y fetch (sin red) ───────────

function stubWindow(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  return store;
}

type Llamada = { url: string; body: string };
const llamadas: Llamada[] = [];
type ModoFetch = "ok" | "fallo-red" | "http-500";
let modoFetch: ModoFetch = "ok";

function stubFetch(): void {
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    llamadas.push({ url: String(url), body: String(init?.body ?? "") });
    if (modoFetch === "fallo-red") throw new Error("red-caida");
    return {
      ok: modoFetch === "ok",
      status: modoFetch === "ok" ? 200 : 500,
    } as Response;
  });
}

// ─── Semilla de eventos del buffer (tipos que el batcher cosecha) ──────────

async function sembrarEventos(n: number, tipo: EventoObs["tipo"] = "error"): Promise<void> {
  for (let i = 0; i < n; i++) {
    await appendEvento({
      ts: Date.now() + i,
      tipo,
      sesion: "",
      dispositivo: "",
      appVersion: "",
      datos: { mensaje: `fallo de prueba ${i}`, stack: "at f (src/x.ts:1:1)", tipo: "TypeError" },
    });
  }
}

const ENDPOINT = "http://ep.local/reportes";

/** Endpoint configurado vía overrides (máxima prioridad de leerFlags). */
function activarEndpoint(): void {
  guardarOverridesFlags({ endpointReportes: ENDPOINT });
}

beforeEach(async () => {
  vi.stubGlobal("indexedDB", crearFakeIndexedDB());
  stubWindow();
  stubFetch();
  llamadas.length = 0;
  modoFetch = "ok";
  __resetTransporteParaTest();
  // Aislamiento: el singleton de buffer.ts sobrevive al stub Global nuevo —
  // vaciar el buffer para que los eventos de un test no contaminen al otro.
  await purgarBuffer();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("transporte · no-op TOTAL sin endpoint (D1 — criterio 1)", () => {
  it("endpointReportes null (default) → activo:false, cero timers, cero requests", async () => {
    iniciarTransporte();
    expect(estadoTransporte()).toEqual({
      activo: false,
      lotesPendientes: 0,
      fallosSeguidos: 0,
    });
    await sembrarEventos(3); // hay eventos, pero sin endpoint NADA sale
    await vi.advanceTimersByTimeAsync(BATCHER_MS * 3);
    expect(llamadas).toHaveLength(0);
  });

  it("es idempotente: llamarlo dos veces no duplica timers ni envíos", async () => {
    activarEndpoint();
    await sembrarEventos(10);
    iniciarTransporte();
    iniciarTransporte();
    await vi.advanceTimersByTimeAsync(BATCHER_MS);
    expect(llamadas).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(BATCHER_MS);
    expect(llamadas).toHaveLength(1); // dedupe por sesión: sin duplicados
  });
});

describe("transporte · batcher y outbox (criterio 2)", () => {
  it("arma lote ≤ 50 ({loteId, deviceId, appVersion, eventos[]}) y purga al éxito", async () => {
    activarEndpoint();
    await sembrarEventos(55); // 55 → lote 1 de 50, lote 2 de 5
    iniciarTransporte();
    await vi.advanceTimersByTimeAsync(BATCHER_MS);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe(ENDPOINT);
    const sobre1 = JSON.parse(llamadas[0].body) as Record<string, unknown>;
    expect(Object.keys(sobre1).sort()).toEqual([
      "appVersion",
      "deviceId",
      "eventos",
      "loteId",
    ]);
    expect(sobre1.eventos).toHaveLength(LOTE_TOPE); // tope del contrato (50)
    expect(typeof sobre1.loteId).toBe("string");
    expect(sobre1.deviceId).toBe(idDispositivo());
    expect(sobre1.appVersion).toBe(appVersion());
    expect(estadoTransporte().lotesPendientes).toBe(0); // purgado al éxito
    await vi.advanceTimersByTimeAsync(BATCHER_MS);
    expect(llamadas).toHaveLength(2);
    const sobre2 = JSON.parse(llamadas[1].body) as { eventos: unknown[] };
    expect(sobre2.eventos).toHaveLength(5); // el resto
    expect(estadoTransporte().lotesPendientes).toBe(0);
  });

  it("solo cosecha error/warn/salud/uso — perf NO viaja por red (kit A3-C1)", async () => {
    activarEndpoint();
    await sembrarEventos(2, "perf");
    await sembrarEventos(1, "error");
    iniciarTransporte();
    await vi.advanceTimersByTimeAsync(BATCHER_MS);
    expect(llamadas).toHaveLength(1);
    const sobre = JSON.parse(llamadas[0].body) as { eventos: EventoObs[] };
    expect(sobre.eventos).toHaveLength(1);
    expect(sobre.eventos[0].tipo).toBe("error");
  });
});

describe("transporte · kill local (criterio 3)", () => {
  it("3 fallos seguidos (HTTP 500) → autodetención con outbox intacto + logger.warn", async () => {
    activarEndpoint();
    modoFetch = "http-500";
    await sembrarEventos(1);
    const aviso = vi.spyOn(logger, "warn").mockImplementation(() => {});
    iniciarTransporte();
    await vi.advanceTimersByTimeAsync(BATCHER_MS); // intento 1
    expect(estadoTransporte()).toMatchObject({ activo: true, fallosSeguidos: 1, lotesPendientes: 1 });
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]); // reintento +1m → intento 2
    expect(estadoTransporte().fallosSeguidos).toBe(2);
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[1]); // reintento +5m → intento 3 → KILL
    expect(estadoTransporte()).toEqual({
      activo: false,
      lotesPendientes: 1, // outbox INTACTO (evidencia)
      fallosSeguidos: FALLOS_KILL_LOCAL,
    });
    expect(llamadas).toHaveLength(FALLOS_KILL_LOCAL);
    expect(aviso).toHaveBeenCalledTimes(1);
    // timers limpios: nada vuelve a enviar tras el kill
    await vi.advanceTimersByTimeAsync(BATCHER_MS * 5);
    expect(llamadas).toHaveLength(3);
  });

  it("fallo de red (excepción) también cuenta; un éxito reinicia el contador y recupera", async () => {
    activarEndpoint();
    modoFetch = "fallo-red";
    await sembrarEventos(1);
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    iniciarTransporte();
    await vi.advanceTimersByTimeAsync(BATCHER_MS); // intento 1 falla (red)
    expect(estadoTransporte().fallosSeguidos).toBe(1);
    modoFetch = "ok"; // «vuelve la red» antes del reintento
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]); // reintento +1m → éxito
    expect(estadoTransporte()).toEqual({
      activo: true,
      lotesPendientes: 0,
      fallosSeguidos: 0,
    });
    expect(llamadas).toHaveLength(2);
  });
});

describe("transporte · scrub respeta la política (criterio 4 — puro)", () => {
  const POLITICA_OFF: PoliticaDatos = {
    metadatos: false,
    textoOcr: false,
    miniaturas: false,
    saludEnVivo: true,
  };
  const POLITICA_ON: PoliticaDatos = {
    metadatos: true,
    textoOcr: true,
    miniaturas: true,
    saludEnVivo: true,
  };

  function evt(tipo: EventoObs["tipo"], datos: Record<string, unknown>): EventoObs {
    return {
      id: `ev-${tipo}`,
      ts: 1,
      tipo,
      sesion: "s",
      dispositivo: "d",
      appVersion: "0.1.0",
      datos,
    };
  }

  it("metadatos OFF → los eventos perf no viajan; ON → viajan", () => {
    const perf = evt("perf", { actaIdHash: "880024a7", status: "OK" });
    expect(depurarParaEnvio([perf], POLITICA_OFF)).toHaveLength(0);
    expect(depurarParaEnvio([perf], POLITICA_ON)).toHaveLength(1);
  });

  it("textoOcr/miniaturas OFF → sus claves se retiran del sobre (defensa en profundidad)", () => {
    const raro = evt("error", {
      mensaje: "fallo",
      textoOcr: "CONTENIDO-OCR",
      miniatura: "CONTENIDO-VISUAL",
    });
    const limpio = depurarParaEnvio([raro], POLITICA_OFF)[0];
    const datos = limpio.datos as Record<string, unknown>;
    expect(datos.textoOcr).toBeUndefined();
    expect(datos.miniatura).toBeUndefined();
    expect(datos.mensaje).toBe("fallo"); // el metadato legítimo queda
    // con toggles ON el emisor honesto manda lo que la política libera
    const libre = depurarParaEnvio([raro], POLITICA_ON)[0].datos as Record<string, unknown>;
    expect(libre.textoOcr).toBe("CONTENIDO-OCR");
  });

  it("eventos sin objeto de datos pasan intactos (no rompe)", () => {
    const plano = evt("salud", null as unknown as Record<string, unknown>);
    expect(depurarParaEnvio([plano], POLITICA_OFF)).toHaveLength(1);
  });
});
