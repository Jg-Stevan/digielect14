/**
 * Tests unitarios — divipol.ts (lookups PUROS sobre una base mock).
 * Overnight 2026-10-22, Prioridad 2 del docs/archive/PLAN-overnight.md.
 *
 * La base REAL (public/e14/divipol.json, 0,63 MB, 34 departamentos) no se
 * carga aquí: cada test usa una base mock MÍNIMA con la MISMA forma
 * ({ "<dep2>": { n, m: { "<mun3>": { n, z: { "<zon2>": { s: {
 * "<std>": { n, t } } } } } } } }) generada por scripts/gen-divipol.mjs.
 * Sin fetch, sin estado de módulo (cargarDivipol/estadoDivipol son de
 * carga asíncrona — cubiertos por el flujo manual, no por unit test).
 */
import { describe, expect, it } from "vitest";

import type { DivipolBase } from "./divipol";
import {
  buscarPuestosPorNombre,
  departamentosDe,
  mesaValida,
  mesasDePuesto,
  municipiosDe,
  puestosDe,
  zonasDe,
} from "./divipol";

const base: DivipolBase = {
  "11": {
    n: "BOGOTA D.C.",
    m: {
      "001": {
        n: "BOGOTA",
        z: {
          "01": {
            s: {
              "01": { n: "CENTRO", t: 12 },
              "02": { n: "LA CANDELARIA", t: 3 },
            },
          },
          "02": {
            s: {
              "03": { n: "MADRID", t: 1 },
            },
          },
        },
      },
    },
  },
  "88": {
    n: "CONSULADOS",
    m: {
      "649": {
        n: "ESPANA",
        z: {
          "01": {
            s: {
              "05": { n: "MADRID", t: 2 },
            },
          },
        },
      },
    },
  },
};

// ─── departamentosDe ────────────────────────────────────────────────────────

describe("departamentosDe", () => {
  it("lista código + nombre, ordenada por código", () => {
    expect(departamentosDe(base)).toEqual([
      { codigo: "11", nombre: "BOGOTA D.C." },
      { codigo: "88", nombre: "CONSULADOS" },
    ]);
  });

  it("base vacía (fallo de carga → degradación MANUAL) → []", () => {
    expect(departamentosDe({})).toEqual([]);
  });
});

// ─── municipiosDe ───────────────────────────────────────────────────────────

describe("municipiosDe", () => {
  it("municipios (o PAÍSES en el 88) de un departamento", () => {
    expect(municipiosDe(base, "88")).toEqual([{ codigo: "649", nombre: "ESPANA" }]);
  });

  it("departamento inexistente → []", () => {
    expect(municipiosDe(base, "99")).toEqual([]);
  });

  it("departamento sin .m → []", () => {
    expect(municipiosDe({ "05": { n: "ANTIOQUIA" } }, "05")).toEqual([]);
  });
});

// ─── zonasDe ────────────────────────────────────────────────────────────────

describe("zonasDe", () => {
  it("solo códigos, ordenados", () => {
    expect(zonasDe(base, "11", "001")).toEqual([{ codigo: "01" }, { codigo: "02" }]);
  });

  it("municipio inexistente → []", () => {
    expect(zonasDe(base, "11", "002")).toEqual([]);
  });
});

// ─── puestosDe ──────────────────────────────────────────────────────────────

describe("puestosDe", () => {
  it("código + nombre + mesas (countTable), ordenado por código", () => {
    expect(puestosDe(base, "11", "001", "01")).toEqual([
      { codigo: "01", nombre: "CENTRO", mesas: 12 },
      { codigo: "02", nombre: "LA CANDELARIA", mesas: 3 },
    ]);
  });

  it("zona inexistente → []", () => {
    expect(puestosDe(base, "11", "001", "99")).toEqual([]);
  });
});

// ─── mesasDePuesto (normalización padStart) ────────────────────────────────

describe("mesasDePuesto", () => {
  it("ruta completa → countTable del puesto", () => {
    expect(mesasDePuesto(base, "11", "001", "01", "01")).toBe(12);
  });

  it("normaliza códigos cortos con padStart (dep2/mun3/zon2/std2)", () => {
    // "1" → "01"/"001" según nivel: la MISMA mesa del caso anterior.
    expect(mesasDePuesto(base, "11", "1", "1", "1")).toBe(12);
  });

  it("ruta inexistente → null (degradación, jamás inventa)", () => {
    expect(mesasDePuesto(base, "11", "001", "01", "99")).toBeNull();
    expect(mesasDePuesto(base, "99", "001", "01", "01")).toBeNull();
  });
});

// ─── mesaValida (§3.3 regla 5) ─────────────────────────────────────────────

describe("mesaValida", () => {
  const ruta = { dep: "11", mun: "001", zon: "01", std: "01" } as const;

  it("1 ≤ mesa ≤ countTable → true", () => {
    expect(mesaValida(base, ruta, 1)).toBe(true);
    expect(mesaValida(base, ruta, 12)).toBe(true);
  });

  it("mesa 0 o > countTable → false", () => {
    expect(mesaValida(base, ruta, 0)).toBe(false);
    expect(mesaValida(base, ruta, 13)).toBe(false);
  });

  it("mesa NO entera → false (Number.isInteger)", () => {
    expect(mesaValida(base, ruta, 1.5)).toBe(false);
  });

  it("puesto inexistente en la ruta → false", () => {
    expect(mesaValida(base, { dep: "11", mun: "001", zon: "01", std: "99" }, 1)).toBe(false);
  });

  it("base vacía → false para cualquier ruta (degradación MANUAL)", () => {
    expect(mesaValida({}, ruta, 1)).toBe(false);
  });
});

// ─── buscarPuestosPorNombre (§3.3 estrategia 3) ────────────────────────────

describe("buscarPuestosPorNombre", () => {
  it("encuentra TODAS las rutas con ese nombre exacto (MADRID existe en 11 y 88)", () => {
    const rutas = buscarPuestosPorNombre(base, "MADRID");
    expect(rutas).toHaveLength(2);
    expect(rutas).toContainEqual({
      dep: "11",
      mun: "001",
      zon: "02",
      std: "03",
      nombre: "MADRID",
      mesas: 1,
    });
    expect(rutas).toContainEqual({
      dep: "88",
      mun: "649",
      zon: "01",
      std: "05",
      nombre: "MADRID",
      mesas: 2,
    });
  });

  it("nombre inexistente → [] (SIN filtrar por similitud — el llamador decide)", () => {
    expect(buscarPuestosPorNombre(base, "MADRIDZ")).toEqual([]);
  });

  it("base vacía → []", () => {
    expect(buscarPuestosPorNombre({}, "MADRID")).toEqual([]);
  });
});
