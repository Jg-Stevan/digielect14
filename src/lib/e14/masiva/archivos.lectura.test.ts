/**
 * Tests unitarios — KIT ux-masiva-fixes-v1 (T1/§A.5): el clasificador PURO
 * `motivoDeErrorLectura` de archivos.ts (entorno node, sin pdfjs — el
 * motivo se decide SOLO por `err.name`, patrón de las partes puras).
 *
 * Cubre (kit §A.5):
 *  · NotReadableError (Error con name propio) → NO_SE_PUDO_LEER.
 *  · PasswordException-nombre → PROTEGIDO_O_CORRUPTO (correcto hoy, §0.3.3).
 *  · DOMException con otro nombre → PROTEGIDO_O_CORRUPTO.
 *  · no-Error (string / undefined) → PROTEGIDO_O_CORRUPTO.
 *
 * FUERA de alcance: los catches de zip/rar (motivo fijo honesto — el QA
 * qa-ux-masiva-fixes ancla que NO se tocaron) y el propio getDocument
 * (deferido, requiere navegador → QA de regresión).
 */
import { describe, expect, it, vi } from "vitest";

// El clasificador no toca imágenes — pero archivos.ts importa image-utils
// (canvas/scanner-core, infra DOM) en top-level. Mock mínimo (patrón del
// repo: runner-watchdog.test.ts) para mantener el entorno node puro.
vi.mock("../image-utils", () => ({
  canvasCon: vi.fn(),
  decodeImagenLruDeBlob: vi.fn(),
}));

import { motivoDeErrorLectura } from "./archivos";

describe("motivoDeErrorLectura — KIT ux-masiva-fixes-v1 T1 (UX-1)", () => {
  it("NotReadableError → NO_SE_PUDO_LEER", () => {
    const err = new Error("The source file could not be read");
    err.name = "NotReadableError";
    expect(motivoDeErrorLectura(err)).toBe("NO_SE_PUDO_LEER");
  });

  it("PasswordException (nombre) → PROTEGIDO_O_CORRUPTO", () => {
    const err = new Error("No password given");
    err.name = "PasswordException";
    expect(motivoDeErrorLectura(err)).toBe("PROTEGIDO_O_CORRUPTO");
  });

  it("DOMException con otro nombre → PROTEGIDO_O_CORRUPTO", () => {
    const err = new DOMException("abortado", "AbortError");
    expect(motivoDeErrorLectura(err)).toBe("PROTEGIDO_O_CORRUPTO");
  });

  it("no-Error (string / undefined) → PROTEGIDO_O_CORRUPTO", () => {
    expect(motivoDeErrorLectura("algo explotó")).toBe("PROTEGIDO_O_CORRUPTO");
    expect(motivoDeErrorLectura(undefined)).toBe("PROTEGIDO_O_CORRUPTO");
  });
});
