/**
 * Tests — W1 (KIT k1-obs-prioridad — brief Agente A): prioridad de fila
 * (paso 4 del dueño) en `siguientePendiente()` del runner.
 *
 *  · flag masivaPrioridad ON ⇒ sort por prioridad EFECTIVA:
 *      p(f) = f.estado === "DUPLICADA" ? 3 : (f.prioridadProceso ?? 2)
 *    con desempate FIFO (agregadaEn) DENTRO de cada prioridad:
 *      1 (QR leído + quad OK) → 2 (sin QR / sin stamp) → 3 (DUPLICADA).
 *  · DUPLICADA derivada POR ESTADO (jamás por un campo — una sola fuente
 *    de verdad): la gemela más vieja del lote va AL FINAL igual.
 *  · flag OFF ⇒ el sort de HOY byte-idéntico (FIFO puro por agregadaEn,
 *    el campo prioridadProceso se IGNORA aunque venga estampado).
 *
 * PATRÓN: runner-rechequeo.test.ts (entorno node + vi.mock de la infra
 * DOM/worker/IDB/bridge + store REAL vía setState) + export SOLO-TEST de
 * siguientePendiente (mismo precedente del export de procesarUno — WAVE2
 * B1). El consumo se simula retirando del store la fila devuelta (el
 * filtro real también excluye reservadas/PROCESANDO — aquí sin pool).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Flags controlados por test (mock ANTES de importar — hoisted).
const flagsState = vi.hoisted(() => ({
  prioridad: false, // W1 — masivaPrioridad
}));
vi.mock("../flags", () => ({
  leerFlags: () => ({
    poolWorkers: 2,
    thumbsOn: true,
    telemetriaSalud: true,
    endpointReportes: null,
    colaPersistente: true,
    sondeoQrPrecoz: true,
    sondeoQrPresupuestoMs: 2500,
    hangEnCurso: true,
    prescanQrCola: true,
    qrBrujulaOrientacion: true,
    masivaQrHandoff: false,
    masivaQuad: false,
    masivaStreaming: false, // P5 OFF — el filtro del turno queda INERTE aquí
    dhashResize: false,
    masivaPrioridad: flagsState.prioridad,
  }),
}));

vi.mock("@jg-stevan/scanner-core/detector-client", () => ({
  getScannerWorker: vi.fn(() => null),
  warmUpScannerWorker: vi.fn(() => {}),
}));
vi.mock("../ocr/rapidocr", () => ({
  rapidOcrReiniciar: vi.fn(() => Promise.resolve()),
}));
vi.mock("@jg-stevan/scanner-core/image-processor", () => ({
  fileToCaptureDataUrl: vi.fn(() => ""),
}));
vi.mock("../get-bridge", () => ({ getBridge: vi.fn() }));
vi.mock("./precalor", () => ({
  asegurarMaestro: vi.fn(() => Promise.resolve()),
  consumirMaestro: vi.fn(() => null),
  descartarMaestro: vi.fn(),
  cablearPrecalor: vi.fn(), // store.ts lo llama a nivel de módulo (no-op aquí)
}));
vi.mock("./runner-thumbs", () => ({ hacerThumb: vi.fn() }));
vi.mock("./runner-dedup", () => ({ esperarDesenlaceOriginal: vi.fn() }));
vi.mock("./identidad-qr", () => ({
  decodificarQrDeCapture: vi.fn(),
  esperarDesenlaceQr: vi.fn(),
  qrCorto: vi.fn(() => null),
}));
vi.mock("./cola", () => ({
  agregarLote: vi.fn(),
  borrar: vi.fn(),
  guardarRegistro: vi.fn(() => Promise.resolve()),
  leerRegistro: vi.fn(),
  listarMapeados: vi.fn(() => Promise.resolve([])),
  recuperarCola: vi.fn(() => Promise.resolve([])),
  vaciar: vi.fn(),
}));
vi.mock("../../logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useMasivaStore } from "./store";
import { siguientePendiente } from "./runner";
import type { FilaMasiva } from "./tipos";

/** Fila liviana mínima bien tipada (lo que el mini-store maneja). */
function fila(
  id: string,
  agregadaEn: number,
  extra: Partial<FilaMasiva> = {},
): FilaMasiva {
  return { id, nombre: id, agregadaEn, estado: "PENDIENTE", ...extra };
}

/** Simula el CONSUMO del pool: retira del store la fila devuelta y la
 *  apila en el orden de salida (siguientePendiente no muta — el runner
 *  real reserva; aquí el retiro expresa la misma secuencia). */
function drenar(lotes = 10): string[] {
  const salida: string[] = [];
  for (let i = 0; i < lotes; i++) {
    const f = siguientePendiente();
    if (!f) break;
    salida.push(f.id);
    useMasivaStore.setState({
      filas: useMasivaStore.getState().filas.filter((x) => x.id !== f.id),
    });
  }
  return salida;
}

beforeEach(() => {
  flagsState.prioridad = false;
  useMasivaStore.setState({ filas: [], progreso: null });
});

describe("k1-obs-prioridad W1 · siguientePendiente — sort por prioridad efectiva (flag ON)", () => {
  it("51 · 3 prioridades: 1 (QR+quad) antes que 2 antes que DUPLICADA; FIFO dentro de cada una", () => {
    flagsState.prioridad = true;
    useMasivaStore.setState({
      filas: [
        // prioridad 2 — la más vieja del lote, pero NO primera (el QR manda)
        fila("f-2a", 100, { prioridadProceso: 2 }),
        // prioridad 1 — dos filas: FIFO interno 300 < 900
        fila("f-1a", 300, { prioridadProceso: 1 }),
        fila("f-1b", 900, { prioridadProceso: 1 }),
        // DUPLICADA — la más vieja de TODAS (50): igual va AL FINAL (3)
        fila("f-dup", 50, { estado: "DUPLICADA", dupOf: "f-origen" }),
        // prioridad 2 — la segunda de su clase (600 > 100)
        fila("f-2b", 600, { prioridadProceso: 2 }),
      ],
    });
    expect(drenar()).toEqual(["f-1a", "f-1b", "f-2a", "f-2b", "f-dup"]);
  });

  it("52 · default efectivo 2: fila SIN campo equivale a prioridadProceso 2 (FIFO entre ellas)", () => {
    flagsState.prioridad = true;
    useMasivaStore.setState({
      filas: [
        fila("f-sin-campo", 200), // sin estampado → default efectivo 2
        fila("f-1", 999, { prioridadProceso: 1 }), // la mejor: primera pese a ser la más nueva
        fila("f-con-2", 100, { prioridadProceso: 2 }), // dentro de 2: 100 < 200
      ],
    });
    expect(drenar()).toEqual(["f-1", "f-con-2", "f-sin-campo"]);
  });

  it("53 · DUPLICADA derivada POR ESTADO (una sola fuente de verdad): aunque el lote entero sea 1, la gemela cierra", () => {
    flagsState.prioridad = true;
    useMasivaStore.setState({
      filas: [
        fila("f-dup", 10, { estado: "DUPLICADA", dupOf: "f-origen" }), // la más vieja
        fila("f-1a", 20, { prioridadProceso: 1 }),
        fila("f-1b", 30, { prioridadProceso: 1 }),
      ],
    });
    expect(drenar()).toEqual(["f-1a", "f-1b", "f-dup"]);
  });
});

describe("k1-obs-prioridad W1 · siguientePendiente — flag OFF = orden de HOY byte-idéntico", () => {
  it("54 · FIFO puro por agregadaEn: el campo prioridadProceso se IGNORA (aunque venga estampado)", () => {
    useMasivaStore.setState({
      filas: [
        fila("f-dup", 50, { estado: "DUPLICADA", dupOf: "f-origen" }),
        fila("f-2a", 100, { prioridadProceso: 2 }),
        fila("f-1a", 300, { prioridadProceso: 1 }), // prioridad 1, pero tercia por edad
        fila("f-sin", 400),
      ],
    });
    // Orden de hoy: la DUPLICADA más vieja primero (entra al loop — copia
    // rápida <1 s), las prioridades estampadas NO reordenan nada.
    expect(drenar()).toEqual(["f-dup", "f-2a", "f-1a", "f-sin"]);
  });

  it("55 · flag OFF tras estar ON (kill switch en vivo) → vuelve el FIFO de hoy", () => {
    flagsState.prioridad = true;
    useMasivaStore.setState({
      filas: [
        fila("f-2a", 100, { prioridadProceso: 2 }),
        fila("f-1a", 300, { prioridadProceso: 1 }),
      ],
    });
    expect(siguientePendiente()?.id).toBe("f-1a");
    flagsState.prioridad = false; // el dueño apaga el flag a mitad de cola
    expect(siguientePendiente()?.id).toBe("f-2a"); // FIFO puro otra vez
  });
});
