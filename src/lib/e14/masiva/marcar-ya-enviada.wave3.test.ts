/**
 * Tests — WAVE3 (obs-informe-wave3-v1) · C.2 Task 2: marcarYaEnviada gana
 * el parámetro opcional `dedupValor` (puerta del veto — D57 AL FINAL):
 *  · default (sin 8.º argumento) → dedup "ya-enviada" — SIN cambio de
 *    contrato para los callers existentes (capa 0 payload, bytes, dhash).
 *  · "ya-enviada-postocr" → la marca estampa la puerta (H1 — el OCR ya
 *    se pagó; distingue la ruta en el informe y en el post-mortem).
 * El write conserva su literal `dedup: "ya-enviada",` byte a byte (ancla
 * QA qa-historico-enviadas) — la puerta viaja como spread condicional.
 * Patrón: runner-veto-postocr.test.ts (node + vi.mock de la infra
 * DOM/worker/IDB/bridge; ./cola con mapa en memoria — lectura REAL de
 * registro para el guard y el spread).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Puente ESTABLE (una sola instancia — store.ts importa ./runner):
const bridgeMock = vi.hoisted(() => ({
  escanearActa: vi.fn(() => new Promise(() => {})),
  horaEnvio: vi.fn(() => "12:00:00"),
}));

vi.mock("@jg-stevan/scanner-core/detector-client", () => ({
  getScannerWorker: vi.fn(() => null),
  warmUpScannerWorker: vi.fn(() => {}),
}));
vi.mock("../ocr/rapidocr", () => ({
  rapidOcrReiniciar: vi.fn(() => Promise.resolve()),
}));
vi.mock("@jg-stevan/scanner-core/image-processor", () => ({
  fileToCaptureDataUrl: vi.fn(() => "data:image/jpeg;base64,CAPTURE"),
}));
vi.mock("../get-bridge", () => ({
  getBridge: vi.fn(() => bridgeMock),
}));
vi.mock("./precalor", () => ({
  asegurarMaestro: vi.fn(() => Promise.resolve()),
  consumirMaestro: vi.fn(() => null),
  descartarMaestro: vi.fn(),
  cablearPrecalor: vi.fn(),
}));
vi.mock("./archivos", () => ({
  maestroDeImagen: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("./runner-thumbs", () => ({
  hacerThumb: vi.fn(() => Promise.resolve("data:image/jpeg;base64,THUMB")),
}));
vi.mock("./runner-dedup", () => ({
  esperarDesenlaceOriginal: vi.fn(() => Promise.resolve(false)),
}));
vi.mock("./runner-watchdog", () => ({
  correrIntento: vi.fn(),
  actaTimeoutWatchdog: vi.fn(),
  esVeredictoTimeout: vi.fn(() => false),
  etapaDeSenal: vi.fn(() => null),
  matarYRecrearWorkers: vi.fn(() => Promise.resolve()),
}));
vi.mock("./origen", () => ({
  clasificarOrigenDeArchivo: vi.fn(() =>
    Promise.resolve({ origen: null, senales: null }),
  ),
}));
vi.mock("./deskew", () => ({
  preProcesoEscaneo: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("./relectura", () => ({
  procedeRelecturaInterna: vi.fn(() => false),
  desenlaceTrasRelectura: vi.fn(),
}));
vi.mock("./identidad", () => ({
  identidadDeActa: vi.fn(() => null),
}));
vi.mock("./identidad-qr", () => ({
  decodificarQrDeCapture: vi.fn(() => Promise.resolve(null)),
  esperarDesenlaceQr: vi.fn(),
  qrCorto: vi.fn((p: string) => p.slice(0, 8)),
}));
// IDB EN MEMORIA — lectura/escritura REALES (el guard del veto lee registro):
const colaMapa = vi.hoisted(() => new Map<string, unknown>());
vi.mock("./cola", () => ({
  agregarLote: vi.fn(),
  borrar: vi.fn(),
  guardarRegistro: vi.fn(async (r: unknown) => {
    const reg = r as { id: string };
    colaMapa.set(reg.id, r);
  }),
  leerRegistro: vi.fn(async (id: string) => {
    const r = colaMapa.get(id);
    if (!r) throw new Error("registro ausente");
    return r;
  }),
  listarMapeados: vi.fn(() => Promise.resolve([])),
  recuperarCola: vi.fn(() => Promise.resolve([])),
  vaciar: vi.fn(),
}));
vi.mock("./historico", () => ({
  borrarHistorico: vi.fn(() => Promise.resolve()),
  listarHistorico: vi.fn(() => Promise.resolve([])),
  registrarEntradaHistorico: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { guardarRegistro } from "./cola";
import { useE14Store } from "../store";
import { marcarYaEnviada, useMasivaStore } from "./store";
import type { FilaMasiva, RegistroMasiva } from "./tipos";

function registroEnCola(id: string, estado: RegistroMasiva["estado"]): RegistroMasiva {
  return {
    id,
    nombre: `${id}.jpg`,
    agregadaEn: 1,
    estado,
    archivo: new File(["bytes"], `${id}.jpg`, { type: "image/jpeg" }),
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  colaMapa.clear();
  useE14Store.setState({
    online: true,
    registrarEnvioMasiva: vi.fn(),
    contarMotivoNoEnvioActa: vi.fn(),
  });
  await useMasivaStore.getState().vaciar();
  useMasivaStore.setState({ filas: [], progreso: null });
});

describe("WAVE3 C.2 — marcarYaEnviada dedupValor (puerta del veto, D57 AL FINAL)", () => {
  it("default (sin 8.º argumento) → dedup 'ya-enviada' — callers existentes SIN cambio de contrato", async () => {
    useMasivaStore.setState({
      filas: [
        { id: "F1", nombre: "F1.jpg", agregadaEn: 1, estado: "PROCESANDO" } as FilaMasiva,
      ],
    });
    colaMapa.set("F1", registroEnCola("F1", "PROCESANDO"));

    const marcada = await marcarYaEnviada(
      "F1",
      "ORIG-9",
      "payload",
      undefined,
      undefined,
      "payload-qr-1",
      true,
    );

    expect(marcada).toBe(true);
    const escrito = vi.mocked(guardarRegistro).mock.calls.map((c) => c[0] as RegistroMasiva)
      .find((r) => r.estado === "YA-ENVIADA");
    expect(escrito).toBeDefined();
    expect(escrito?.dedup).toBe("ya-enviada"); // literal intacto (ancla QA)
    expect(escrito?.enviadaDe).toBe("ORIG-9");
    expect(escrito?.qrPayload).toBe("payload-qr-1");
  });

  it("dedupValor 'ya-enviada-postocr' → la puerta se estampa (H1 — OCR ya pagado)", async () => {
    useMasivaStore.setState({
      filas: [
        { id: "F2", nombre: "F2.jpg", agregadaEn: 2, estado: "PROCESANDO" } as FilaMasiva,
      ],
    });
    colaMapa.set("F2", registroEnCola("F2", "PROCESANDO"));

    const marcada = await marcarYaEnviada(
      "F2",
      "ORIG-7",
      "payload",
      undefined,
      undefined,
      "payload-qr-2",
      true,
      "ya-enviada-postocr",
    );

    expect(marcada).toBe(true);
    const escrito = vi.mocked(guardarRegistro).mock.calls.map((c) => c[0] as RegistroMasiva)
      .find((r) => r.estado === "YA-ENVIADA");
    expect(escrito).toBeDefined();
    expect(escrito?.dedup).toBe("ya-enviada-postocr");
  });
});
