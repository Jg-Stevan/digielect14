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
import { calcularTier, osDeUA } from "./dispositivo";
import type { EventoObs, SaludSnapshot } from "./tipos";

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

// ─── C4 · breadcrumbs ring + uso de features ───────────────────────────────

describe("breadcrumbs · ring 30 (C4)", () => {
  it("ring FIFO: conserva los últimos 30 en orden cronológico", async () => {
    const bc = await import("./breadcrumbs");
    for (let i = 0; i < 35; i++) {
      bc.registrarBreadcrumb({ tipo: "click", detalle: `b${i}` });
    }
    const snap = bc.obtenerBreadcrumbs();
    expect(snap).toHaveLength(30);
    expect(snap[0].detalle).toBe("b5");
    expect(snap[29].detalle).toBe("b34");
    // snapshot es copia: mutarlo no toca el ring
    snap.pop();
    expect(bc.obtenerBreadcrumbs()).toHaveLength(30);
  });

  it("registrarVista breadcrumb tipo vista", async () => {
    const bc = await import("./breadcrumbs");
    bc.registrarVista("resumen");
    const snap = bc.obtenerBreadcrumbs();
    expect(snap[snap.length - 1]).toMatchObject({ tipo: "vista", detalle: "resumen" });
  });

  it("detalleDeTarget: aria-label > data-accion > null (y nunca lanza)", async () => {
    const { detalleDeTarget } = await import("./breadcrumbs");
    expect(
      detalleDeTarget({
        closest: () => ({ getAttribute: (n: string) => (n === "aria-label" ? "ENVIAR LOTE" : null) }),
      }),
    ).toBe("ENVIAR LOTE");
    expect(
      detalleDeTarget({
        closest: () => ({ getAttribute: (n: string) => (n === "data-accion" ? "abrir-ayuda" : null) }),
      }),
    ).toBe("abrir-ayuda");
    expect(detalleDeTarget({ closest: () => null })).toBeNull();
    expect(detalleDeTarget(null)).toBeNull();
    expect(
      detalleDeTarget({
        closest: () => {
          throw new Error("x");
        },
      }),
    ).toBeNull();
  });

  it("iniciarBreadcrumbs en node (sin window) NO lanza", async () => {
    const { iniciarBreadcrumbs } = await import("./breadcrumbs");
    expect(() => iniciarBreadcrumbs()).not.toThrow();
  });
});

describe("uso · contadores (C4)", () => {
  /** Mocks ligeros de los stores: uso.ts no debe arrastrar el grafo completo
   *  (get-bridge/scanner-core) al suite node. */
  async function importarUso(
    capturados: Array<{ tipo: string; datos: unknown }>,
  ): Promise<typeof import("./uso")> {
    vi.doMock("../store", () => ({
      useE14Store: { subscribe: () => () => {} },
    }));
    vi.doMock("../masiva/store", () => ({
      useMasivaStore: { subscribe: () => () => {} },
    }));
    vi.doMock("./buffer", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      appendEvento: async (e: { tipo: string; datos: unknown }) => {
        capturados.push(e);
      },
    }));
    return import("./uso");
  }

  function limpiarMocks(): void {
    vi.doUnmock("../store");
    vi.doUnmock("../masiva/store");
    vi.doUnmock("./buffer");
    vi.resetModules();
  }

  it("diaDe — YYYY-MM-DD en hora local (padding correcto)", async () => {
    const uso = await importarUso([]);
    try {
      expect(uso.diaDe(new Date(2026, 9, 23, 14, 30))).toBe("2026-10-23");
      expect(uso.diaDe(new Date(2026, 0, 5))).toBe("2026-01-05");
    } finally {
      limpiarMocks();
    }
  });

  it("mezclar + volcar: merge in-place {dia,vista,accion,n} y limpieza", async () => {
    const uso = await importarUso([]);
    try {
      uso.mezclarContador("2026-10-23", "resumen", "abrir-vista");
      uso.mezclarContador("2026-10-23", "resumen", "abrir-vista");
      uso.mezclarContador("2026-10-23", "masiva", "fila→LISTA");
      const volcado = uso.volcarContadores();
      expect(volcado).toHaveLength(2);
      expect(volcado).toContainEqual({ dia: "2026-10-23", vista: "resumen", accion: "abrir-vista", n: 2 });
      expect(volcado).toContainEqual({ dia: "2026-10-23", vista: "masiva", accion: "fila→LISTA", n: 1 });
      expect(uso.volcarContadores()).toHaveLength(0); // ya se limpió
    } finally {
      limpiarMocks();
    }
  });

  it("registrarUso + flushUso: appendea deltas tipo uso y NO duplica", async () => {
    const capturados: Array<{ tipo: string; datos: unknown }> = [];
    const uso = await importarUso(capturados);
    try {
      await uso.registrarUso("resumen", "abrir-vista");
      await uso.registrarUso("resumen", "abrir-vista");
      await uso.flushUso();
      expect(capturados).toHaveLength(1);
      expect(capturados[0].tipo).toBe("uso");
      expect(capturados[0].datos).toMatchObject({ vista: "resumen", accion: "abrir-vista", n: 2 });
      await uso.flushUso(); // sin acumulados nuevos → nada
      expect(capturados).toHaveLength(1);
    } finally {
      limpiarMocks();
    }
  });
});

// ─── C5 · dispositivo (tier D6) + política ─────────────────────────────────

describe("dispositivo · calcularTier (tabla §4.4 — D6 solo detecta)", () => {
  const base = {
    memoriaGB: 4 as number | null,
    nucleos: 8,
    saveData: false,
    bateriaNivel: 0.9 as number | null,
    bateriaCargando: false as boolean | null,
    storageLibreMB: 5000 as number | null,
    redTipo: "4g" as string | null,
    redWifi: false,
    heapLimitMB: 2048 as number | null,
  };

  it("BAJO por deviceMemory < 2", () => {
    expect(calcularTier({ ...base, memoriaGB: 1.5 })).toEqual({ tier: "BAJO", tierInferido: false });
  });
  it("BAJO por núcleos <= 2", () => {
    expect(calcularTier({ ...base, nucleos: 2 })).toEqual({ tier: "BAJO", tierInferido: false });
  });
  it("BAJO por saveData", () => {
    expect(calcularTier({ ...base, saveData: true })).toEqual({ tier: "BAJO", tierInferido: false });
  });
  it("BAJO por batería < 20% SIN cargar (cargando NO condena)", () => {
    expect(calcularTier({ ...base, bateriaNivel: 0.15, bateriaCargando: false }).tier).toBe("BAJO");
    expect(calcularTier({ ...base, bateriaNivel: 0.15, bateriaCargando: true }).tier).toBe("ALTO");
  });
  it("BAJO por storage libre < 500 MB", () => {
    expect(calcularTier({ ...base, storageLibreMB: 400 })).toEqual({ tier: "BAJO", tierInferido: false });
  });
  it("ALTO exacto: mem>=4 Y nucleos>=6 Y 4g Y !saveData", () => {
    expect(calcularTier(base)).toEqual({ tier: "ALTO", tierInferido: false });
  });
  it("ALTO también con red wifi", () => {
    expect(calcularTier({ ...base, redTipo: "3g", redWifi: true }).tier).toBe("ALTO");
  });
  it("MEDIO: falla UNA pierna del ALTO (3g con deviceMemory real)", () => {
    expect(calcularTier({ ...base, redTipo: "3g", redWifi: false })).toEqual({ tier: "MEDIO", tierInferido: false });
  });
  it("MEDIO: memoria 3 (entre 2 y 4)", () => {
    expect(calcularTier({ ...base, memoriaGB: 3 })).toEqual({ tier: "MEDIO", tierInferido: false });
  });
  it("sin deviceMemory (iOS): nucleos>=6 + heap>=2048 → ALTO INFERIDO", () => {
    expect(calcularTier({ ...base, memoriaGB: null })).toEqual({ tier: "ALTO", tierInferido: true });
  });
  it("sin deviceMemory (iOS): nucleos 4 → MEDIO INFERIDO", () => {
    expect(calcularTier({ ...base, memoriaGB: null, nucleos: 4 })).toEqual({ tier: "MEDIO", tierInferido: true });
  });
  it("sin deviceMemory: núcleos <= 2 sigue condenando BAJO (regla REAL, no inferida)", () => {
    expect(calcularTier({ ...base, memoriaGB: null, nucleos: 2 })).toEqual({ tier: "BAJO", tierInferido: false });
  });
  it("nulls honestos no condenan el BAJO (batería/storage desconocidos); red desconocida solo bloquea ALTO→MEDIO", () => {
    expect(
      calcularTier({ ...base, bateriaNivel: null, bateriaCargando: null, storageLibreMB: null }),
    ).toEqual({ tier: "ALTO", tierInferido: false });
    // sin señal de red el ALTO no puede confirmarse (regla §4.4 exige 4g/wifi)
    expect(
      calcularTier({ ...base, bateriaNivel: null, bateriaCargando: null, storageLibreMB: null, redTipo: null, redWifi: false }),
    ).toEqual({ tier: "MEDIO", tierInferido: false });
  });
});

describe("dispositivo · osDeUA", () => {
  it("Android antes que Linux (el UA de Android contiene 'Linux')", () => {
    expect(osDeUA("Mozilla/5.0 (Linux; Android 14; SM-A536E) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36")).toBe("Android");
  });
  it("iOS", () => {
    expect(osDeUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15")).toBe("iOS");
  });
  it("Windows / macOS / Linux / desconocido", () => {
    expect(osDeUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows");
    expect(osDeUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macOS");
    expect(osDeUA("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Linux");
    expect(osDeUA("robot")).toBe("desconocido");
  });
});

describe("politica · defaults / corrupto / overrides (C5-C6)", () => {
  /** localStorage en memoria para window (node no tiene). */
  function stubWindow(): Map<string, string> {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
      setInterval: () => 0,
      clearInterval: () => {},
    });
    return store;
  }

  it("sin clave → defaults D4 (metadatos ON, textoOcr OFF, miniaturas OFF, salud ON)", async () => {
    const capturados: unknown[] = [];
    vi.doMock("./buffer", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      appendEvento: async (e: unknown) => void capturados.push(e),
    }));
    const store = stubWindow();
    try {
      const p = await import("./politica");
      expect(p.leerPolitica()).toEqual({
        metadatos: true,
        textoOcr: false,
        miniaturas: false,
        saludEnVivo: true,
      });
      expect(store.size).toBe(0);
      expect(capturados).toHaveLength(0); // ausente NO avisa (estado de fábrica)
    } finally {
      vi.doUnmock("./buffer");
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it("JSON corrupto → defaults + evento warn PoliticaCorrupta", async () => {
    const capturados: Array<{ tipo: string; datos: { tipo: string } }> = [];
    vi.doMock("./buffer", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      appendEvento: async (e: { tipo: string; datos: { tipo: string } }) => {
        capturados.push(e);
      },
    }));
    const store = stubWindow();
    store.set("e14-obs-politica", "{esto-no-es-json");
    try {
      const p = await import("./politica");
      expect(p.leerPolitica()).toEqual({
        metadatos: true,
        textoOcr: false,
        miniaturas: false,
        saludEnVivo: true,
      });
      await vi.waitFor(() => expect(capturados.length).toBe(1));
      expect(capturados[0].tipo).toBe("warn");
      expect(capturados[0].datos.tipo).toBe("PoliticaCorrupta");
    } finally {
      vi.doUnmock("./buffer");
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it("guardar/leer roundtrip y parciales → defaults en lo ausente", async () => {
    stubWindow();
    try {
      const p = await import("./politica");
      p.guardarPolitica({ metadatos: false, textoOcr: true, miniaturas: true, saludEnVivo: false });
      expect(p.leerPolitica()).toEqual({ metadatos: false, textoOcr: true, miniaturas: true, saludEnVivo: false });
      // JSON parcial (solo un toggle) → el resto vuelve a defaults
      window.localStorage.setItem("e14-obs-politica", JSON.stringify({ textoOcr: true }));
      const leida = p.leerPolitica();
      expect(leida).toEqual({ metadatos: true, textoOcr: true, miniaturas: false, saludEnVivo: true });
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it("modo dev: default off / guardar on-off", async () => {
    stubWindow();
    try {
      const p = await import("./politica");
      expect(p.leerModoDev()).toBe(false);
      p.guardarModoDev(true);
      expect(p.leerModoDev()).toBe(true);
      p.guardarModoDev(false);
      expect(p.leerModoDev()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it("overrides de flags: sanea tipos y clampa ocrThreadsTope (1..8)", async () => {
    stubWindow();
    try {
      const p = await import("./politica");
      expect(p.leerOverridesFlags()).toEqual({});
      p.guardarOverridesFlags({ ocrThreadsTope: 99, thumbsOn: false, poolWorkers: 1 });
      expect(p.leerOverridesFlags()).toEqual({ ocrThreadsTope: 8, thumbsOn: false, poolWorkers: 1 });
      // merge sobre lo existente (guardarOverrides conserva claves previas)
      p.guardarOverridesFlags({ telemetriaSalud: false });
      const o = p.leerOverridesFlags();
      expect(o.telemetriaSalud).toBe(false);
      expect(o.thumbsOn).toBe(false);
      // JSON corrupto → {} silencioso
      window.localStorage.setItem("e14-flags-overrides", "###");
      expect(p.leerOverridesFlags()).toEqual({});
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

// ─── C6 · export (percentiles, merge de uso, reporte) ──────────────────────

/** El export importa ../store estáticamente (grafo del core no resoluble
 *  en node) — mock ligero para TODOS los tests de export. */
async function importarExport(): Promise<typeof import("./export")> {
  vi.doMock("../store", () => ({
    useE14Store: { getState: () => ({ actaActual: null }), subscribe: () => () => {} },
  }));
  vi.doMock("../masiva/cola", () => ({
    listarMapeados: async () => {},
  }));
  return import("./export");
}

function limpiarExport(): void {
  vi.doUnmock("../store");
  vi.doUnmock("../masiva/cola");
  vi.resetModules();
}

describe("export · helpers puros (C6)", () => {
  it("percentilDe: nearest-rank sobre lista ascendente (y vacío → null)", async () => {
    const { percentilDe } = await importarExport();
    try {
      expect(percentilDe([], 50)).toBeNull();
      expect(percentilDe([10], 50)).toBe(10);
      expect(percentilDe([10, 20, 30, 40], 50)).toBe(20); // ceil(0.5*4)=2 → idx 1
      expect(percentilDe([10, 20, 30, 40], 95)).toBe(40); // ceil(0.95*4)=4 → idx 3
      expect(percentilDe([1, 2], 50)).toBe(1); // ceil(1)=1 → idx 0
    } finally {
      limpiarExport();
    }
  });

  it("selloDe: YYYYMMDD-HHmm hora local con padding", async () => {
    const { selloDe } = await importarExport();
    try {
      expect(selloDe(new Date(2026, 9, 23, 9, 5))).toBe("20261023-0905");
      expect(selloDe(new Date(2026, 11, 31, 23, 59))).toBe("20261231-2359");
    } finally {
      limpiarExport();
    }
  });

  it("agregarUso: merge por dia|vista|accion sumando n; ignora basura", async () => {
    const { agregarUso } = await importarExport();
    try {
      const ev = (datos: unknown): EventoObs => ({
        id: "x",
        ts: 1,
        tipo: "uso",
        sesion: "s",
        dispositivo: "d",
        appVersion: "0.1.0",
        datos: datos as EventoObs["datos"],
      });
      const salida = agregarUso([
        ev({ dia: "2026-10-23", vista: "masiva", accion: "fila→LISTA", n: 2 }),
        ev({ dia: "2026-10-23", vista: "masiva", accion: "fila→LISTA", n: 3 }),
        ev({ dia: "2026-10-24", vista: "masiva", accion: "fila→LISTA", n: 1 }),
        ev({ foo: "no-es-contador" }),
        ev({ vista: 42, accion: null }),
      ]);
      expect(salida).toHaveLength(2);
      expect(salida).toContainEqual({ dia: "2026-10-23", vista: "masiva", accion: "fila→LISTA", n: 5 });
      expect(salida).toContainEqual({ dia: "2026-10-24", vista: "masiva", accion: "fila→LISTA", n: 1 });
    } finally {
      limpiarExport();
    }
  });
});

describe("export · perfDeDiags (agrega de ACTAS/diagnósticos, no de eventos — C6)", () => {
  function fragDiag(ocrMs: number, completa: boolean): { tiempos: { ocrMs: number; procesoMs: number; calidadMs: number; totalMs: number }; gate: { completa: boolean } } {
    return {
      tiempos: { ocrMs, procesoMs: 1, calidadMs: 1, totalMs: ocrMs + 2 },
      gate: { completa },
    };
  }

  it("p50/p95 de ocrMs, fallosGate y memoriaPico desde saludMuestras", async () => {
    const { perfDeDiags } = await importarExport();
    try {
      const diags = [
        fragDiag(100, true),
        fragDiag(200, true),
        fragDiag(300, false),
        fragDiag(0, true), // copia DUPLICADA sin OCR real → excluida del percentil
      ];
      const resumen = perfDeDiags(diags, [
        { memoriaMB: 12.5 },
        { memoriaMB: 88.2 },
        { memoriaMB: null },
      ] as SaludSnapshot[]);
      expect(resumen.actas).toBe(4); // TODAS cuentan (la copia es acta)
      expect(resumen.p50OcrMs).toBe(200); // [100,200,300] → idx 1
      expect(resumen.p95OcrMs).toBe(300);
      expect(resumen.fallosGate).toBe(1);
      expect(resumen.memoriaPicoMB).toBe(88.2);
    } finally {
      limpiarExport();
    }
  });

  it("sin actas ni muestras → nulls honestos", async () => {
    const { perfDeDiags } = await importarExport();
    try {
      const resumen = perfDeDiags([], []);
      expect(resumen).toEqual({ actas: 0, p50OcrMs: null, p95OcrMs: null, fallosGate: 0, memoriaPicoMB: null });
    } finally {
      limpiarExport();
    }
  });
});

describe("export · construirReporte (C6)", () => {
  it("monta el ReporteSesion del contrato: meta+dispositivo+errores+perf+salud+uso", async () => {
    // buffer con: 2 salud, 3 uso, 1 error con digest
    vi.doMock("../store", () => ({
      useE14Store: {
        getState: () => ({
          actaActual: { id: "a-1", status: "RECHAZADA", diagnostico: { tiempos: { ocrMs: 250, procesoMs: 1, calidadMs: 1, totalMs: 252 }, gate: { completa: false } } },
        }),
        subscribe: () => () => {},
      },
    }));
    vi.doMock("../masiva/cola", () => ({
      listarMapeados: async (mapper: (r: unknown) => unknown) => {
        void mapper; // el mapper corre; extrae los diag que quiera
        const registros = [
          { id: "f1", acta: { id: "a-2", status: "LISTA", diagnostico: { tiempos: { ocrMs: 750, procesoMs: 1, calidadMs: 1, totalMs: 752 }, gate: { completa: true } } } },
          { id: "f2", acta: null },
        ];
        for (const r of registros) mapper(r);
      },
    }));
    vi.doMock("./buffer", async () => ({
      eventosPorDigest: async () => [{ digest: "dd000001", severidad: "error", veces: 1, breadcrumbsRecientes: [] }],
      leerEventos: async (f?: (e: EventoObs) => boolean) => {
        const eventos: EventoObs[] = [
          { id: "1", ts: 1, tipo: "salud", sesion: "s", dispositivo: "d", appVersion: "0.1.0", datos: { memoriaMB: 10, tier: "ALTO", tierInferido: false, nucleos: 8, memoriaGB: 8, bateria: { nivel: null, cargando: null }, red: { tipo: null, downlinkMbps: null, saveData: false }, storageLibreMB: null } },
          { id: "2", ts: 2, tipo: "salud", sesion: "s", dispositivo: "d", appVersion: "0.1.0", datos: { memoriaMB: 20, tier: "ALTO", tierInferido: false, nucleos: 8, memoriaGB: 8, bateria: { nivel: null, cargando: null }, red: { tipo: null, downlinkMbps: null, saveData: false }, storageLibreMB: null } },
          { id: "3", ts: 3, tipo: "uso", sesion: "s", dispositivo: "d", appVersion: "0.1.0", datos: { dia: "2026-10-23", vista: "resumen", accion: "abrir-vista", n: 4 } },
          { id: "4", ts: 4, tipo: "uso", sesion: "s", dispositivo: "d", appVersion: "0.1.0", datos: { dia: "2026-10-23", vista: "resumen", accion: "abrir-vista", n: 1 } },
          { id: "5", ts: 5, tipo: "error", sesion: "s", dispositivo: "d", appVersion: "0.1.0", datos: { digest: "dd000001" } },
        ];
        return f ? eventos.filter(f) : eventos;
      },
      purgarBuffer: async () => {},
    }));
    vi.doMock("./dispositivo", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      obtenerDispositivo: async () => ({
        memoriaMB: 15, nucleos: 8, memoriaGB: 8,
        bateria: { nivel: null, cargando: null },
        red: { tipo: "4g", downlinkMbps: 10, saveData: false },
        storageLibreMB: 12000, tier: "ALTO", tierInferido: false,
        os: "Android", ua: "UA-TEST",
      }),
    }));
    vi.doMock("../store", () => ({
      useE14Store: {
        getState: () => ({
          actaActual: { id: "a-1", status: "RECHAZADA", diagnostico: { tiempos: { ocrMs: 250, procesoMs: 1, calidadMs: 1, totalMs: 252 }, gate: { completa: false } } },
        }),
        subscribe: () => () => {},
      },
    }));
    vi.doMock("../masiva/cola", () => ({
      listarMapeados: async (mapper: (r: unknown) => unknown) => {
        void mapper; // el mapper corre; extrae los diag que quiera
        const registros = [
          { id: "f1", acta: { id: "a-2", status: "LISTA", diagnostico: { tiempos: { ocrMs: 750, procesoMs: 1, calidadMs: 1, totalMs: 752 }, gate: { completa: true } } } },
          { id: "f2", acta: null },
        ];
        for (const r of registros) mapper(r);
      },
    }));
    vi.stubGlobal("window", {
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      setInterval: () => 0,
      clearInterval: () => {},
    });
    try {
      const ex = await import("./export");
      const reporte = await ex.construirReporte();
      expect(reporte.meta.appVersion).toBe("0.1.0");
      expect(reporte.meta.politica).toEqual({ metadatos: true, textoOcr: false, miniaturas: false, saludEnVivo: true });
      expect(reporte.meta.generado).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(reporte.dispositivo.os).toBe("Android");
      expect(reporte.erroresAgrupados).toEqual([{ digest: "dd000001", severidad: "error", veces: 1, breadcrumbsRecientes: [] }]);
      expect(reporte.perfResumen.actas).toBe(2); // actaActual + fila f1
      expect(reporte.perfResumen.p50OcrMs).toBe(250); // [250, 750]
      expect(reporte.perfResumen.p95OcrMs).toBe(750);
      expect(reporte.perfResumen.fallosGate).toBe(1);
      expect(reporte.perfResumen.memoriaPicoMB).toBe(20); // máx de las 2 muestras
      expect(reporte.saludMuestras).toHaveLength(2);
      expect(reporte.uso).toEqual([{ dia: "2026-10-23", vista: "resumen", accion: "abrir-vista", n: 5 }]);
    } finally {
      vi.doUnmock("./buffer");
      vi.doUnmock("./dispositivo");
      vi.doUnmock("../store");
      vi.doUnmock("../masiva/cola");
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

// ─── C7 · captura (eventoDeError) ──────────────────────────────────────────

describe("captura · eventoDeError (C7)", () => {
  it("Error real → mensaje/constructor/stack/digest/archivo/breadcrumbs", async () => {
    const { eventoDeError } = await import("./captura");
    const bc = await import("./breadcrumbs");
    bc.registrarBreadcrumb({ tipo: "click", detalle: "btn-enviar" });
    const err = new TypeError("lectura de null");
    const { tipo, datos } = eventoDeError(err, "WindowError");
    expect(tipo).toBe("error");
    expect(datos.mensaje).toBe("TypeError: lectura de null");
    expect(datos.tipo).toBe("TypeError");
    expect(datos.stack).toContain("obs.test.ts"); // frame del test (node)
    expect(datos.archivo).toContain("obs.test.ts"); // primer frame src/
    expect(datos.digest).toMatch(/^[0-9a-f]{8}$/);
    expect(datos.breadcrumbs[datos.breadcrumbs.length - 1]).toMatchObject({ detalle: "btn-enviar" });
  });

  it("valor NO-Error (string/objeto) → tipo = origen (WindowError/…)", async () => {
    const { eventoDeError } = await import("./captura");
    const { tipo, datos } = eventoDeError("fallo raro", "UnhandledRejection");
    expect(tipo).toBe("error");
    expect(datos.mensaje).toBe("fallo raro");
    expect(datos.tipo).toBe("UnhandledRejection");
  });

  it("null/undefined → 'desconocido' honesto, JAMÁS lanza", async () => {
    const { eventoDeError } = await import("./captura");
    expect(() => eventoDeError(null, "WindowError")).not.toThrow();
    const { datos } = eventoDeError(undefined, "ErrorBoundary");
    expect(datos.mensaje).toBe("desconocido");
  });

  it("mensaje se trunca a 500 (contrato)", async () => {
    const { eventoDeError } = await import("./captura");
    const { datos } = eventoDeError(new Error("x".repeat(900)), "WindowError");
    expect(datos.mensaje.length).toBeLessThanOrEqual(500);
  });
});
