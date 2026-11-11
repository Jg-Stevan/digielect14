/**
 * C-08 — SHA-256 REAL de la evidencia (hash.ts): el hash del acta y del
 * sobre del puente son los BYTES reales de la foto procesada — jamás un
 * relleno (doctrina e14-sin-relleno). Casos:
 *  · dos fotos idénticas → MISMO hash (determinista) con formato hex 64.
 *  · foto modificada (un byte distinto) → hash DISTINTO.
 *  · el hash cubre los bytes DECODIFICADOS (el mime del envoltorio no manda).
 *  · sin crypto.subtle → null (campo ausente honesto).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256HexDeDataUrl } from "../hash";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("C-08 — sha256HexDeDataUrl (SHA-256 real de la evidencia)", () => {
  it("dos fotos idénticas → el MISMO hash, formato hex 64", async () => {
    const foto = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const a = await sha256HexDeDataUrl(foto);
    const b = await sha256HexDeDataUrl(foto);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("foto modificada (un byte distinto) → hash DISTINTO (hex 64 ambos)", async () => {
    const a = await sha256HexDeDataUrl("data:image/png;base64,AAAA"); // 00 00 00
    const b = await sha256HexDeDataUrl("data:image/png;base64,AAAB"); // 00 00 01
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("el hash cubre los BYTES decodificados — el mime del envoltorio no manda", async () => {
    const png = await sha256HexDeDataUrl("data:image/png;base64,AAAA");
    const jpeg = await sha256HexDeDataUrl("data:image/jpeg;base64,AAAA");
    expect(png).toBe(jpeg);
  });

  it("dataURL no parseable → hash determinista del string completo (hex 64)", async () => {
    const a = await sha256HexDeDataUrl("no-soy-un-dataurl");
    const b = await sha256HexDeDataUrl("no-soy-un-dataurl");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sin crypto.subtle → null (campo ausente honesto, jamás un relleno)", async () => {
    vi.stubGlobal("crypto", {} as typeof crypto);
    expect(await sha256HexDeDataUrl("data:image/png;base64,AAAA")).toBeNull();
  });
});
