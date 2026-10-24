/**
 * Tests unitarios — HOTFIX fix/ya-enviada-veto-postocr-v1 (H1 + H2):
 *  · H1 — veto ya-enviada POST-OCR en el punto único de envío (runner.ts,
 *    dentro de `if (actaDesenlace.status === "OPTIMA")` ANTES de
 *    registrarEnvioMasiva): si el payload del QR presente en el desenlace
 *    (capa 0 de esta corrida / acta / registro — el kit cita `diag.qrPayload`,
 *    inexistente en el árbol real) ya es de una ENVIADA del histórico →
 *    NO hay envío, fila YA-ENVIADA (maquinaria EXACTA de capa0-qr — misma
 *    llave, sin fuzzy), traza `veto ya-enviada post-ocr`.
 *  · Casos conservadores: payload nuevo → envío normal; índice caído (null)
 *    → envío normal (RL-e65b-3); forzarDedupOff → el veto NO aplica
 *    (RL-e65b-6 — el escape del dueño es sagrado).
 *  · H2 — el ledger del envío propio (T-3a) lleva hashDedup/hashBytes FRESCOS
 *    de la fila viva (cadenaDedup los persiste DESPUÉS de que el pipeline leyó
 *    el registro — el snapshot viajaba undefined y el cinturón D-e65-6 saltaba
 *    la entrada del índice; caso imagen10).
 *
 * Patrón: runner-rechequeo.test.ts (entorno node + vi.mock de la infra
 * DOM/worker/IDB/bridge). ARQUITECTURA del mock: SOLO la hoja `./historico`
 * se mockea (ledger IDB — sin ciclo de imports) y el store masiva queda
 * REAL al 100 % — runner y test comparten el MISMO módulo (store.ts importa
 * ./runner: un vi.partial-mock de ./store con importOriginal re-entra en el
 * ciclo y deja al runner enlazado al store REAL — hallazgo de este kit).
 * El índice de enviadas se alimenta por la vía REAL: listarHistorico →
 * indiceEnviadasDe → enviadaPorPayload (igualdad EXACTA, sin fuzzy).
 * FUERA de alcance (QA de regresión scripts/qa-*.ts): bloque capa 0 completo,
 * e72, pool, mutex y anclas byte-exacto.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Puente ESTABLE (una sola instancia para runner y tests — horaEnvio es
// asertable porque el runner y el test comparten el MISMO objeto):
const bridgeMock = vi.hoisted(() => ({
  escanearActa: vi.fn(() => new Promise(() => {})), // nunca resuelve — correrIntento está mockeado
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
  cablearPrecalor: vi.fn(), // store.ts lo llama a nivel de módulo (no-op aquí)
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
  decodificarQrDeCapture: vi.fn(() => Promise.resolve(null)), // capa 0 falla (default — caso campo)
  esperarDesenlaceQr: vi.fn(),
  qrCorto: vi.fn((p: string) => p.slice(0, 8)),
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
// SOLO la hoja del ledger — el store masiva y el runner quedan REALES:
vi.mock("./historico", () => ({
  borrarHistorico: vi.fn(() => Promise.resolve()),
  listarHistorico: vi.fn(() => Promise.resolve([])),
  registrarEntradaHistorico: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { guardarRegistro, leerRegistro } from "./cola";
import { logger } from "../../logger";
import { useE14Store } from "../store";
import { listarHistorico, registrarEntradaHistorico } from "./historico";
import type { EntradaHistorica } from "./historico";
import { useMasivaStore } from "./store";
import { correrIntento } from "./runner-watchdog";
import { decodificarQrDeCapture } from "./identidad-qr";
import { procesarUno } from "./runner";
import type { FilaMasiva, RegistroMasiva } from "./tipos";
import type { Acta } from "../types";

const PAYLOAD_ENVIADA = "7UfaHJKbmbZx766vul1NWL/H0swwzefhl5P2YMRLqjk="; // imagen9 (lote 2 — la del escape real)
const PAYLOAD_NUEVO = "Q09OVElET1ItUEFZTE9BRC1OVUVWTy0wMTIzNDU2Nzg5MA==";
const PAYLOAD_NUEVO2 = "UkVHUkVTU0lPTi1IT1RGSVgtSDItUEFZTE9BRC0wOTg3NjU0MzIx";

/** Entrada del ledger como la escribiría un envío previo real. */
function entradaLedger(payload: string, id = "hist-imagen9"): EntradaHistorica {
  return { id, ts: 1, hashBytes: "b".repeat(64), hashDedup: "cafe1234cafe1234", payloadQr: payload };
}

/** Desenlace OPTIMA mínimo (lo que consume el punto único de envío). */
function actaOptima(parche: Partial<Acta> = {}): Acta {
  return {
    id: "acta-desenlace",
    titulo: "TEST",
    ubicacion: { departamento: "D", municipio: "M", zona: "Z", puesto: "P", mesa: "001" },
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

/** fila liviana mínima. */
function fila(parche: Partial<FilaMasiva> & { id: string }): FilaMasiva {
  return { nombre: `${parche.id}.jpg`, agregadaEn: 1, estado: "PENDIENTE", ...parche };
}

/** registro en cola — `archivo` DEBE ser File real (guard del pipeline). */
function registroEnCola(parche: Partial<RegistroMasiva> & { id: string }): RegistroMasiva {
  return {
    nombre: `${parche.id}.jpg`,
    agregadaEn: 1,
    estado: "PROCESANDO",
    archivo: new File(["bytes"], `${parche.id}.jpg`, { type: "image/jpeg" }),
    ...parche,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  // Ledger: default = índice construido con el ledger vacío (enviadaPorPayload
  // REAL → null conservador). Cada test lo sobre-escribe si necesita hit.
  vi.mocked(listarHistorico).mockReset().mockResolvedValue([]);
  vi.mocked(registrarEntradaHistorico).mockReset().mockResolvedValue(undefined);
  // El envío real del flujo normal se ESPÍA (no toca historial/localStorage):
  useE14Store.setState({
    online: true,
    registrarEnvioMasiva: vi.fn(),
    contarMotivoNoEnvioActa: vi.fn(),
  });
  // Reset del índice de enviadas cacheado + la bandeja (la vía REAL del store):
  await useMasivaStore.getState().vaciar();
  useMasivaStore.setState({ filas: [], progreso: null });
});

describe("HOTFIX H1 — veto ya-enviada post-OCR (punto único de envío)", () => {
  it("payload de una ENVIADA presente en el desenlace → NO hay envío, fila YA-ENVIADA, traza del veto", async () => {
    // Caso campo: la capa 0 falla en ESTA corrida (decodificar → null) pero el
    // payload viaja en el registro (pasada previa del MISMO registro — fuente
    // real adaptada del `diag.qrPayload` del kit). El desenlace llega OPTIMA.
    vi.mocked(leerRegistro).mockImplementation(async (id: string) =>
      registroEnCola({
        id,
        qrPayload: PAYLOAD_ENVIADA,
        hashBytes: "a".repeat(64),
        hashDedup: "deadbeefdeadbeef",
      }),
    );
    useMasivaStore.setState({
      filas: [fila({ id: "fila-10", estado: "PENDIENTE" })],
    });
    vi.mocked(correrIntento).mockResolvedValue({
      tipo: "acta",
      acta: actaOptima(),
    } as never);
    // El histórico REAL contiene la ENVIADA del lote 2 (vía listarHistorico):
    vi.mocked(listarHistorico).mockResolvedValue([entradaLedger(PAYLOAD_ENVIADA)]);

    await procesarUno(fila({ id: "fila-10", estado: "PENDIENTE" }));

    // 1) la traza del veto SÍ se emitió (el lookup real encontró el hit):
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("veto ya-enviada post-ocr"),
    );
    // 2) la marca YA-ENVIADA (maquinaria EXACTA de capa0-qr — via "payload"):
    const writeYaEnviada = vi
      .mocked(guardarRegistro)
      .mock.calls.map((c) => c[0])
      .find((r) => r.estado === "YA-ENVIADA");
    expect(writeYaEnviada).toBeDefined();
    expect(writeYaEnviada?.enviadaDe).toBe("hist-imagen9");
    expect(writeYaEnviada?.dedup).toBe("ya-enviada");
    // 3) la bandeja quedó YA-ENVIADA (sobrevive el return — patchFila real):
    const filaFinal = useMasivaStore
      .getState()
      .filas.find((f) => f.id === "fila-10");
    expect(filaFinal?.estado).toBe("YA-ENVIADA");
    expect(filaFinal?.enviadaDe).toBe("hist-imagen9");
    // 4) la marca TAMBIÉN alimenta el ledger (T-2d — mismo gesto de capa0):
    expect(registrarEntradaHistorico).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fila-10", payloadQr: PAYLOAD_ENVIADA }),
    );
    // 5) el envío JAMÁS salió — ni registrarEnvioMasiva ni stamp ENVIADA:
    expect(useE14Store.getState().registrarEnvioMasiva).not.toHaveBeenCalled();
    expect(bridgeMock.horaEnvio).not.toHaveBeenCalled();
    expect(useE14Store.getState().contarMotivoNoEnvioActa).not.toHaveBeenCalled();
  });

  it("payload NUEVO (no en histórico) → envío normal byte-idéntico a hoy", async () => {
    vi.mocked(leerRegistro).mockImplementation(async (id: string) =>
      registroEnCola({ id }),
    );
    useMasivaStore.setState({
      filas: [fila({ id: "fila-nueva", estado: "PENDIENTE" })],
    });
    vi.mocked(correrIntento).mockResolvedValue({
      tipo: "acta",
      acta: actaOptima(),
    } as never);
    // La capa 0 SÍ decodifica (payload nuevo de verdad); ledger vacío:
    vi.mocked(decodificarQrDeCapture).mockResolvedValue({ payload: PAYLOAD_NUEVO });

    await procesarUno(fila({ id: "fila-nueva", estado: "PENDIENTE" }));

    // el veto consultó (índice construido) y NO frenó — el envío siguió:
    expect(listarHistorico).toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining("veto ya-enviada post-ocr"),
    );
    expect(useE14Store.getState().registrarEnvioMasiva).toHaveBeenCalledTimes(1);
    expect(bridgeMock.horaEnvio).toHaveBeenCalledTimes(1);
    const listo = vi
      .mocked(guardarRegistro)
      .mock.calls.map((c) => c[0])
      .find((r) => r.estado === "LISTA");
    expect(listo?.acta?.status).toBe("ENVIADA");
    const filaFinal = useMasivaStore
      .getState()
      .filas.find((f) => f.id === "fila-nueva");
    expect(filaFinal?.estado).toBe("LISTA");
    expect(filaFinal?.statusActa).toBe("ENVIADA");
  });

  it("índice caído (listarHistorico rechaza) → envío normal (conservador, RL-e65b-3)", async () => {
    vi.mocked(leerRegistro).mockImplementation(async (id: string) =>
      registroEnCola({ id, qrPayload: PAYLOAD_ENVIADA }),
    );
    useMasivaStore.setState({
      filas: [fila({ id: "fila-idx", estado: "PENDIENTE" })],
    });
    vi.mocked(correrIntento).mockResolvedValue({
      tipo: "acta",
      acta: actaOptima(),
    } as never);
    // Fallo del índice REAL (RL-e65b-3): listarHistorico rechaza →
    // indiceEnviadasDe lo traga → enviadaPorPayload → null conservador.
    vi.mocked(listarHistorico).mockRejectedValue(new Error("IDB_HISTORICO_LISTAR"));

    await procesarUno(fila({ id: "fila-idx", estado: "PENDIENTE" }));

    // el veto CONSULTÓ (el payload estaba en el desenlace) y el null lo dejó pasar:
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining("veto ya-enviada post-ocr"),
    );
    expect(useE14Store.getState().registrarEnvioMasiva).toHaveBeenCalledTimes(1);
    const filaFinal = useMasivaStore
      .getState()
      .filas.find((f) => f.id === "fila-idx");
    expect(filaFinal?.estado).toBe("LISTA");
    expect(filaFinal?.statusActa).toBe("ENVIADA");
  });

  it("forzarDedupOff (PROCESAR IGUAL del dueño) → el veto NO aplica aunque el ledger traiga la ENVIADA (RL-e65b-6)", async () => {
    vi.mocked(leerRegistro).mockImplementation(async (id: string) =>
      registroEnCola({ id, qrPayload: PAYLOAD_ENVIADA }),
    );
    useMasivaStore.setState({
      filas: [
        fila({
          id: "fila-owner",
          estado: "PENDIENTE",
          forzarDedupOff: true,
        }),
      ],
    });
    vi.mocked(correrIntento).mockResolvedValue({
      tipo: "acta",
      acta: actaOptima(),
    } as never);
    // El ledger SÍ contiene la ENVIADA — el escape del dueño manda SIEMPRE:
    vi.mocked(listarHistorico).mockResolvedValue([entradaLedger(PAYLOAD_ENVIADA)]);

    await procesarUno(fila({ id: "fila-owner", estado: "PENDIENTE", forzarDedupOff: true }));

    // el veto ni siquiera consultó el índice (guard forzarDedupOff antes):
    expect(listarHistorico).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining("veto ya-enviada post-ocr"),
    );
    // ninguna marca YA-ENVIADA — y el envío del dueño salió:
    expect(
      vi
        .mocked(guardarRegistro)
        .mock.calls.map((c) => c[0])
        .some((r) => r.estado === "YA-ENVIADA"),
    ).toBe(false);
    expect(useE14Store.getState().registrarEnvioMasiva).toHaveBeenCalledTimes(1);
    const filaFinal = useMasivaStore
      .getState()
      .filas.find((f) => f.id === "fila-owner");
    expect(filaFinal?.estado).toBe("LISTA");
    expect(filaFinal?.statusActa).toBe("ENVIADA");
  });
});

describe("HOTFIX H2 — el ledger del envío lleva las llaves frescas de la fila", () => {
  it("registro stale (sin hashDedup — leído antes de cadenaDedup) + fila viva con hash → la entrada lleva hashDedup/hashBytes NO vacíos", async () => {
    vi.mocked(leerRegistro).mockImplementation(async (id: string) =>
      // El snapshot que leyó el pipeline al ENTRAR — la carrera real: sin llaves.
      registroEnCola({ id }),
    );
    useMasivaStore.setState({
      filas: [
        // La fila viva ya lleva lo que cadenaDedup estampó (ingesta background):
        fila({
          id: "fila-h2",
          estado: "PENDIENTE",
          hashBytes: "c".repeat(64),
          hashDedup: "abcd1234abcd1234",
        }),
      ],
    });
    vi.mocked(correrIntento).mockResolvedValue({
      tipo: "acta",
      acta: actaOptima(),
    } as never);
    vi.mocked(decodificarQrDeCapture).mockResolvedValue({ payload: PAYLOAD_NUEVO2 });

    await procesarUno(fila({
      id: "fila-h2",
      estado: "PENDIENTE",
      hashBytes: "c".repeat(64),
      hashDedup: "abcd1234abcd1234",
    }));

    // T-3a: el envío propio alimentó el ledger CON las llaves frescas:
    expect(registrarEntradaHistorico).toHaveBeenCalledTimes(1);
    const entrada = vi.mocked(registrarEntradaHistorico).mock.calls[0][0];
    expect(entrada.id).toBe("fila-h2");
    expect(entrada.hashDedup).toBe("abcd1234abcd1234"); // NO undefined (D-e65-6 deja de saltarla)
    expect(entrada.hashBytes).toBe("c".repeat(64));
    expect(entrada.payloadQr).toBe(PAYLOAD_NUEVO2);
  });
});

describe("HOTFIX — orden fuente (anclas del kit, estilo runner-rechequeo)", () => {
  it("el veto vive DENTRO del bloque OPTIMA y ANTES de registrarEnvioMasiva; sin literal \"YA-ENVIADA\" en runner (QA qa-dedup-enviadas)", () => {
    const src = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
    const iOptima = src.indexOf('if (actaDesenlace.status === "OPTIMA") {');
    const iVeto = src.indexOf("veto ya-enviada post-ocr");
    const iEnvio = src.indexOf("registrarEnvioMasiva(actaDesenlace);");
    expect(iOptima).toBeGreaterThan(-1);
    expect(iVeto).toBeGreaterThan(iOptima);
    expect(iEnvio).toBeGreaterThan(iVeto);
    // la consulta y la marca del veto (misma llave exacta — sin fuzzy):
    expect(src).toContain("const diagQr =");
    expect(src).toContain("marcarYaEnviada(");
    // el literal "YA-ENVIADA" jamás se escribe en el runner (ancla QA
    // qa-dedup-enviadas.ts — la marca vive SOLO en marcarYaEnviada/store.ts):
    expect(src).not.toContain('"YA-ENVIADA"');
    // el bloque capa 0 T-4 queda INTACTO (byte a byte — ancla QA):
    expect(src).toContain(
      'if (!fila.forzarDedupOff) {\n          const enviadaHist = await enviadaPorPayload(qrPayload);',
    );
    // H2: el ledger del T-3a sigue fire-and-forget (ancla QA — jamás await):
    expect(src).toContain("void registrarEnviadaHistorico({");
    expect(src).not.toContain("await registrarEnviadaHistorico");
    // H2: las llaves frescas vienen de la fila viva (filaViva?.hashDedup):
    expect(src).toContain("hashDedup: filaViva?.hashDedup ?? registro.hashDedup,");
    expect(src).toContain("hashBytes: filaViva?.hashBytes ?? registro.hashBytes,");
  });
});
