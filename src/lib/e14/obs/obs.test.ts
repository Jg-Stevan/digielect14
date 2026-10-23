/**
 * Tests unitarios — KIT e14-observabilidad-v1 (suite del núcleo, A1).
 * Entorno node (vitest.config: environment node) — los módulos obs con DOM
 * (localStorage/IDB) se mockean con vi.stubGlobal según haga falta; los
 * PUROS (digest, identidad.fnv1a8) corren sin mock alguno.
 *
 * C1: digest (estabilidad, normalización, archivoDeStack, agregarErrores)
 *     + identidad (fnv1a8 con vectores FNV-1a 32 fijados, sesión/dispositivo).
 * C2: buffer — lógica pura de retención (mantenimientoBuffer: TTL 30d +
 *     tope 500 FIFO) + roundtrip IDB con fake mínimo de indexedDB.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

import { agregarErrores, archivoDeStack, digestDe, normalizarMensaje } from "./digest";
import { appVersion, fnv1a8, idSesion } from "./identidad";
import {
  appendEvento,
  contarEventos,
  eventosPorDigest,
  leerEventos,
  mantenimientoBuffer,
  purgarBuffer,
  TOPE_EVENTOS,
  TTL_MS,
} from "./buffer";
import type { EventoObs } from "./tipos";

/** Evento error/warn de utilidad para las pruebas de agrupación. */
function eventoError(
  digest: string,
  ts: number,
  extra?: Partial<{ tipo: "error" | "warn"; mensaje: string; breadcrumbs: { t: number; tipo: "click"; detalle: string }[] }>,
): EventoObs {
  return {
    id: `ev-${digest}-${ts}`,
    ts,
    tipo: extra?.tipo ?? "error",
    sesion: "s-1",
    dispositivo: "d-1",
    appVersion: "0.1.0",
    datos: {
      mensaje: extra?.mensaje ?? `fallo ${digest}`,
      stack: "at f (src/lib/x.ts:10:5)",
      tipo: "TypeError",
      archivo: "src/lib/x.ts:10:5",
      digest,
      breadcrumbs: extra?.breadcrumbs ?? [],
    },
  };
}

describe("identidad · fnv1a8 (vectores FNV-1a 32-bit fijados)", () => {
  it("vector cadena vacía → basis 811c9dc5", () => {
    expect(fnv1a8("")).toBe("811c9dc5");
  });
  it("vector 'a' → e40c292c", () => {
    expect(fnv1a8("a")).toBe("e40c292c");
  });
  it("vector 'foobar' → bf9cf968", () => {
    expect(fnv1a8("foobar")).toBe("bf9cf968");
  });
  it("vector 'hello' → 4f9f2cab", () => {
    expect(fnv1a8("hello")).toBe("4f9f2cab");
  });
  it("sale SIEMPRE 8 hex", () => {
    expect(fnv1a8("cualquier cadena ěščř úñí")).toMatch(/^[0-9a-f]{8}$/);
  });
  it("determinista y sensible a la entrada", () => {
    expect(fnv1a8("acta-123")).toBe(fnv1a8("acta-123"));
    expect(fnv1a8("acta-123")).not.toBe(fnv1a8("acta-124"));
  });
});

describe("identidad · sesión y dispositivo", () => {
  it("idSesion es estable dentro de la sesión", () => {
    expect(idSesion()).toBe(idSesion());
  });
  it("appVersion devuelve la de package.json (0.1.0)", () => {
    expect(appVersion()).toBe("0.1.0");
  });
});

describe("digest · normalizarMensaje", () => {
  it("números → *norm*", () => {
    expect(normalizarMensaje("OCR tardó 9123 ms en mesa 12")).toBe(
      "OCR tardó *norm* ms en mesa *norm*",
    );
  });
  it("UUIDs → *uuid* (un UUID distinto, MISMO resultado)", () => {
    const a = normalizarMensaje("fallo en acta 3f2a1c9e-8b7d-4c2a-9d1e-0f5a6b7c8d9e");
    const b = normalizarMensaje("fallo en acta 11111111-2222-4333-8444-555555555555");
    expect(a).toBe(b);
    expect(a).toBe("fallo en acta *uuid*");
  });
  it("hex ≥ 8 → *hash* (pero hex corto se queda)", () => {
    expect(normalizarMensaje("chunk deadbeef01 ok")).toBe("chunk *hash* ok");
    expect(normalizarMensaje("chunk beef ok")).toBe("chunk beef ok");
  });
});

describe("digest · archivoDeStack", () => {
  it("primer frame src/:L:C", () => {
    const stack = "TypeError: x\n    at foo (src/lib/e14/obs/captura.ts:55:12)\n    at bar (webpack/x:1:1)";
    expect(archivoDeStack(stack)).toBe("src/lib/e14/obs/captura.ts:55:12");
  });
  it("sin frame src/ → null honesto", () => {
    expect(archivoDeStack("at foo (node_modules/x/y.js:1:2)")).toBeNull();
    expect(archivoDeStack("")).toBeNull();
  });
});

describe("digest · digestDe (estabilidad ante datos distintos)", () => {
  const stack1 = "TypeError: No se pudo leer el acta 3f2a1c9e-8b7d-4c2a-9d1e-0f5a6b7c8d9e\n    at pipeline (src/lib/e14/scanner-core-bridge.ts:1753:20)";
  const stack2 = "TypeError: No se pudo leer el acta 99999999-8888-4777-8666-555555555555\n    at pipeline (src/lib/e14/scanner-core-bridge.ts:1753:20)";
  it("mismo fallo con UUIDs/ms distintos → MISMO digest", () => {
    expect(digestDe("falló en 9123 ms", "TypeError", stack1)).toBe(
      digestDe("falló en 45 ms", "TypeError", stack2),
    );
  });
  it("mensaje distinto → digest distinto", () => {
    expect(digestDe("falló A", "TypeError", stack1)).not.toBe(
      digestDe("falló B", "TypeError", stack1),
    );
  });
  it("tipo distinto → digest distinto", () => {
    expect(digestDe("falló A", "TypeError", stack1)).not.toBe(
      digestDe("falló A", "RangeError", stack1),
    );
  });
  it("sin frame src/ en el stack → grupo 'sin-frame-src' estable", () => {
    expect(digestDe("x", "TypeError", "at f (node_modules/y.js:1:1)")).toBe(
      digestDe("x", "TypeError", "at g (node_modules/z.js:2:2)"),
    );
  });
});

describe("digest · agregarErrores", () => {
  it("agrupa por digest, cuenta veces y ordena por (veces, ultima) DESC", () => {
    const eventos = [
      eventoError("aaaa1111", 100),
      eventoError("aaaa1111", 300),
      eventoError("aaaa1111", 200),
      eventoError("bbbb2222", 150),
    ];
    const grupos = agregarErrores(eventos);
    expect(grupos).toHaveLength(2);
    expect(grupos[0].digest).toBe("aaaa1111");
    expect(grupos[0].veces).toBe(3);
    expect(grupos[0].primera).toBe(100);
    expect(grupos[0].ultima).toBe(300);
    expect(grupos[1].digest).toBe("bbbb2222");
  });
  it("empate en veces → gana el más reciente", () => {
    const grupos = agregarErrores([
      eventoError("cccc3333", 100),
      eventoError("dddd4444", 500),
    ]);
    expect(grupos[0].digest).toBe("dddd4444");
  });
  it("ignora eventos que no son error/warn y eventos sin digest", () => {
    const eventos = [
      eventoError("eeee5555", 100),
      { ...eventoError("ffff6666", 100), tipo: "uso" as const },
      {
        id: "sin-digest",
        ts: 100,
        tipo: "error" as const,
        sesion: "s",
        dispositivo: "d",
        appVersion: "0.1.0",
        datos: { foo: 1 },
      },
    ];
    const grupos = agregarErrores(eventos);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].digest).toBe("eeee5555");
  });
  it("severidad y breadcrumbs del evento MÁS RECIENTE; versiones = set", () => {
    const eventos = [
      eventoError("aaaa1111", 100, { tipo: "warn", breadcrumbs: [{ t: 1, tipo: "click", detalle: "viejo" }] }),
      eventoError("aaaa1111", 900, { tipo: "error", breadcrumbs: [{ t: 9, tipo: "click", detalle: "nuevo" }] }),
      eventoError("aaaa1111", 300),
    ];
    const [g] = agregarErrores(eventos);
    expect(g.severidad).toBe("error"); // el más reciente (900) es error
    expect(g.breadcrumbsRecientes).toEqual([{ t: 9, tipo: "click", detalle: "nuevo" }]);
    expect(g.versiones).toEqual(["0.1.0"]);
  });
  it("versiones acumula versiones distintas del mismo digest", () => {
    const a = eventoError("aaaa1111", 100);
    const b = { ...eventoError("aaaa1111", 200), appVersion: "0.2.0" };
    const [g] = agregarErrores([a, b]);
    expect(g.versiones).toEqual(["0.1.0", "0.2.0"]);
  });
});

// ─── C2 · buffer (lógica pura + IDB con fake mínimo) ───────────────────────

describe("buffer · mantenimientoBuffer (retención PURA)", () => {
  const DIA = 24 * 60 * 60 * 1000;
  const ahora = 1_800_000_000_000;

  function ev(ts: number, id = `e-${ts}`): EventoObs {
    return {
      id,
      ts,
      tipo: "uso",
      sesion: "s",
      dispositivo: "d",
      appVersion: "0.1.0",
      datos: {},
    };
  }

  it("TTL: borra los eventos con ts < ahora − 30 días", () => {
    const vivos = [ev(ahora - DIA), ev(ahora - 5 * DIA)];
    const vencidos = [ev(ahora - 31 * DIA), ev(ahora - 40 * DIA)];
    const { conservar, borrar } = mantenimientoBuffer([...vivos, ...vencidos], ahora);
    expect(conservar).toHaveLength(2);
    expect(borrar).toHaveLength(2);
    expect(borrar.map((b) => b.ts)).toEqual([ahora - 40 * DIA, ahora - 31 * DIA]);
  });

  it("tope 500: FIFO — borra los MÁS VIEJOS por ts", () => {
    const eventos = Array.from({ length: TOPE_EVENTOS + 25 }, (_, i) =>
      ev(ahora - (TOPE_EVENTOS + 25 - i) * 1000, `id-${i}`),
    );
    const { conservar, borrar } = mantenimientoBuffer(eventos, ahora);
    expect(conservar).toHaveLength(TOPE_EVENTOS);
    expect(borrar).toHaveLength(25);
    // los borrados son los 25 más viejos (id-0..id-24) — comparación NUMÉRICA
    expect(borrar.every((b) => Number(b.id.slice(3)) < 25)).toBe(true);
    // el conservado más viejo es el 26º
    expect(conservar[0].id).toBe("id-25");
  });

  it("borde TTL: justo dentro queda, un ms fuera se va", () => {
    const dentro = mantenimientoBuffer([ev(ahora - TTL_MS)], ahora);
    expect(dentro.borrar).toHaveLength(0);
    const fuera = mantenimientoBuffer([ev(ahora - TTL_MS - 1)], ahora);
    expect(fuera.borrar).toHaveLength(1);
  });

  it("lista vacía → nada que hacer", () => {
    const { conservar, borrar } = mantenimientoBuffer([], ahora);
    expect(conservar).toHaveLength(0);
    expect(borrar).toHaveLength(0);
  });
});

// ─── Fake mínimo de indexedDB (put/delete/clear/count/getAll + tx) ─────────

/** Request IDB falso: muta `result` directamente (el tipo DOM lo declara
 *  readonly — el fake lo maneja como campo propio) y dispara callbacks. */
class FakeRequest<T> {
  result: T;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  constructor(result: T) {
    this.result = result;
  }
}

/** Fake mínimo de indexedDB: open (con upgrade + result disponible ANTES de
 *  onupgradeneeded, como IDB real), objectStoreNames, createObjectStore y
 *  transaction → objectStore con put/delete/clear/count/getAll. La tx dispara
 *  oncomplete cuando el número de requests pendientes llega a cero. */
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
              if (txInt.pendientes === 0) queueMicrotask(() => {
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

/** Evento base para los tests de buffer (datos mínimos por tipo). */
function evtBase(tipo: EventoObs["tipo"], ts: number, datos: Record<string, unknown> = {}): Omit<EventoObs, "id"> {
  return {
    ts,
    tipo,
    sesion: "s-test",
    dispositivo: "d-test",
    appVersion: "0.1.0",
    datos,
  };
}

describe("buffer · IDB (fake mínimo — roundtrip, tope, TTL, digest)", () => {
  beforeAll(() => {
    vi.stubGlobal("indexedDB", crearFakeIndexedDB());
  });

  /** Aislamiento: cada test arranca con el buffer VACÍO (los tests previos
   *  dejan filas — el tope FIFO es real y arrastraría aserciones). */
  async function bufferLimpio() {
    await purgarBuffer();
  }

  it("append + leer roundtrip ordenado por ts ASC, con identidad completada", async () => {
    await bufferLimpio();
    const t = Date.now();
    await appendEvento(evtBase("uso", t + 300, { foo: 1 }));
    await appendEvento(evtBase("uso", t + 100, { foo: 2 }));
    await appendEvento(evtBase("uso", t + 200, { foo: 3 }));
    const eventos = await leerEventos();
    expect(eventos.map((e) => e.ts)).toEqual([t + 100, t + 200, t + 300]);
    expect(eventos[0].id).toBeTruthy();
    expect(eventos[0].sesion).toBe("s-test");
    expect(await contarEventos()).toBe(3);
  });

  it("leerEventos aplica el filtro", async () => {
    await bufferLimpio();
    await appendEvento(evtBase("error", Date.now() + 400, { digest: "abcd1234" }));
    const errores = await leerEventos((e) => e.tipo === "error");
    expect(errores).toHaveLength(1);
    expect(errores[0].ts).toBeGreaterThan(Date.now());
  });

  it("tope 500 en vivo: 505 appends → 500 conservados, los más viejos fuera", async () => {
    await bufferLimpio();
    const base = Date.now();
    const tsDe = (i: number) => base - (505 - i) * 1000;
    for (let i = 0; i < 505; i++) {
      await appendEvento(evtBase("uso", tsDe(i)));
    }
    const eventos = await leerEventos();
    expect(await contarEventos()).toBe(TOPE_EVENTOS);
    expect(eventos[0].ts).toBe(tsDe(5)); // los 5 más viejos purgados
    expect(eventos[eventos.length - 1].ts).toBe(tsDe(504));
  });

  it("TTL en vivo: un append fresco purga los vencidos (30 días)", async () => {
    await bufferLimpio();
    const DIA = 24 * 60 * 60 * 1000;
    const ahora = Date.now();
    await appendEvento(evtBase("uso", ahora - 31 * DIA, { viejo: true }));
    await appendEvento(evtBase("uso", ahora - 5 * DIA, { fresco: true }));
    const eventos = await leerEventos();
    expect(eventos.some((e) => "viejo" in e.datos)).toBe(false);
    expect(eventos.some((e) => "fresco" in e.datos)).toBe(true);
  });

  it("eventosPorDigest agrega solo error/warn del contenido real", async () => {
    await bufferLimpio();
    await appendEvento({
      ...evtBase("error", Date.now() + 10),
      datos: { mensaje: "fallo X", stack: "at a (src/lib/x.ts:1:1)", tipo: "TypeError", archivo: "src/lib/x.ts:1:1", digest: "digestx1", breadcrumbs: [] },
    });
    await appendEvento({
      ...evtBase("error", Date.now() + 20),
      datos: { mensaje: "fallo X", stack: "at a (src/lib/x.ts:1:1)", tipo: "TypeError", archivo: "src/lib/x.ts:1:1", digest: "digestx1", breadcrumbs: [] },
    });
    await appendEvento(evtBase("uso", 30, { n: 1 }));
    const grupos = await eventosPorDigest();
    expect(grupos).toHaveLength(1);
    expect(grupos[0].digest).toBe("digestx1");
    expect(grupos[0].veces).toBe(2);
  });

  it("purgarBuffer vacía TODO", async () => {
    await bufferLimpio();
    await appendEvento(evtBase("uso", Date.now()));
    await purgarBuffer();
    expect(await contarEventos()).toBe(0);
    expect(await leerEventos()).toHaveLength(0);
  });

  it("sin IDB (entorno sin indexedDB): append resuelve SILENCIOSO y leer → []", async () => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", undefined);
    try {
      const buffer = await import("./buffer");
      await expect(buffer.appendEvento(evtBase("uso", 1))).resolves.toBeUndefined();
      expect(await contarEventos()).toBe(0);
      expect(await buffer.leerEventos()).toEqual([]);
      await expect(eventosPorDigest()).resolves.toEqual([]);
      await expect(buffer.abrirBuffer()).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ─── C3 · logger → transporte obs ──────────────────────────────────────────

describe("logger · transporte obs (C3)", () => {
  it("logger.error transporta ErrorEvento completo (lazy, no bloquea)", async () => {
    const capturados: Array<{ tipo: string; datos: Record<string, unknown> }> = [];
    vi.doMock("./buffer", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      appendEvento: async (e: { tipo: string; datos: Record<string, unknown> }) => {
        capturados.push(e);
      },
    }));
    vi.doMock("./breadcrumbs", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      obtenerBreadcrumbs: () => [{ t: 7, tipo: "click" as const, detalle: "btn-sim" }],
    }));
    try {
      const { logger } = await import("../../logger");
      logger.error("boom", 42, { a: 1 });
      await vi.waitFor(() => expect(capturados.length).toBe(1));
      const ev = capturados[0];
      expect(ev.tipo).toBe("error");
      expect(ev.datos.tipo).toBe("LoggerError");
      expect(String(ev.datos.mensaje)).toContain("42");
      expect(String(ev.datos.mensaje)).toContain(String.raw`{"a":1}`);
      expect(String(ev.datos.stack)).toContain("logger.ts"); // stack real del caller
      expect(ev.datos.digest).toMatch(/^[0-9a-f]{8}$/);
      expect(ev.datos.breadcrumbs).toEqual([{ t: 7, tipo: "click", detalle: "btn-sim" }]);
    } finally {
      vi.doUnmock("./buffer");
      vi.doUnmock("./breadcrumbs");
      vi.resetModules();
    }
  });

  it("logger.warn transporta con tipo LoggerWarn", async () => {
    const capturados: Array<{ tipo: string; datos: { tipo: string } }> = [];
    vi.doMock("./buffer", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      appendEvento: async (e: { tipo: string; datos: { tipo: string } }) => {
        capturados.push(e);
      },
    }));
    try {
      const { logger } = await import("../../logger");
      logger.warn("degradación");
      await vi.waitFor(() => expect(capturados.length).toBe(1));
      expect(capturados[0].tipo).toBe("warn");
      expect(capturados[0].datos.tipo).toBe("LoggerWarn");
    } finally {
      vi.doUnmock("./buffer");
      vi.resetModules();
    }
  });

  it("trunca mensaje a 500 y stack a 2000 (contrato ErrorEvento)", async () => {
    const capturados: Array<{ datos: { mensaje: string; stack: string } }> = [];
    vi.doMock("./buffer", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      appendEvento: async (e: { datos: { mensaje: string; stack: string } }) => {
        capturados.push(e);
      },
    }));
    try {
      const { logger } = await import("../../logger");
      logger.error("x".repeat(600));
      await vi.waitFor(() => expect(capturados.length).toBe(1));
      expect(capturados[0].datos.mensaje).toHaveLength(500);
      expect(String(capturados[0].datos.stack).length).toBeLessThanOrEqual(2000);
    } finally {
      vi.doUnmock("./buffer");
      vi.resetModules();
    }
  });

  it("si el import del buffer falla (SSR/edge), el logger NO lanza y sigue", async () => {
    vi.doMock("./buffer", () => {
      throw new Error("SSR sin obs");
    });
    try {
      const { logger } = await import("../../logger");
      expect(() => logger.error("sin transporte")).not.toThrow();
      expect(() => logger.warn("sin transporte")).not.toThrow();
      // y la consola nativa sigue llamándose (la política del logger intacta)
      await new Promise((r) => setTimeout(r, 10)); // deja morir el Promise.all en .catch
    } finally {
      vi.doUnmock("./buffer");
      vi.resetModules();
    }
  });
});
