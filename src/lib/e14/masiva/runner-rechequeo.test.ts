/**
 * Tests unitarios — WAVE2 B1 (perf/dedup-rechequeo-reserva-v1): re-chequeo
 * post-reserva en `procesarUno` (cierre de la carrera ingesta×pool).
 *
 * Patrón: runner-watchdog.test.ts (entorno node + vi.mock de la infra
 * DOM/worker/IDB/bridge). El kit exige test CONDUCTUAL:
 *  · snapshot PENDIENTE + store con la fila YA `DUPLICADA`+`dupOf` (la
 *    carrera real: cadenaDedup — ingesta background FIFO — la marcó entre
 *    siguientePendiente() y la entrada de procesarUno) → procesarUno entra
 *    por REUSO: OCR jamás invocado (getBridge() sin llamadas), traza
 *    `re-chequeo post-reserva` emitida, copia e71/e72 completa (ocrMs = 0).
 *  · caso negativo: fila fresca PENDIENTE → pipeline normal (0 cambios —
 *    la fila deja la puerta dedup, consume precalor y muere honesta en
 *    ERROR cuando el registro del mock trae un archivo que NO es File).
 *  · orden fuente: el re-chequeo alimenta la rama DUPLICADA EXISTENTE —
 *    el bloque e72 (reutilizar → esperarDesenlaceOriginal → fallback
 *    des-marcar/reprocesar) queda intacto byte a byte (kit B1 literal).
 *
 * FUERA de alcance (QA de regresión, scripts/qa-dedup-enviadas.ts): el
 * bloque e72 completo, el pool, el mutex y las anclas del QA.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { guardarRegistro, leerRegistro } from "./cola";
import { getBridge } from "../get-bridge";
import { consumirMaestro } from "./precalor";
import { logger } from "../../logger";
import { useMasivaStore } from "./store";
import { procesarUno } from "./runner";
import type { FilaMasiva, RegistroMasiva } from "./tipos";
import type { Acta } from "../types";

/** Acta original mínima bien tipada (lo que consume reutilizarResultadoCritica):
 *  status ENVIADA + diagnostico.tiempos con ocrMs > 0 — la copia debe mostrar
 *  ocrMs = 0 (guard e72) y status DUPLICADA (e66). */
function actaOrigen(parche: Partial<Acta> = {}): Acta {
  return {
    id: "acta-original",
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
    status: "ENVIADA",
    rechazo: null,
    intento: 1,
    maxIntentos: 4,
    hashSha256: "hash-original",
    diagnostico: {
      ts: "2026-10-23T00:00:00.000Z",
      actaId: "acta-original",
      intento: 1,
      maxIntentos: 4,
      status: "ENVIADA",
      rechazo: null,
      score: { visual: 9, final: 9, techos: [] },
      metricas: {
        sharpness: 100,
        brightness: 128,
        contrast: 50,
        sharpnessHi: 100,
        contrastPapel: 50,
        contrasteEfectivo: 50,
      },
      level: "excellent",
      lectura: { nivel: "FUERTE", anclas: 10, chars: 500 },
      senalActa: true,
      ocrValido: true,
      gate: {
        completa: true,
        gateMarco: "completo",
        fondo: true,
        recortada: false,
        ladoEsquina: null,
        votos: { densidadPct: 5, skipPag2: false, ok: true },
        procesadaVacia: false,
        clasifNivel: "excellent",
      },
      captura: {
        motor: "test",
        filtro: "test",
        crop: { w: 100, h: 100, fallback: false },
        quad: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        quadOrigen: null,
      },
      tiempos: {
        procesoMs: 100,
        calidadMs: 50,
        ocrMs: 21000,
        totalMs: 30000,
        esperaMs: 1000,
        decodeMs: null,
        detectMs: null,
      },
    },
    ...parche,
  };
}

const registroOriginal: RegistroMasiva = {
  id: "fila-original",
  nombre: "a.jpg",
  agregadaEn: 1,
  estado: "LISTA",
  acta: actaOrigen(),
  thumb: "data:image/jpeg;base64,THUMB-ORIGINAL",
};

const registroCopia: RegistroMasiva = {
  id: "fila-copia",
  nombre: "b.jpg",
  agregadaEn: 2,
  estado: "PROCESANDO",
  hashDedup: "deadbeefdeadbeef",
};

/** fila liviana mínima. */
function fila(parche: Partial<FilaMasiva> & { id: string }): FilaMasiva {
  return { nombre: `${parche.id}.jpg`, agregadaEn: 1, estado: "PENDIENTE", ...parche };
}

beforeEach(() => {
  vi.clearAllMocks();
  useMasivaStore.setState({ filas: [], progreso: null });
});

describe("WAVE2 B1 — re-chequeo post-reserva (carrera ingesta×pool)", () => {
  it("carrera cerrada: snapshot PENDIENTE + store ya DUPLICADA → reuso, sin OCR, con traza", async () => {
    vi.mocked(leerRegistro).mockImplementation(async (id: string) =>
      id === "fila-original" ? registroOriginal : registroCopia,
    );
    useMasivaStore.setState({
      filas: [
        fila({ id: "fila-original", estado: "LISTA" }),
        // La marca de cadenaDedup (background FIFO) — ya en el store cuando
        // el snapshot viejo (PENDIENTE) llega a procesarUno:
        fila({ id: "fila-copia", estado: "DUPLICADA", dupOf: "fila-original" }),
      ],
    });
    // Snapshot VIEJO que el pool le pasó (reservado ANTES de la marca):
    const snapshotViejo = fila({ id: "fila-copia", estado: "PENDIENTE" });

    await procesarUno(snapshotViejo);

    // 1) la traza del re-chequeo SÍ se emitió (carrera cerrada):
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("re-chequeo post-reserva → reuso (carrera cerrada)"),
    );
    // 2) OCR jamás invocado — el bridge entero quedó fuera del vuelo:
    expect(getBridge).not.toHaveBeenCalled();
    // 3) reuso e71/e72 completo — el registro copiado nace del desenlace ORIGINAL:
    expect(guardarRegistro).toHaveBeenCalledTimes(1);
    const listo = vi.mocked(guardarRegistro).mock.calls[0][0];
    expect(listo.estado).toBe("LISTA");
    expect(listo.acta?.status).toBe("DUPLICADA"); // e66: copia de una ENVIADA
    expect(listo.acta?.diagnostico?.tiempos.ocrMs).toBe(0); // e72: la copia NO paga OCR
    expect(listo.dupOf).toBe("fila-original"); // adoptado del store fresco (no del snapshot)
    expect(listo.thumb).toBe("data:image/jpeg;base64,THUMB-ORIGINAL");
    // 4) la bandeja quedó LISTA con el status de la copia:
    const filaFinal = useMasivaStore
      .getState()
      .filas.find((f) => f.id === "fila-copia");
    expect(filaFinal?.estado).toBe("LISTA");
    expect(filaFinal?.statusActa).toBe("DUPLICADA");
  });

  it("sin carrera: fila fresca PENDIENTE → pipeline normal (0 cambios — sin traza, sin copia)", async () => {
    // El registro trae un archivo que NO es File → el pipeline muere honesto
    // en ERROR (ARCHIVO FUERA DE LA COLA) — misma muerte de siempre, lo que
    // importa es QUE LLEGÓ (salió de la rama dedup hacia el pipeline).
    vi.mocked(leerRegistro).mockImplementation(async (): Promise<RegistroMasiva> => ({
      id: "fila-plain",
      nombre: "c.jpg",
      agregadaEn: 1,
      estado: "PENDIENTE",
      archivo: {} as unknown as Blob, // NO instanceof File → throw honesto
    }));
    useMasivaStore.setState({
      filas: [fila({ id: "fila-plain", estado: "PENDIENTE" })],
    });

    await procesarUno(fila({ id: "fila-plain", estado: "PENDIENTE" }));

    // la puerta del re-chequeo NO se abrió:
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining("re-chequeo post-reserva"),
    );
    // el pipeline normal SÍ continuó (pasó la puerta dedup y consumió precalor):
    expect(consumirMaestro).toHaveBeenCalledWith("fila-plain");
    // sin copia de desenlace — el único guardarRegistro es el post-mortem ERROR:
    expect(guardarRegistro).toHaveBeenCalledTimes(1);
    const postMortem = vi.mocked(guardarRegistro).mock.calls[0][0];
    expect(postMortem.estado).toBe("ERROR");
    expect(postMortem.acta).toBeUndefined();
  });

  it("orden fuente: el re-chequeo alimenta la rama DUPLICADA EXISTENTE (e72 intacto byte a byte)", () => {
    const src = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
    const iLet = src.indexOf("let fila = filaEntrante;");
    const iRechequeo = src.indexOf("re-chequeo post-reserva → reuso (carrera cerrada)");
    const iRama = src.indexOf('if (fila.estado === "DUPLICADA") {');
    expect(iLet).toBeGreaterThan(-1);
    expect(iRama).toBeGreaterThan(iLet);
    // el re-chequeo vive ENTRE el snapshot y la rama existente (sin editarlas):
    expect(iRechequeo).toBeGreaterThan(iLet);
    expect(iRechequeo).toBeLessThan(iRama);
    // las líneas exactas del kit:
    expect(src).toContain("const filaFresca = useMasivaStore");
    expect(src).toContain(
      'fila = { ...fila, estado: "DUPLICADA", dupOf: filaFresca.dupOf ?? null };',
    );
    // el fallback e72 de abajo sigue presente (salvavidas honesto — PROHIBIDO tocar):
    expect(src).toContain("sin-original reprocesa-completo");
  });

  it("P1/P2 · source-inspection — CAPA 0 consulta el hand-off ANTES del capture y opcionesMasiva viaja con desdeMasiva", () => {
    const src = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
    // P1: la consulta del hand-off (flag masivaQrHandoff) existe y va ANTES
    // del fileToCaptureDataUrl de la CAPA 0 (flag OFF → capture de hoy):
    const iHand = src.indexOf("leerFlags().masivaQrHandoff\n        ? qrPayloadDeFila(fila.id)");
    const iCapture = src.indexOf("await fileToCaptureDataUrl(archivo)");
    expect(iHand).toBeGreaterThan(-1);
    expect(iCapture).toBeGreaterThan(iHand);
    expect(src).toContain("capa0-qr heredado handoff");
    // P2: el runner MASIVA declara desdeMasiva (el bridge omite su brújula):
    expect(src).toContain("desdeMasiva: true,");
    // El tipo local del bridge acepta el campo (intersección LOCAL — kit §1):
    const bridge = readFileSync(
      new URL("../scanner-core-bridge.ts", import.meta.url),
      "utf8",
    );
    expect(bridge).toContain("desdeMasiva?: boolean;");
    // El guard consume el campo con el cast local (mismo patrón del cast de
    // timeoutMs en la etapa OCR — pipeline recibe la base OpcionesEscaneo):
    expect(bridge).toContain("(opciones as OpcionesEscaneoConTimeout).desdeMasiva");
    // El import de la brújula queda intacto (el flujo individual sigue usándola):
    expect(bridge).toContain(
      'import { brujulaQrOrientacion, type BrujulaQr } from "./orientacion-qr";',
    );
  });
});
