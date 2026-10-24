/**
 * Tests — WAVE3 §G (ORDEN-WAVE3-add-envio-individual-v1, obs-envio-
 * individual-v1): telemetría del ENVÍO individual + red del momento.
 *  · G.1 — registrarEnvio (punto único): individual online → envioMs
 *    estampado en actaActual.diagnostico.tiempos (contrato: envioMs != null
 *    ⇔ había red al enviar — offline → SIN campo, null honesto).
 *  · G.1 — vía registrarEnvioMasiva (actaEnvio ≠ actaActual) → actaActual
 *    INTACTO (sin doble stamp — la masiva la mide el runner con SU envioMs
 *    externo D61).
 *  · G.2 — redActual(): null honesto sin navigator.connection; valores con
 *    mock; la red viaja en el MISMO parche del envío individual.
 *  · G.3 — perfDeDiags agrega envioMs (envios/p50/p95) y enviosDetalleDe
 *    produce filas con actaIdHash (fnv1a8 — JAMÁS el id plano), modo por
 *    canal y SIN título/mesa/puesto/payload (qa-obs-privacidad manda).
 * Patrón: hang.test.ts (node + vi.stubGlobal) y runner-veto-postocr.test.ts
 * (vi.mock de la infra — ./cola en memoria para el envío MASIVA).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMock = vi.hoisted(() => ({
  escanearActa: vi.fn(() => new Promise(() => {})),
  horaEnvio: vi.fn(() => "12:00:00"),
  horaHistorial: vi.fn(() => "12:00:01"),
}));

vi.mock("../get-bridge", () => ({
  getBridge: vi.fn(() => bridgeMock),
}));
// ../store → scanner-core/ocr → image-processor (misma resolución rota en
// node que el patrón runner-veto-postocr — mismos mocks de la hoja):
vi.mock("@jg-stevan/scanner-core/ocr", () => ({
  ocrTextIsValid: vi.fn(() => true),
}));
vi.mock("@jg-stevan/scanner-core/image-processor", () => ({
  fileToCaptureDataUrl: vi.fn(() => "data:image/jpeg;base64,CAPTURE"),
}));

import { perfDeDiags, enviosDetalleDe, type FragDiag } from "./export";
import { redActual } from "./dispositivo";
import { useE14Store } from "../store";
import type { Acta } from "../types";

/** Acta individual con diagnóstico (status OPTIMA — el envío manual pasa). */
function actaIndividual(): Acta {
  return {
    id: "acta-ind-1",
    titulo: "TEST · MESA 001",
    status: "OPTIMA",
    rechazo: null,
    intento: 1,
    maxIntentos: 4,
    hashSha256: null,
    diagnostico: {
      ts: "2026-10-24T12:00:00.000Z",
      actaId: "acta-ind-1",
      intento: 1,
      maxIntentos: 4,
      status: "OPTIMA",
      rechazo: null,
      score: { visual: 9, final: 9, techos: [] },
      metricas: { sharpness: 1, brightness: 1, contrast: 1, sharpnessHi: 1, contrastPapel: 1, contrasteEfectivo: 1 },
      level: "excellent",
      lectura: { nivel: "FUERTE", anclas: 3, chars: 100 },
      senalActa: true,
      ocrValido: true,
      gate: { completa: true, fondo: true, recortada: false, ladoEsquina: null, votos: { densidadPct: 10, skipPag2: false, ok: true }, procesadaVacia: false, clasifNivel: "AUTO" },
      captura: { motor: "m", filtro: "f", crop: { w: 1, h: 1, fallback: false }, quad: [] as never, quadOrigen: null },
      tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 4_074, totalMs: 5_000 },
    } as never,
  } as unknown as Acta;
}

beforeEach(() => {
  vi.clearAllMocks();
  useE14Store.setState({
    online: true,
    actaActual: null,
    historial: [],
    colaOffline: 0,
    completadas: 0,
    asignadasHoy: 10,
    contarMotivoNoEnvioActa: vi.fn(),
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WAVE3 §G.1 — registrarEnvio individual mide su envío", () => {
  it("individual online → envioMs estampado en actaActual.diagnostico.tiempos + red del momento (G.2)", () => {
    vi.stubGlobal("navigator", { connection: { effectiveType: "4g", downlink: 1.5 } });
    useE14Store.setState({ online: true, actaActual: actaIndividual() } as never);

    useE14Store.getState().enviarActa();

    const acta = useE14Store.getState().actaActual!;
    expect(acta.status).toBe("ENVIADA");
    expect(typeof acta.diagnostico?.tiempos.envioMs).toBe("number");
    expect(acta.diagnostico?.tiempos.envioMs as number).toBeGreaterThanOrEqual(0);
    // §G.2 — la red del momento viaja en el MISMO parche (fuera de tiempos):
    expect(acta.diagnostico?.envioRedTipo).toBe("4g");
    expect(acta.diagnostico?.envioDownlinkMbps).toBe(1.5);
    expect(acta.hashSha256).not.toBe("EN COLA");
  });

  it("offline → SIN envioMs (null honesto, regla del contrato) y SIN red", () => {
    vi.stubGlobal("navigator", { connection: { effectiveType: "4g", downlink: 1.5 } });
    useE14Store.setState({ online: false, actaActual: actaIndividual() } as never);

    useE14Store.getState().enviarActa();

    const acta = useE14Store.getState().actaActual!;
    expect(acta.status).toBe("ENVIADA");
    expect("envioMs" in (acta.diagnostico?.tiempos ?? {})).toBe(false);
    expect(acta.diagnostico?.envioRedTipo).toBeUndefined();
    expect(acta.hashSha256).toBe("EN COLA"); // cola offline de siempre
  });
});

describe("WAVE3 §G.1 — vía registrarEnvioMasiva (actaEnvio) → actaActual INTACTO", () => {
  it("el envío MASIVA no estampa envioMs en actaActual (sin doble medición — la mide el runner D61)", () => {
    vi.stubGlobal("navigator", { connection: { effectiveType: "4g", downlink: 1.5 } });
    useE14Store.setState({ online: true, actaActual: actaIndividual() } as never);
    const antes = useE14Store.getState().actaActual!.diagnostico!.tiempos;

    // La masiva envía SU acta (actaEnvio ≠ actaActual — T3.3). El método
    // vive en el E14 store (registrarEnvioMasiva → registrarEnvio interno
    // con actaEnvio):
    const actaAjena = { ...actaIndividual(), id: "acta-masiva-9" } as unknown as Acta;
    useE14Store.getState().registrarEnvioMasiva(actaAjena);

    const acta = useE14Store.getState().actaActual!;
    expect(acta.id).toBe("acta-ind-1");
    expect("envioMs" in (acta.diagnostico?.tiempos ?? {})).toBe(false);
    expect(acta.diagnostico?.tiempos).toBe(antes); // MISMO objeto — intocable
    // el historial SÍ creció (el envío masiva registró su fila):
    expect(useE14Store.getState().historial.length).toBe(1);
  });
});

describe("WAVE3 §G.3 — perfDeDiags agrega el envío (aditivos AL FINAL)", () => {
  it("mezcla con/sin envioMs → envios/p50/p95 correctos; campos OCR intactos", () => {
    const frag = (envioMs: number | undefined): FragDiag =>
      ({
        tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 100, totalMs: 200, ...(envioMs !== undefined ? { envioMs } : {}) },
        gate: { completa: true },
      }) as FragDiag;
    const r = perfDeDiags([frag(120), frag(undefined), frag(480), frag(300)], []);
    expect(r.envios).toBe(3); // solo envioMs != null
    expect(r.p50EnvioMs).toBe(300);
    expect(r.p95EnvioMs).toBe(480);
    expect(r.actas).toBe(4);
    expect(r.p50OcrMs).toBe(100); // campos OCR INTACTOS
  });
});

describe("WAVE3 §G.3 — enviosDetalleDe (privacidad dura)", () => {
  it("fila con actaIdHash (fnv1a8 8 hex), modo por canal, SIN id plano ni contenido", () => {
    const fila: FragDiag = {
      tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 4074, totalMs: 5000, envioMs: 42 },
      gate: { completa: true },
      modo: "individual",
      status: "OPTIMA",
      envioRedTipo: "4g",
      envioDownlinkMbps: 1.5,
      actaIdHash: "0a1b2c3d",
    };
    const detalle = enviosDetalleDe([fila]);
    expect(detalle).toHaveLength(1);
    const d = detalle![0];
    expect(d.actaIdHash).toBe("0a1b2c3d");
    expect(d.actaIdHash).toMatch(/^[0-9a-f]{8}$/);
    expect(d.modo).toBe("individual");
    expect(d.status).toBe("OPTIMA");
    expect(d.envioMs).toBe(42);
    expect(d.envioRedTipo).toBe("4g");
    // PRIVACIDAD dura (qa-obs-privacidad): ni el id plano ni contenido:
    const plano = JSON.stringify(d);
    expect(plano).not.toContain("acta-ind-1");
    expect(plano).not.toContain("titulo");
    expect(plano).not.toContain("mesa");
    expect(plano).not.toContain("payload");
  });
  it("sin envíos medidos → undefined (campo omitido — informes previos no cambian de forma)", () => {
    expect(enviosDetalleDe([])).toBeUndefined();
    expect(
      enviosDetalleDe([
        { tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 1, totalMs: 2 }, gate: { completa: true } } as FragDiag,
      ]),
    ).toBeUndefined();
  });
});

describe("WAVE3 §G.2 — redActual (wrapper público de redDe)", () => {
  it("null honesto sin navigator.connection (iOS/Safari/SSR)", () => {
    vi.stubGlobal("navigator", {});
    expect(redActual()).toBeNull();
    vi.stubGlobal("navigator", { connection: null });
    expect(redActual()).toBeNull();
  });
  it("valores con connection (effectiveType + downlink numérico)", () => {
    vi.stubGlobal("navigator", { connection: { effectiveType: "4g", downlink: 1.5 } });
    expect(redActual()).toEqual({ tipo: "4g", downlinkMbps: 1.5 });
    // downlink no-numérico → null (jamás inventar):
    vi.stubGlobal("navigator", { connection: { effectiveType: "3g", downlink: "malo" } });
    expect(redActual()).toEqual({ tipo: "3g", downlinkMbps: null });
  });
});
