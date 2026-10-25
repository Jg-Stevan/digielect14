/**
 * Tests unitarios — KIT ux-masiva-fixes-v1 (T4/§D.4, UX-4):
 * `porcentajeProcesoActa` (parte PURA exportada de MasivaView.tsx —
 * entorno node, sin DOM; el componente NO se renderiza).
 *
 * Cubre:
 *  · no-activa CON entrada en el mapa → su ÚLTIMO frac real (UX-4).
 *  · no-activa SIN entrada → 20 (zombi de recarga, igual que hoy).
 *  · activa → frac del progreso (clamp 1..99).
 *  · LISTA → 100 · ERROR → 0 (sin cambios).
 *  · secuencia alternada 2 filas (pool) donde NINGUNA retrocede.
 */
import { describe, expect, it, vi } from "vitest";

// La función bajo test es PURA, pero MasivaView.tsx importa en top-level
// stores/hooks de navegación y OCR (infra DOM/scanner-core). Mocks mínimos
// con factory (patrón del repo: runner-watchdog.test.ts) — el módulo real
// JAMÁS se carga, la función pura queda aislada. Requiere el alias "@"
// añadido a vitest.config.ts (M-ux-1) para registrar los mocks por id.
vi.mock("@/lib/e14/store", () => ({ useE14Store: () => ({}) }));
vi.mock("@/lib/e14/masiva/store", () => ({
  refrescarEnviosTrasDrenaje: vi.fn(),
  useMasivaStore: () => ({}),
}));
vi.mock("@/lib/e14/ocr/rapidocr", () => ({ rapidOcrPrecalentar: vi.fn() }));

import { porcentajeProcesoActa } from "../../../components/e14/screens/MasivaView";
import type { FilaMasiva } from "./tipos";

function fila(id: string, estado: FilaMasiva["estado"]): FilaMasiva {
  return { id, nombre: `${id}.jpg`, agregadaEn: 0, estado } as FilaMasiva;
}

describe("porcentajeProcesoActa — KIT ux-masiva-fixes-v1 T4 (UX-4)", () => {
  it("no-activa CON entrada en el mapa → su último frac real", () => {
    const mapa = new Map([["f1", 0.55]]);
    expect(
      porcentajeProcesoActa(fila("f1", "PROCESANDO"), false, null, mapa),
    ).toBe(55);
  });

  it("no-activa SIN entrada → 20 (zombi de recarga, igual que hoy)", () => {
    expect(
      porcentajeProcesoActa(fila("f9", "PROCESANDO"), false, null, new Map()),
    ).toBe(20);
  });

  it("no-activa no-PROCESANDO → 0 (sin cambios)", () => {
    expect(
      porcentajeProcesoActa(fila("f2", "PENDIENTE"), false, null, new Map()),
    ).toBe(0);
  });

  it("activa → frac del progreso con clamp 1..99", () => {
    const progreso = { id: "f1", fracGlobal: 0.4166 };
    expect(
      porcentajeProcesoActa(fila("f1", "PROCESANDO"), true, progreso, new Map()),
    ).toBe(42);
    const alto = { id: "f1", fracGlobal: 0.9999 };
    expect(
      porcentajeProcesoActa(fila("f1", "PROCESANDO"), true, alto, new Map()),
    ).toBe(99);
  });

  it("LISTA → 100 · ERROR → 0 (independiente del mapa/progreso)", () => {
    const mapa = new Map([["f3", 0.7]]);
    expect(porcentajeProcesoActa(fila("f3", "LISTA"), false, null, mapa)).toBe(100);
    expect(porcentajeProcesoActa(fila("f4", "ERROR"), false, null, mapa)).toBe(0);
  });

  it("secuencia alternada 2 filas (pool) — NINGUNA retrocede", () => {
    const mapa = new Map<string, number>();
    const a = fila("A", "PROCESANDO");
    const b = fila("B", "PROCESANDO");
    // Turno de A (activa): avanza 14 → 40 y queda grabado.
    const pA1 = { id: "A", fracGlobal: 0.14 };
    expect(porcentajeProcesoActa(a, true, pA1, mapa)).toBe(14);
    const pA2 = { id: "A", fracGlobal: 0.4 };
    expect(porcentajeProcesoActa(a, true, pA2, mapa)).toBe(40);
    mapa.set("A", 0.4); // el efecto del componente alimenta el mapa
    // Turno de B (activa): A cede el progreso → SE QUEDA en 40 (no 20).
    const pB1 = { id: "B", fracGlobal: 0.22 };
    expect(porcentajeProcesoActa(b, true, pB1, mapa)).toBe(22);
    mapa.set("B", 0.22);
    expect(porcentajeProcesoActa(a, false, pB1, mapa)).toBe(40);
    // B sigue creciendo; A sigue congelada en su último real; B no baja.
    const pB2 = { id: "B", fracGlobal: 0.65 };
    mapa.set("B", 0.65);
    expect(porcentajeProcesoActa(b, true, pB2, mapa)).toBe(65);
    expect(porcentajeProcesoActa(a, false, pB2, mapa)).toBe(40);
    expect(porcentajeProcesoActa(b, false, pA2, mapa)).toBe(65);
  });
});
