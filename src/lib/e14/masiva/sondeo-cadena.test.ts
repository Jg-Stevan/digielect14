/**
 * Tests — KIT e73-sondeo-qr-precoz-v1 (§B, T2 ≥ 5 · §C ≥ 2):
 *  5. Gemela QR en misma ingesta → 2ª marcada DUPLICADA dedup:"qr-sondeo"
 *     ANTES del pool (sin slot/probe/OCR — la fila nunca entra al runner).
 *  6. Payload ya en histórico → YA-ENVIADA via "payload" EXISTENTE (dedup
 *     empieza con "ya-enviada" — guard wave3 C.2 satisfecho).
 *  7. forzarDedupOff (cinturón §B.2) → cero llamadas al cliente
 *     (source-inspection — el literal del guard vive en cadenaDedup).
 *  8. Sondeo sin QR (payload null) → cae a dhash EXACTO como hoy (fila
 *     PENDIENTE, capa dhash íntegra, telemetría ms honesta).
 *  9. Guard anti-zombi: fila quitada durante el sondeo → sin marca, sin throw.
 *  §C.1 — match por payload tras registrarEnviadaHistorico (hook del MISMO
 *     punto de invalidación).
 *  §C.2 — carga del índice desde el ledger + llave opaca (jamás se parsea).
 * Patrón: marcar-ya-enviada.wave3.test.ts (node + vi.mock de la infra
 * DOM/worker/IDB/bridge; ./cola con mapa en memoria — lectura REAL de
 * registro para los guards; ./historico parcial-real para el índice §C).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

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
  loadImage: vi.fn(),
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
  pareceImagenMasiva: vi.fn(() => true),
  parecePdfMasiva: vi.fn(() => false),
  extraerArchivo: vi.fn(),
  extraerPdf: vi.fn(),
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
  DEDUP_CINTA_CIERTA: 2,
}));
vi.mock("./identidad-qr", () => ({
  decodificarQrDeCapture: vi.fn(() => Promise.resolve(null)),
  esperarDesenlaceQr: vi.fn(),
  qrCorto: vi.fn((p: string) => p.slice(0, 8)),
}));
// ./runner — mock completo (el store solo usa los 3 mutadores de arranque;
// el runner real arrastra el puente completo — fuera de alcance aquí).
vi.mock("./runner", () => ({
  iniciarRunner: vi.fn(),
  pausarRunner: vi.fn(),
  rearrancarTrasEncolar: vi.fn(),
}));

// ── ./cola — mapa en memoria (patrón marcar-ya-enviada.wave3) ──────────────
const colaEstado = vi.hoisted(() => ({
  registros: new Map<string, Record<string, unknown>>(),
  contador: { n: 0 },
}));
vi.mock("./cola", () => ({
  agregarLote: vi.fn(async (files: File[]) =>
    files.map((f) => {
      const id = `id-${++colaEstado.contador.n}`;
      colaEstado.registros.set(id, {
        id,
        nombre: f.name || "FOTO",
        agregadaEn: Date.now(),
        estado: "PENDIENTE",
      });
      return id;
    }),
  ),
  borrar: vi.fn(),
  guardarRegistro: vi.fn(async (r: Record<string, unknown>) => {
    colaEstado.registros.set(r.id as string, r);
  }),
  leerRegistro: vi.fn(async (id: string) => {
    const r = colaEstado.registros.get(id);
    if (!r) throw new Error("SIN_REGISTRO");
    return r;
  }),
  listarMapeados: vi.fn(async () => []),
  recuperarCola: vi.fn(async () => []),
  vaciar: vi.fn(),
}));

// ── ./sondeo-qr.client — el sondeo controlado por test ─────────────────────
const sondeoEstado = vi.hoisted(() => ({
  sondearQrPrecoz: vi.fn<
    (archivo: File | Blob) => Promise<{ payload: string | null; tier: string | null; ms: number } | null>
  >(async () => null),
}));
vi.mock("./sondeo-qr.client", () => ({
  sondearQrPrecoz: sondeoEstado.sondearQrPrecoz,
}));

// ── ./historico — REAL con fake-indexedDB mínimo (el índice §C cierra sobre
// el listarHistorico del MÓDULO — un mock parcial lo desconectaría; con el
// fake IDB todo el ledger + índice es real). Suficiente: open/put/getAll/clear.
type StoresMap = Map<string, Map<string, Record<string, unknown>>>; // nombre → store → (id → registro)
const histEstado = vi.hoisted(() => ({
  dbs: new Map<string, StoresMap>(),
}));
vi.stubGlobal("indexedDB", {
  open(nombre: string) {
    let stores: StoresMap | undefined = histEstado.dbs.get(nombre);
    if (!stores) {
      stores = new Map();
      histEstado.dbs.set(nombre, stores);
    }
    const req = {
      result: null as unknown,
      error: null as unknown,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onupgradeneeded: null as (() => void) | null,
    };
    const db = {
      objectStoreNames: { contains: (s: string) => stores!.has(s) },
      createObjectStore: (s: string) => {
        stores!.set(s, new Map<string, Record<string, unknown>>());
        return {};
      },
      transaction(_s: string, _modo: string) {
        const tx = {
          oncomplete: null as (() => void) | null,
          onerror: null as (() => void) | null,
          onabort: null as (() => void) | null,
        };
        const store = {
          put(v: Record<string, unknown>) {
            stores!.get(_s)!.set(String(v.id), v);
            queueMicrotask(() => tx.oncomplete?.());
            return { transaction: tx };
          },
          clear() {
            stores!.get(_s)!.clear();
            queueMicrotask(() => tx.oncomplete?.());
            return { transaction: tx };
          },
          getAll() {
            const r = {
              result: [...stores!.get(_s)!.values()],
              error: null,
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null,
            };
            queueMicrotask(() => r.onsuccess?.());
            return r;
          },
          transaction: tx,
        };
        // Forma REAL de la API: transaction().objectStore(name) → store
        // (el .transaction del store conserva la tx para el await del caller).
        return { objectStore: () => store };
      },
      onclose: null as (() => void) | null,
    };
    req.result = db;
    queueMicrotask(() => {
      req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  },
});

vi.mock("../../logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  estamparQrPayloadDeFila, // P1 (brief Agente A) — hand-off id→payload
  qrPayloadDeFila, // P1 (brief Agente A) — consulta del hand-off
  registrarEnviadaHistorico,
  useMasivaStore,
} from "./store";
import {
  __resetIndicePayloadParaTest,
  indiceEnviadasPorPayload,
} from "./historico";
import type { RegistroMasiva } from "./tipos";

const PAYLOAD_P = "7UfaHJKbmbZx766vul1NWL/H0swwzefhl5P2YMRLqjk=";
const PAYLOAD_Q = "OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk9";

function fileConBytes(bytes: string, nombre: string): File {
  return new File([bytes], nombre, { type: "image/jpeg" });
}

/** agregarFiles vive EN el mini-store (método — no export de módulo). */
function agregarFiles(files: File[]): Promise<void> {
  return useMasivaStore.getState().agregarFiles(files);
}

function registroDe(id: string): RegistroMasiva {
  const r = colaEstado.registros.get(id) as RegistroMasiva | undefined;
  if (!r) throw new Error(`sin registro ${id}`);
  return r;
}

describe("e73 T2 · capa SONDEO QR en cadenaDedup (§B)", () => {
  beforeEach(() => {
    colaEstado.registros.clear();
    colaEstado.contador.n = 0;
    // Limpiar CONTENIDOS (no el mapa): el dbSingleton de historico.ts vive a
    // nivel de módulo y conserva la MISMA Map de stores — borrar el mapa
    // externo desconectaría al singleton del ledger real de cada test.
    // Limpiar los mapas INTERIORES (el dbSingleton conserva las Map de los
    // stores — borrar la clave externa dejaría el put() con store ausente).
    for (const s of histEstado.dbs.values()) for (const inner of s.values()) inner.clear();
    __resetIndicePayloadParaTest();
    sondeoEstado.sondearQrPrecoz.mockReset();
    sondeoEstado.sondearQrPrecoz.mockImplementation(async () => null);
    useMasivaStore.setState({ filas: [], guardando: 0, avisoCola: null });
  });

  it("5 · gemela QR en misma ingesta → 2ª DUPLICADA dedup:'qr-sondeo' ANTES del pool", async () => {
    sondeoEstado.sondearQrPrecoz.mockImplementation(async () => ({
      payload: PAYLOAD_P,
      tier: "full",
      ms: 42,
    }));
    await agregarFiles([fileConBytes("AA", "imagen1.jpg"), fileConBytes("BB", "imagen2.jpg")]);
    await vi.waitFor(async () => {
      const f2 = useMasivaStore.getState().filas.find((x) => x.nombre === "imagen2.jpg");
      if (!f2 || f2.estado !== "DUPLICADA") throw new Error("gemela sin marcar");
    });
    // Re-leer DESPUÉS del waitFor (el swap temp→id reemplaza los objetos de
    // fila — un snapshot previo no ve los patches de la cadena).
    const f1 = useMasivaStore.getState().filas.find((x) => x.nombre === "imagen1.jpg")!;
    const f2 = useMasivaStore.getState().filas.find((x) => x.nombre === "imagen2.jpg")!;
    expect(f1.estado).toBe("PENDIENTE"); // la original sigue (el pool la procesa)
    expect(f1.sondeoQrMs).toBe(42); // telemetría en vivo (chip §E)
    expect(f1.sondeoQrTier).toBe("full");
    expect(f2.estado).toBe("DUPLICADA");
    expect(f2.dupOf).toBe(f1.id);
    expect(f2.sondeoQrMs).toBe(42);
    const r2 = registroDe(f2.id);
    expect(r2.dedup).toBe("qr-sondeo"); // D57 AL FINAL
    expect(r2.dupOf).toBe(f1.id);
    expect(r2.sondeoQrMs).toBe(42);
    expect(r2.sondeoQrTier).toBe("full");
    expect(sondeoEstado.sondearQrPrecoz).toHaveBeenCalledTimes(2); // FIFO por archivo
  });

  it("6 · payload ya en histórico → YA-ENVIADA via 'payload' (dedup 'ya-enviada')", async () => {
    // El ledger REAL (fake IDB) ya trae el envío previo con SU payload:
    const { registrarEntradaHistorico } = await import("./historico");
    await registrarEntradaHistorico({ id: "hist-1", ts: 1, payloadQr: PAYLOAD_P });
    __resetIndicePayloadParaTest(); // el índice carga el ledger al primer uso
    sondeoEstado.sondearQrPrecoz.mockImplementation(async () => ({
      payload: PAYLOAD_P,
      tier: "recorte",
      ms: 17,
    }));
    await agregarFiles([fileConBytes("CC", "imagen3.jpg")]);
    const f1 = await vi.waitFor(() => {
      const f = useMasivaStore.getState().filas.find((x) => x.nombre === "imagen3.jpg");
      if (!f || f.estado !== "YA-ENVIADA") throw new Error("sin YA-ENVIADA");
      return f;
    });
    expect(f1.enviadaDe).toBe("hist-1");
    const r1 = registroDe(f1.id);
    expect(r1.estado).toBe("YA-ENVIADA");
    expect(r1.dedup).toBe("ya-enviada"); // default — guard wave3 C.2 satisfecho
    expect(r1.qrPayload).toBe(PAYLOAD_P); // estampado por marcarYaEnviada
    expect(r1.enviadaDe).toBe("hist-1");
    expect(r1.sondeoQrMs).toBe(17); // telemetría arrastrada (M-e73-3)
    expect(r1.sondeoQrTier).toBe("recorte");
  });

  it("7 · forzarDedupOff (cinturón §B.2) → cero llamadas al cliente (source-inspection)", () => {
    const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
    // El sondeo vive DENTRO del guard del override del dueño (RL-e65b-6):
    expect(store).toContain("if (!entrada.forzarDedupOff) {");
    expect(store).toContain("sondeo = await sondearQrPrecoz(entrada.archivo);");
    // y el guard va ANTES de la llamada en el bloque (orden del kit §B.2):
    const iGuard = store.indexOf("if (!entrada.forzarDedupOff) {");
    const iLlamada = store.indexOf("sondeo = await sondearQrPrecoz(entrada.archivo);");
    expect(iGuard).toBeGreaterThan(-1);
    expect(iLlamada).toBeGreaterThan(iGuard);
  });

  it("8 · sondeo sin QR (payload null) → cae a dhash EXACTO como hoy", async () => {
    sondeoEstado.sondearQrPrecoz.mockImplementation(async () => ({
      payload: null,
      tier: null,
      ms: 30,
    }));
    await agregarFiles([fileConBytes("DD", "imagen4.jpg")]);
    await new Promise((r) => setTimeout(r, 25)); // deja aterrizar la cadena
    const f1 = useMasivaStore.getState().filas.find((x) => x.nombre === "imagen4.jpg")!;
    expect(f1.estado).toBe("PENDIENTE"); // sin gemela → sigue (dhash de hoy)
    expect(f1.sondeoQrMs).toBe(30); // telemetría del sondeo corrido (§E)
    expect(f1.sondeoQrTier).toBeUndefined(); // SIN lectura — jamás inventar
    const r1 = registroDe(f1.id);
    expect(r1.estado).toBe("PENDIENTE");
    expect(r1.dedup).toBeUndefined(); // el dhash no corrió en node (decode) — capa íntegra
  });

  it("9 · guard anti-zombi: fila quitada durante el sondeo → sin marca, sin throw", async () => {
    let llamadas = 0;
    sondeoEstado.sondearQrPrecoz.mockImplementation(async () => {
      llamadas += 1;
      if (llamadas === 2) {
        // la gemela es QUITADA por el dueño mientras SU sondeo corre:
        useMasivaStore.setState({
          filas: useMasivaStore.getState().filas.filter((x) => x.nombre !== "imagen6.jpg"),
        });
      }
      return { payload: PAYLOAD_P, tier: "full", ms: 9 };
    });
    await expect(
      agregarFiles([fileConBytes("EE", "imagen5.jpg"), fileConBytes("FF", "imagen6.jpg")]),
    ).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 30));
    const f1 = useMasivaStore.getState().filas.find((x) => x.nombre === "imagen5.jpg");
    expect(f1?.estado).toBe("PENDIENTE");
    // la fila 2 ya no existe — NADA que marcar (el guard del mapa y del write):
    const muerta = colaEstado.registros.get("id-2") as RegistroMasiva | undefined;
    if (muerta) expect(muerta.estado).not.toBe("DUPLICADA");
  });
});

// ── P1 (plan masiva — brief Agente A) · hand-off del payload QR ────────────

describe("P1 · hand-off del payload QR (estampado del sondeo → consulta prescan/CAPA 0)", () => {
  beforeEach(() => {
    colaEstado.registros.clear();
    useMasivaStore.setState({ filas: [], guardando: 0, avisoCola: null });
  });

  it("P1.1 · mutadores: roundtrip id→payload y null honesto (jamás inventar)", () => {
    expect(qrPayloadDeFila("fila-x")).toBeNull(); // sin estampar → null
    estamparQrPayloadDeFila("fila-x", PAYLOAD_P);
    expect(qrPayloadDeFila("fila-x")).toBe(PAYLOAD_P); // igualdad EXACTA
    expect(qrPayloadDeFila("fila-y")).toBeNull(); // otra fila → null
    // Re-estampado (la fila re-procesada) → el último dato manda:
    estamparQrPayloadDeFila("fila-x", PAYLOAD_P);
    expect(qrPayloadDeFila("fila-x")).toBe(PAYLOAD_P);
  });

  it("P1.2 · source-inspection — el estampado del sondeo vive DENTRO del guard masivaQrHandoff y NO decide nada", () => {
    const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
    // El estampado existe y está protegido por el kill-switch del dueño:
    expect(store).toContain("if (sondeo.payload != null && leerFlags().masivaQrHandoff)");
    expect(store).toContain("estamparQrPayloadDeFila(entrada.id, sondeo.payload);");
    // Orden: el guard va ANTES del estampado (flag OFF → no-op byte-idéntico):
    const iGuard = store.indexOf("leerFlags().masivaQrHandoff");
    const iEstampa = store.indexOf("estamparQrPayloadDeFila(entrada.id, sondeo.payload);");
    expect(iGuard).toBeGreaterThan(-1);
    expect(iEstampa).toBeGreaterThan(iGuard);
    // El mapa nuevo comparte el ciclo de vida del lote (mismas limpiezas e64p
    // C-1/C-2 — las 2 de mapaQrPayload):
    expect(store).toContain("const qrPayloadPorFila = new Map<string, string>();");
    expect([...store.matchAll(/qrPayloadPorFila\.clear\(\)/g)].length).toBe(2);
  });
});

describe("e73 §C · índice histórico por payload (historico.ts — REAL sobre fake IDB)", () => {
  beforeEach(() => {
    colaEstado.registros.clear();
    // Ídem: contenidos internos — el dbSingleton vive a nivel de módulo.
    for (const s of histEstado.dbs.values()) for (const inner of s.values()) inner.clear();
    __resetIndicePayloadParaTest();
    useMasivaStore.setState({ filas: [], guardando: 0, avisoCola: null });
  });

  it("C.1 · match por payload tras registrarEnviadaHistorico (hook del mismo punto)", async () => {
    // El índice YA cargó (vacío) — el hook debe hacerlo visible al instante:
    await indiceEnviadasPorPayload(true);
    await registrarEnviadaHistorico({
      id: "reg-1",
      ts: Date.now(),
      payloadQr: PAYLOAD_Q,
    });
    const hit = (await indiceEnviadasPorPayload(true)).get(PAYLOAD_Q);
    expect(hit?.id).toBe("reg-1"); // MISMO gesto de sesión — sin recargar
  });

  it("C.2 · carga desde el ledger + llave opaca (sin payloadQr queda fuera)", async () => {
    const { registrarEntradaHistorico } = await import("./historico");
    await registrarEntradaHistorico({ id: "h1", ts: 1, payloadQr: PAYLOAD_P });
    await registrarEntradaHistorico({ id: "h2", ts: 2 }); // sin payloadQr → FUERA
    const mapa = await indiceEnviadasPorPayload(true);
    expect(mapa.size).toBe(1); // jamás inventar llaves
    expect(mapa.get(PAYLOAD_P)?.id).toBe("h1");
    expect(mapa.has(PAYLOAD_Q)).toBe(false);
  });

  it("C.3 · modo pruebas (incluirPersistido=false) → el ledger NO alimenta", async () => {
    const { registrarEntradaHistorico } = await import("./historico");
    await registrarEntradaHistorico({ id: "h1", ts: 1, payloadQr: PAYLOAD_P });
    __resetIndicePayloadParaTest();
    const mapa = await indiceEnviadasPorPayload(false); // e64p C-3
    expect(mapa.size).toBe(0); // cero memoria ENTRE lotes en modo pruebas
  });
});
