/**
 * Tests unitarios — clasificador.ts (partes PURAS de normalización/fuzzy).
 * Overnight 2026-10-22, Prioridad 2 del PLAN-overnight.md.
 *
 * Alcance (funciones bajo test, SIN tocar su lógica):
 *  · normalizarNombre — NFKD, diacríticos, MAYÚSCULAS, espacios.
 *  · similitud — Dice sobre trigramas (§3.3), con el caso real del
 *    informe 120553 (CALRO vs CAIRO — evidencia del kit e63f F1a).
 *  · tipoDeDigito — d9 → tipo de copia (gramática código 1D).
 *  · candidatosCodigo1D — tolerancia «7» impreso como «/» (kit
 *    consenso-frankfurt §0-F4, fuente Frankfurt «/1000/453010202»).
 *
 * FUERA de alcance (consumo real en runtime): anclas de extracción,
 * clasificarCabecera, cascada de banda — cubiertos por los 7 QA de
 * scripts/qa-*.ts con source-scan + invariantes (0.82/0.6/0.55…).
 */
import { describe, expect, it } from "vitest";

import {
  candidatosCodigo1D,
  normalizarNombre,
  similitud,
  tipoDeDigito,
} from "./clasificador";

// ─── normalizarNombre (§3.1) ───────────────────────────────────────────────

describe("normalizarNombre", () => {
  it("pasa a MAYÚSCULAS y colapsa espacios múltiples", () => {
    expect(normalizarNombre("josé maría  otero")).toBe("JOSE MARIA OTERO");
  });

  it("quita diacríticos vía NFKD (ÁÉÍÓÚÜÑ → AEIOUUN)", () => {
    expect(normalizarNombre("Árbó Ñoño Ünïcó")).toBe("ARBO NONO UNICO");
    expect(normalizarNombre("ÁÉÍÓÚÜÑ")).toBe("AEIOUUN");
  });

  it("recorta espacios de los extremos", () => {
    expect(normalizarNombre("  bogotá d.c.  ")).toBe("BOGOTA D.C.");
  });

  it("cadena vacía → vacía", () => {
    expect(normalizarNombre("")).toBe("");
  });

  it("solo espacios → vacía", () => {
    expect(normalizarNombre("   ")).toBe("");
  });

  it("tabs y saltos colapsan a UN espacio", () => {
    expect(normalizarNombre("a\tb\nc   d")).toBe("A B C D");
  });

  it("es idempotente", () => {
    const una = normalizarNombre("  Ínclita  Génovés ");
    expect(normalizarNombre(una)).toBe(una);
  });
});

// ─── similitud (Dice sobre trigramas, §3.3) ────────────────────────────────

describe("similitud", () => {
  it("cadenas idénticas → 1", () => {
    expect(similitud("BOGOTA D.C.", "BOGOTA D.C.")).toBe(1);
  });

  it("vacía vs vacía → 1 (por definición, sin trigramas)", () => {
    expect(similitud("", "")).toBe(1);
  });

  it("vacía vs no-vacía → 0", () => {
    expect(similitud("", "ABC")).toBe(0);
    expect(similitud("ABC", "")).toBe(0);
  });

  it("sin trigramas compartidos → 0", () => {
    expect(similitud("ABCDEFG", "XYZQRST")).toBe(0);
  });

  it("cadenas cortas (<3 chars): el string entero es el «trigrama»", () => {
    expect(similitud("AB", "AB")).toBe(1);
    expect(similitud("AB", "CD")).toBe(0);
  });

  it("mitad de trigramas compartidos → 0.5 exacto", () => {
    // ABCD → {ABC, BCD} · ABCE → {ABC, BCE} · intersección {ABC} → 2·1/(2+2)
    expect(similitud("ABCD", "ABCE")).toBe(0.5);
  });

  it("CASO REAL informe 120553: CALRO vs CAIRO → 0 (I↔L rompe los trigramas)", () => {
    // CALRO → {CAL, ALR, LRO} · CAIRO → {CAI, AIR, IRO} — intersección ∅.
    // La equivalencia I↔L la aplica normalizarNombreLugar (fuera de alcance
    // aquí), que convierte ambas en CALRO → 1. Documentado en kit e63f F1a.
    expect(similitud("CALRO", "CAIRO")).toBe(0);
  });

  it("tras un SOLO error de OCR los trigramas siguen coincidiendo parcialmente", () => {
    // BOGOTA vs BOGOTX: {BOG, OGO, GOT, OTA} vs {BOG, OGO, GOT, OTX} → 2·3/8
    expect(similitud("BOGOTA", "BOGOTX")).toBe(0.75);
  });
});

// ─── tipoDeDigito (gramática código 1D, ANALISIS §D.2/§F) ──────────────────

describe("tipoDeDigito", () => {
  it('d9=3 → TRANSMISION', () => {
    expect(tipoDeDigito("3")).toBe("TRANSMISION");
  });

  it('d9=2 → DELEGADOS', () => {
    expect(tipoDeDigito("2")).toBe("DELEGADOS");
  });
});

// ─── candidatosCodigo1D (kit consenso-frankfurt FASE 3, §4.1) ──────────────

describe("candidatosCodigo1D", () => {
  it("texto sin dígitos → []", () => {
    expect(candidatosCodigo1D("SIN CODIGOS AQUI")).toEqual([]);
  });

  it("vacía → []", () => {
    expect(candidatosCodigo1D("")).toEqual([]);
  });

  it("CASO REAL Frankfurt §0-F4: «/1000/453010202» → 710007453010202", () => {
    // La fuente de puntos del impreso renderiza el «7» como «/»:
    // /1000/453010202 = 7100|0745|3|01|02|02 (kit 745, TRANSMISIÓN, pág 1 de 2).
    expect(candidatosCodigo1D("/1000/453010202")).toEqual(["710007453010202"]);
  });

  it("el candidato puro de 15 dígitos NO se genera (lo cubre ANCLA_CODIGO_1D)", () => {
    // 710003993010102 es \d{15} limpio — el regex de candidatos solo agrega
    // ventanas que contienen «/» (los puros ya los atrapa el ancla, §7 kit).
    expect(candidatosCodigo1D("710003993010102")).toEqual([]);
  });

  it("espacios intermedios se pegan antes de ventanas de 15", () => {
    // «71009 453010202» (evidencia §4.1): pegado = 14 chars → SIN ventana de
    // 15 → [] (el OCR comió un dígito; nada que rescatar sin «/»).
    expect(candidatosCodigo1D("71009 453010202")).toEqual([]);
    // …con «/» el pegado llega a 15: «/10009 453010202» → 710009453010202.
    expect(candidatosCodigo1D("/10009 453010202")).toEqual(["710009453010202"]);
  });

  it("secuencia larga con «/» genera TODAS las ventanas de 15 (dedup via Set)", () => {
    // 17 caracteres pegados → 3 ventanas de 15, todas con «/»→«7».
    const out = candidatosCodigo1D("/1000/45301020299");
    expect(out).toHaveLength(3);
    expect(out.every((c) => c.length === 15 && !c.includes("/"))).toBe(true);
    expect(new Set(out).size).toBe(out.length); // sin duplicados
  });

  it("el candidato Frankfurt sobrevive rodeado de texto OCR ruidoso", () => {
    const texto = "E-14\nVERPAG: 01 02\nCODIGO /1000/453010202 x";
    expect(candidatosCodigo1D(texto)).toEqual(["710007453010202"]);
  });
});
