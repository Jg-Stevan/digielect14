/**
 * Tests unitarios — runner-watchdog.ts (partes PURAS del split C1).
 * SPRINT-C · C4 opcional (refactor/runner-logger-v1) — patrón del kit
 * Prioridad 2 (entorno node, vi.mock de la infra DOM/worker; copia el
 * patrón de completitud.test.ts).
 *
 * Cubre:
 *  · etapaDeSenal — vocabulario T1.4 (null jamás inventa etapa).
 *  · esVeredictoTimeout — SOLO el veredicto ILEGIBLE + DETALLE_TIMEOUT.
 *  · actaTimeoutWatchdog — MISMA forma del acta de timeout del bridge
 *    (score 0, RECHAZADA, firmas del seed con la 2.ª NO_DETECTADO).
 *  · correrIntento — tríada de la carrera: acta | error | tope (sin fuga
 *    de timer: el timeout limpia al resolver).
 *  · matarYRecrearWorkers — infraestructura con worker/OCR mockeados:
 *    dispose + warmUp + reinicio OCR, jamás lanza (cinturón).
 *
 * FUERA de alcance (requieren IndexedDB/bridge reales → QA de regresión):
 * el bucle del pool, el mutex de dedup y el bloque capa-0 (qa-*.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@jg-stevan/scanner-core/detector-client", () => ({
  getScannerWorker: vi.fn(() => null),
  warmUpScannerWorker: vi.fn(() => {}),
}));
vi.mock("../ocr/rapidocr", () => ({
  rapidOcrReiniciar: vi.fn(() => Promise.resolve()),
}));

import { getScannerWorker, warmUpScannerWorker } from "@jg-stevan/scanner-core/detector-client";
import { ACTA_MOCK } from "../seed";
import { rapidOcrReiniciar } from "../ocr/rapidocr";
import type { Acta, EtapaAnalisis } from "../types";
import {
  actaTimeoutWatchdog,
  correrIntento,
  esVeredictoTimeout,
  etapaDeSenal,
  matarYRecrearWorkers,
} from "./runner-watchdog";

/** Acta mínima bien tipada (solo lo que consumen los SUT). */
function actaTest(parche: Partial<Acta> = {}): Acta {
  return {
    id: "acta-test",
    titulo: "TEST",
    ubicacion: {
      departamento: "D",
      municipio: "M",
      zona: "Z",
      puesto: "P",
      mesa: "001",
    },
    tipo: "T",
    pagina: { index: 1, total: 2 },
    candidatos: [],
    firmas: [],
    codigoBarras: "",
    score: 9,
    status: "OPTIMA",
    rechazo: null,
    intento: 1,
    maxIntentos: 4,
    ...parche,
  };
}

describe("etapaDeSenal (D65 T1.4 — vocabulario de la traza)", () => {
  it("sin señal → null (jamás inventar)", () => {
    expect(etapaDeSenal(null)).toBeNull();
  });

  it("OCR → «ocr»", () => {
    const s = { etapa: "OCR" as EtapaAnalisis, fraccion: 0.5 };
    expect(etapaDeSenal(s)).toBe("ocr");
  });

  it("CALIDAD → «verificacion»", () => {
    expect(etapaDeSenal({ etapa: "CALIDAD", fraccion: 1 })).toBe("verificacion");
  });

  it("DETECTANDO con fracción ≤ 0.5 → «decodificando»", () => {
    expect(etapaDeSenal({ etapa: "DETECTANDO", fraccion: 0.5 })).toBe("decodificando");
  });

  it("DETECTANDO con fracción > 0.5 → «deteccion»", () => {
    expect(etapaDeSenal({ etapa: "DETECTANDO", fraccion: 0.51 })).toBe("deteccion");
  });

  it("RECORTANDO / REALZANDO → «deteccion» (cola del encuadre)", () => {
    expect(etapaDeSenal({ etapa: "RECORTANDO", fraccion: 0.8 })).toBe("deteccion");
    expect(etapaDeSenal({ etapa: "REALZANDO", fraccion: 0.9 })).toBe("deteccion");
  });
});

describe("esVeredictoTimeout (D65 T1 — detección del vencimiento)", () => {
  it("ILEGIBLE + TIEMPO DE PROCESADO EXCEDIDO → true", () => {
    const a = actaTest({
      status: "RECHAZADA",
      score: 0,
      rechazo: { tipo: "ILEGIBLE", detalle: "TIEMPO DE PROCESADO EXCEDIDO" },
    });
    expect(esVeredictoTimeout(a)).toBe(true);
  });

  it("ILEGIBLE con OTRO detalle → false (un rechazo real jamás lo lleva)", () => {
    const a = actaTest({
      status: "RECHAZADA",
      rechazo: { tipo: "ILEGIBLE", detalle: "ILEGIBLE - SIN CONTENIDO" },
    });
    expect(esVeredictoTimeout(a)).toBe(false);
  });

  it("otro tipo de rechazo → false", () => {
    const a = actaTest({
      status: "RECHAZADA",
      rechazo: { tipo: "SIN_VOTOS", detalle: "TIEMPO DE PROCESADO EXCEDIDO" },
    });
    expect(esVeredictoTimeout(a)).toBe(false);
  });

  it("sin rechazo → false", () => {
    expect(esVeredictoTimeout(actaTest())).toBe(false);
  });
});

describe("actaTimeoutWatchdog (D65 T1.3 — misma forma del acta del bridge)", () => {
  it("veredicto honesto de «murió el procesado»: score 0 + RECHAZADA/ILEGIBLE", () => {
    const a = actaTimeoutWatchdog("fila-9");
    expect(a.id).toBe("acta-watchdog-fila-9");
    expect(a.score).toBe(0);
    expect(a.status).toBe("RECHAZADA");
    expect(a.rechazo).toEqual({
      tipo: "ILEGIBLE",
      detalle: "TIEMPO DE PROCESADO EXCEDIDO",
    });
    expect(a.intento).toBe(1); // el watchdog NO es re-captura
    expect(a.fuente).toBe("ARCHIVO");
  });

  it("firmas del seed: la 2.ª NO_DETECTADO (misma regla del bridge)", () => {
    const a = actaTimeoutWatchdog("fila-1");
    expect(a.firmas).toHaveLength(3);
    expect(a.firmas[0].estado).toBe("OK");
    expect(a.firmas[1].estado).toBe("NO_DETECTADO");
    expect(a.firmas[2].estado).toBe("OK");
    expect(a.titulo).toBe(ACTA_MOCK.titulo); // título del seed, byte-idéntico
    expect(a.candidatos).toHaveLength(ACTA_MOCK.candidatos.length); // candidatos del seed
  });
});

describe("correrIntento (D65 T1 — carrera acta | error | tope)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("el bridge resuelve → {tipo:'acta'} y el timer se limpia (sin fuga)", async () => {
    const acta = actaTest();
    const desenlace = await correrIntento(Promise.resolve(acta), 10_000);
    expect(desenlace).toEqual({ tipo: "acta", acta });
    // el timer del tope quedó cancelado: avanzar el reloj NO re-resuelve
    expect(vi.getTimerCount()).toBe(0);
  });

  it("el bridge rechaza → {tipo:'error'} con el error ORIGINAL", async () => {
    const boom = new Error("PIPELINE_ROTO");
    const desenlace = await correrIntento(Promise.reject(boom), 10_000);
    expect(desenlace).toEqual({ tipo: "error", error: boom });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("colgaje total → {tipo:'tope'} al vencer el presupuesto", async () => {
    const nunca = new Promise<Acta>(() => {}); // jamás resuelve
    const desenlace = correrIntento(nunca, 50);
    await vi.advanceTimersByTimeAsync(51);
    await expect(desenlace).resolves.toEqual({ tipo: "tope" });
  });
});

describe("matarYRecrearWorkers (D65 T1.2 — infra, jamás lanza)", () => {
  it("dispose del worker + warmUp + reinicio OCR en orden", async () => {
    const dispose = vi.fn();
    vi.mocked(getScannerWorker).mockReturnValue({ dispose } as never);
    await matarYRecrearWorkers();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(vi.mocked(warmUpScannerWorker)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rapidOcrReiniciar)).toHaveBeenCalledTimes(1);
  });

  it("worker ya muerto (dispose lanza) → sigue el rescate sin propagar", async () => {
    vi.mocked(getScannerWorker).mockReturnValue({
      dispose: () => {
        throw new Error("WORKER_MUERTO");
      },
    } as never);
    vi.mocked(rapidOcrReiniciar).mockRejectedValue(new Error("OCR_REINICIO"));
    await expect(matarYRecrearWorkers()).resolves.toBeUndefined(); // cinturón
    expect(vi.mocked(warmUpScannerWorker)).toHaveBeenCalledTimes(1);
  });
});
