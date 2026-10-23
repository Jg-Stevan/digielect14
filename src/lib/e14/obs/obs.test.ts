/**
 * Tests unitarios — KIT e14-observabilidad-v1 (suite del núcleo, A1).
 * Entorno node (vitest.config: environment node) — los módulos obs con DOM
 * (localStorage/IDB) se mockean con vi.stubGlobal según haga falta; los
 * PUROS (digest, identidad.fnv1a8) corren sin mock alguno.
 *
 * C1: digest (estabilidad, normalización, archivoDeStack, agregarErrores)
 *     + identidad (fnv1a8 con vectores FNV-1a 32 fijados, sesión/dispositivo).
 */
import { describe, expect, it } from "vitest";

import { agregarErrores, archivoDeStack, digestDe, normalizarMensaje } from "./digest";
import { appVersion, fnv1a8, idSesion } from "./identidad";
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
