/**
 * P-22 (plan 2026-11-12) — TESTS de las HUELLAS del sobre del puente
 * (capa 2: qrPayload EXACTO · capa 3: dhash64 perceptual, respaldo sin QR).
 *
 * Congela el contrato que el panel de supervision-e14 consume (T-22 espejo):
 *  1. normalizarQrPayload: trim + NFKD sin diacríticos + mayúsculas + sin
 *     espacios; vacío/extraño → null (sin huella comparable, jamás relleno).
 *  2. hamming64: gemelo EXACTO del de masiva/dedup.ts del hermano — misma
 *     aritmética bit a bit (0 idénticos, n bits de distancia, longitudes
 *     distintas/ausentes → 64).
 *  3. dhash64DeDataUrl: hex 16 sobre foto decodificada; sin canvas disponible
 *     → null (conservador — el sobre sale sin la huella).
 *  4. mapearActaAPuente: el sobre sale con qrPayload+dhash64 cuando hay
 *     lectura y foto; sin código → sin qrPayload (ausente, no vacío).
 *
 * Canvas/ImageBitmap son DOM: se stubbean sobre el entorno node (el mismo
 * criterio del config: dependencias DOM mockeadas, nada de jsdom aquí).
 */
import { describe, expect, it, vi } from "vitest";

import { mapearActaAPuente } from "./mapear";
import { dhash64DeDataUrl, hamming64, normalizarQrPayload } from "./huellas";
import type { Acta } from "@jg-stevan/scanner-core/dominio/types";
import type { ClasificacionE14 } from "@jg-stevan/scanner-core/dominio/clasificador";

describe("normalizarQrPayload (capa 2 — igualdad EXACTA del payload)", () => {
  it("trim + mayúsculas + sin espacios internos", () => {
    expect(normalizarQrPayload("  710003993010102  ")).toBe("710003993010102");
    expect(normalizarQrPayload("71 0003 9930 10102")).toBe("710003993010102");
  });

  it("NFKD sin diacríticos (el OCR del código puede traer ruido)", () => {
    expect(normalizarQrPayload("TRÁNSMISION-1")).toBe("TRANSMISION-1");
    expect(normalizarQrPayload("cód 88")).toBe("COD88");
  });

  it("vacío / whitespace / no-string → null (sin huella, jamás relleno)", () => {
    expect(normalizarQrPayload("   ")).toBeNull();
    expect(normalizarQrPayload("")).toBeNull();
    expect(normalizarQrPayload(undefined)).toBeNull();
    expect(normalizarQrPayload(12345)).toBeNull();
  });
});

describe("hamming64 (gemelo EXACTO del del hermano)", () => {
  it("idénticos → 0 · un bit → 1", () => {
    expect(hamming64("0123456789abcdef", "0123456789abcdef")).toBe(0);
    expect(hamming64("0123456789abcdef", "0123456789abcdee")).toBe(1);
  });

  it("6 bits exactos (umbral D65) y 7 (fuera)", () => {
    // f0 = 11110000 → 4 bits por nibble: dos nibbles completos = 8; contar con
    // valores construidos: "0000000000000000" vs "1111111100000000" = 8.
    expect(hamming64("0000000000000000", "1111110000000000")).toBe(6);
    expect(hamming64("0000000000000000", "1111111000000000")).toBe(7);
  });

  it("longitudes distintas o ausentes → 64 (máxima distancia)", () => {
    expect(hamming64("0123", "0123456789abcdef")).toBe(64);
    expect(hamming64("", "0123456789abcdef")).toBe(64);
    expect(hamming64("", "")).toBe(64);
  });
});

describe("dhash64DeDataUrl (capa 3 — respaldo sin QR)", () => {
  /** Canvas falso 9×8: gradiente determinista → hash determinista. */
  function instalarCanvasFalso(ctxOk: boolean) {
    const ctx = {
      drawImage: vi.fn(),
      getImageData: () => {
        const data = new Uint8ClampedArray(9 * 8 * 4);
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 9; x++) {
            const i = (y * 9 + x) * 4;
            data[i] = x * 28; // gradiente horizontal: dhash estable
            data[i + 1] = x * 28;
            data[i + 2] = x * 28;
            data[i + 3] = 255;
          }
        }
        return { data };
      },
    };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => (ctxOk ? ctx : null)),
      })),
    });
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 9, height: 8, close: vi.fn() })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ blob: async () => new Blob(["foto"]) })),
    );
    return ctx;
  }

  it("foto decodificable → hex 16 determinista", async () => {
    instalarCanvasFalso(true);
    const a = await dhash64DeDataUrl("data:image/jpeg;base64,AAAA");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    const b = await dhash64DeDataUrl("data:image/jpeg;base64,AAAA");
    expect(a).toBe(b); // determinista (misma foto → misma huella)
    vi.unstubAllGlobals();
  });

  it("sin canvas disponible → null (el sobre sale sin la huella)", async () => {
    instalarCanvasFalso(false);
    expect(await dhash64DeDataUrl("data:image/jpeg;base64,AAAA")).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("mapearActaAPuente — el sobre lleva las huellas P-22", () => {
  /** Sobre la MISMA acta de los tests del puente (foto string + clasificación completa). */
  const FOTO = "data:image/png;base64,AAAA";
  const clasificacion = {
    departamento: { codigo: "88", nombre: "Bogotá" },
    municipio: { codigo: "495", nombre: "Roma" },
    zona: { codigo: "010" },
    puesto: { codigo: "02", nombre: "Consulado" },
    mesa: 1,
    tipo: "TRANSMISION",
    pagina: { index: 1, total: 2 },
  } as unknown as ClasificacionE14;

  function acta(overrides: Partial<Acta> = {}): Acta {
    return {
      fotoProcesada: FOTO,
      clasificacion,
      codigoBarras: "710003993010102",
      score: 9.2,
      status: "OPTIMA",
      ...overrides,
    } as unknown as Acta;
  }

  it("con lectura del código y foto → sobre con qrPayload normalizado", async () => {
    // dhash: canvas falso determinista (stub local a este test).
    const ctx = {
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(9 * 8 * 4).fill(0) }),
    };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => ctx),
      })),
    });
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ close: vi.fn() })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ blob: async () => new Blob(["foto"]) })),
    );
    vi.stubGlobal("crypto", {
      subtle: { digest: vi.fn(async () => new Uint8Array(32).fill(0)) },
    });

    const sobre = await mapearActaAPuente(acta());
    expect(sobre).not.toBeNull();
    expect(sobre?.qrPayload).toBe("710003993010102");
    expect(sobre?.dhash64).toMatch(/^[0-9a-f]{16}$/);
    vi.unstubAllGlobals();
  });

  it("sin lectura del código → sobre SIN qrPayload (ausente, jamás vacío)", async () => {
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({ getContext: vi.fn(() => null) })),
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => new Blob(["f"]) })));
    vi.stubGlobal("crypto", {
      subtle: { digest: vi.fn(async () => new Uint8Array(32).fill(0)) },
    });

    const sobre = await mapearActaAPuente(acta({ codigoBarras: "" }));
    expect(sobre).not.toBeNull();
    expect(sobre?.qrPayload).toBeUndefined();
    // dhash64 también ausente: el canvas falso no tiene contexto 2d.
    expect(sobre?.dhash64).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
