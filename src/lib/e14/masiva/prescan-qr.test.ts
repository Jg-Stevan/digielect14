/**
 * Tests — KIT e107-prescan-qr-cola-v1 (§H.1, sin worker real — deps
 * inyectadas, precedente sondeo-qr.test.ts / DepsLadderSondeo e73):
 *  1. Clasificador PURO: dup-en-lote / ya-enviada / nueva-registra /
 *     null-nada / original-muerta-nada (+ self-match → sigue).
 *  2. Objetivo (R3): forzarDedupOff excluye; no-PENDIENTE excluye.
 *  3. ESCRITURA: DUPLICADA omite `dedup` y trae `dupOf` (§F.2); YA-ENVIADA
 *     vía marcarYaEnviada(..., "payload", ...); registrar → registrarQrPayload;
 *     nada → no-op.
 *  4. Cliente con Worker fake: serial estricto (2 concurrentes → 1 a la vez),
 *     transfer SIEMPRE presente, hard-kill dispara terminate+null, boot-timeout
 *     (2 URLs), onerror → null, postMessage que tira → null (jamás throw),
 *     error/busy → null, destruir resuelve op en vuelo.
 *  5. Orquestador: re-entrada (doble llamada concurrente ⇒ 1 corrida);
 *     flag OFF ⇒ se llamó `iniciar` y NO se instanció worker (kill-switch
 *     byte-idéntico).
 *  6. leerQrDeWarped: BarcodeDetector presente → rawValue; sin canvas →
 *     null honesto; BD que tira + sin canvas → null (jamás throw).
 * El bundling real lo cubre `bun run build` (no hay precompilación — el
 * worker es el asset público que ya existe, §D.1 del kit).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Flags controlados por test (mock ANTES de importar — hoisted).
const flagsState = vi.hoisted(() => ({
  prescan: true,
  quad: false, // KIT e14-quad-streaming-v1 (P4) — masivaQuad
  streaming: false, // KIT e14-quad-streaming-v1 (P5) — masivaStreaming
}));
vi.mock("../flags", () => ({
  leerFlags: () => ({
    prescanQrCola: flagsState.prescan,
    masivaQuad: flagsState.quad,
    masivaStreaming: flagsState.streaming,
  }),
}));

// store.ts controlado por test — SOLO lo que prescan-qr.ts consume.
const storeState = vi.hoisted(() => ({
  filas: [] as { id: string; estado: string; forzarDedupOff?: boolean }[],
  corriendo: false,
}));
const mocksStore = vi.hoisted(() => ({
  iniciar: vi.fn(),
  actualizarFila: vi.fn(),
  marcarYaEnviada: vi.fn(async () => true),
  originalQrDePayload: vi.fn<(p: string) => string | null>(() => null),
  enviadaPorPayload: vi.fn(async (_p: string) => null as { id: string } | null),
  registrarQrPayload: vi.fn(),
}));
vi.mock("./store", () => ({
  useMasivaStore: {
    getState: () => ({
      filas: storeState.filas,
      corriendo: storeState.corriendo,
      iniciar: mocksStore.iniciar,
      actualizarFila: mocksStore.actualizarFila,
    }),
  },
  marcarYaEnviada: mocksStore.marcarYaEnviada,
  originalQrDePayload: mocksStore.originalQrDePayload,
  enviadaPorPayload: mocksStore.enviadaPorPayload,
  registrarQrPayload: mocksStore.registrarQrPayload,
}));

const mocksCola = vi.hoisted(() => ({
  leerRegistro: vi.fn(async (_id: string): Promise<Record<string, unknown>> => ({
    archivo: new Blob(["x"]),
  })),
  guardarRegistro: vi.fn(async (_registro?: unknown) => {}),
}));
vi.mock("./cola", () => ({
  leerRegistro: mocksCola.leerRegistro,
  guardarRegistro: mocksCola.guardarRegistro,
}));

import {
  aplicarVeredictoPrescan,
  clasificarPayloadPrescan,
  leerQrDeWarped,
  objetivoPrescan,
  prescanYIniciar,
  quadDeFracciones,
  usePrescanStore,
  type DepsClasificadorPrescan,
} from "./prescan-qr";
import {
  BOOT_TIMEOUT_MS,
  HARD_KILL_EXTRA_MS,
  PRESUPUESTO_FILA_MS,
  __setFabricaWorkerDeteccionParaTest,
  crearClientePrescan,
  type WorkerDeteccion,
} from "./prescan-qr.client";
import {
  __resetTurnoClasificacionParaTest,
  abrirTurnoClasificacion,
  cerrarTurnoClasificacion,
  turnoClasificacionEnCurso,
  turnoClasificacionInicioMs,
} from "./turno-clasificacion";

type FakeWorker = WorkerDeteccion & {
  enviados: { msg: Record<string, unknown>; transfer: Transferable[] }[];
  terminado: boolean;
};

let fabricados: FakeWorker[];
let ultimo: FakeWorker | null;
let readyAuto = true; // la fábrica publica 'ready' en microtarea

function fabricaFalsa(): WorkerDeteccion {
  const w: FakeWorker = {
    enviados: [],
    terminado: false,
    postMessage(msg: unknown, transfer?: Transferable[]) {
      w.enviados.push({ msg: msg as Record<string, unknown>, transfer: transfer ?? [] });
    },
    terminate() {
      w.terminado = true;
    },
    onmessage: null,
    onerror: null,
  };
  fabricados.push(w);
  ultimo = w;
  if (readyAuto) {
    queueMicrotask(() => {
      w.onmessage?.({ data: { type: "ready" } } as MessageEvent);
    });
  }
  return w;
}

/** Responde como el worker real al `detect` (corners = fracciones TL,TR,BR,BL). */
function responderDetect(w: FakeWorker, ts: number, corners: Float32Array | null): void {
  w.onmessage?.({ data: { type: "result", corners, ts } } as MessageEvent);
}

const QUAD_OK = Float32Array.of(0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9);

const DEPS: DepsClasificadorPrescan = {
  originalDePayload: (p) => mocksStore.originalQrDePayload(p),
  filaViva: (id) => storeState.filas.some((f) => f.id === id),
  enviadaPorPayload: async (p) => mocksStore.enviadaPorPayload(p),
};

function filaFixture(
  id: string,
  estado: string,
  extra: { forzarDedupOff?: boolean } = {},
): { id: string; estado: string; forzarDedupOff?: boolean } {
  return { id, estado, ...extra };
}

// ── 1 · Clasificador puro (orden de decisión §D.2) ──────────────────────────

describe("e107 T5 · clasificarPayloadPrescan (puro — ESPEJO cadenaDedup)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.filas = [
      filaFixture("f1", "PENDIENTE"),
      filaFixture("f2", "PENDIENTE"),
    ];
    mocksStore.originalQrDePayload.mockReturnValue(null);
    mocksStore.enviadaPorPayload.mockResolvedValue(null);
  });

  it("1 · dup EN LOTE: original viva ≠ filaId → duplicada (originalId)", async () => {
    mocksStore.originalQrDePayload.mockReturnValue("f1");
    const v = await clasificarPayloadPrescan("PL", "f2", DEPS);
    expect(v).toEqual({ accion: "duplicada", originalId: "f1" });
  });

  it("2 · hit del histórico → ya-enviada (enviadaId) — capa 0 verá lo mismo", async () => {
    mocksStore.enviadaPorPayload.mockResolvedValue({ id: "hist-9" });
    const v = await clasificarPayloadPrescan("PL", "f1", DEPS);
    expect(v).toEqual({ accion: "ya-enviada", enviadaId: "hist-9" });
  });

  it("3 · payload NUEVO → registrar (sigue PENDIENTE; capa 0 lo verá igual)", async () => {
    const v = await clasificarPayloadPrescan("PL", "f1", DEPS);
    expect(v).toEqual({ accion: "registrar" });
  });

  it("4 · payload null (los 4 arrugados) → nada — JAMÁS descartar (regla de oro 4)", async () => {
    const v = await clasificarPayloadPrescan(null, "f1", DEPS);
    expect(v).toEqual({ accion: "nada" });
    expect(mocksStore.enviadaPorPayload).not.toHaveBeenCalled();
  });

  it("5 · original MUERTA (quitar/vaciar) → nada (guard transversal — conservador: OCR decidirá)", async () => {
    mocksStore.originalQrDePayload.mockReturnValue("fX"); // NO está en filas
    const v = await clasificarPayloadPrescan("PL", "f1", DEPS);
    expect(v).toEqual({ accion: "nada" });
    expect(mocksStore.enviadaPorPayload).not.toHaveBeenCalled(); // ni ya-enviada intenta
  });

  it("6 · self-match (original === filaId) → NO es dup: sigue a histórico (mirror capa 0 runner.ts:567)", async () => {
    mocksStore.originalQrDePayload.mockReturnValue("f1");
    const v = await clasificarPayloadPrescan("PL", "f1", DEPS);
    expect(v).toEqual({ accion: "registrar" });
  });
});

// ── 2 · Objetivo R3 (forzarDedupOff manda SIEMPRE — RL-e65b-6) ──────────────

describe("e107 T5 · objetivoPrescan (R3)", () => {
  it("7 · forzarDedupOff (PROCESAR IGUAL) excluye; no-PENDIENTE excluye; PENDIENTE entra", () => {
    const filas = [
      filaFixture("a", "PENDIENTE"),
      filaFixture("b", "PENDIENTE", { forzarDedupOff: true }),
      filaFixture("c", "DUPLICADA"),
      filaFixture("d", "YA-ENVIADA"),
      filaFixture("e", "ERROR"),
    ] as never[];
    const objetivo = objetivoPrescan(filas);
    expect(objetivo.map((f) => (f as { id: string }).id)).toEqual(["a"]);
  });
});

// ── 3 · Escritura (§F.2 sin token dedup · §C marcarYaEnviada tal cual) ──────

describe("e107 T5 · aplicarVeredictoPrescan (maquinaria de marcas de §C)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("8 · DUPLICADA: write IDB SIN campo `dedup` y CON `dupOf` + patch SOLO-VISUAL", async () => {
    mocksCola.leerRegistro.mockResolvedValue({
      id: "f2",
      estado: "PENDIENTE",
      nombre: "f2.jpg",
    });
    await aplicarVeredictoPrescan(
      "f2",
      { accion: "duplicada", originalId: "f1" },
      "PL",
      {
        leerRegistro: mocksCola.leerRegistro as never,
        guardarRegistro: mocksCola.guardarRegistro as never,
        actualizarFila: mocksStore.actualizarFila as never,
        marcarYaEnviada: mocksStore.marcarYaEnviada as never,
        registrarQrPayload: mocksStore.registrarQrPayload as never,
      },
    );
    expect(mocksCola.guardarRegistro).toHaveBeenCalledTimes(1);
    const reg = mocksCola.guardarRegistro.mock.calls[0]![0] as Record<string, unknown>;
    expect(reg.estado).toBe("DUPLICADA");
    expect(reg.dupOf).toBe("f1");
    expect(reg).not.toHaveProperty("dedup"); // §F.2 — el pre-scan NO miente telemetría ajena
    expect(mocksStore.actualizarFila).toHaveBeenCalledWith("f2", {
      estado: "DUPLICADA",
      dupOf: "f1",
    });
    expect(mocksStore.marcarYaEnviada).not.toHaveBeenCalled();
  });

  it("9 · ya-enviada: marcarYaEnviada TAL CUAL con via 'payload' (alimenta el ledger)", async () => {
    await aplicarVeredictoPrescan("f1", { accion: "ya-enviada", enviadaId: "hist-9" }, "PL", {
      leerRegistro: mocksCola.leerRegistro as never,
      guardarRegistro: mocksCola.guardarRegistro as never,
      actualizarFila: mocksStore.actualizarFila as never,
      marcarYaEnviada: mocksStore.marcarYaEnviada as never,
      registrarQrPayload: mocksStore.registrarQrPayload as never,
    });
    expect(mocksStore.marcarYaEnviada).toHaveBeenCalledWith(
      "f1",
      "hist-9",
      "payload",
      undefined,
      undefined,
      "PL",
    );
    expect(mocksCola.guardarRegistro).not.toHaveBeenCalled();
  });

  it("10 · registrar → registrarQrPayload(payload, id); nada → no-op", async () => {
    const deps = {
      leerRegistro: mocksCola.leerRegistro as never,
      guardarRegistro: mocksCola.guardarRegistro as never,
      actualizarFila: mocksStore.actualizarFila as never,
      marcarYaEnviada: mocksStore.marcarYaEnviada as never,
      registrarQrPayload: mocksStore.registrarQrPayload as never,
    };
    await aplicarVeredictoPrescan("f1", { accion: "registrar" }, "PL-NUEVO", deps);
    expect(mocksStore.registrarQrPayload).toHaveBeenCalledWith("PL-NUEVO", "f1");
    await aplicarVeredictoPrescan("f1", { accion: "nada" }, null, deps);
    expect(mocksStore.actualizarFila).not.toHaveBeenCalled();
    expect(mocksCola.guardarRegistro).not.toHaveBeenCalled();
  });

  it("11 · IDB caída al marcar → patch solo en memoria (conservador, §G)", async () => {
    mocksCola.leerRegistro.mockRejectedValue(new Error("IDB caída"));
    await aplicarVeredictoPrescan(
      "f1",
      { accion: "duplicada", originalId: "f2" },
      "PL",
      {
        leerRegistro: mocksCola.leerRegistro as never,
        guardarRegistro: mocksCola.guardarRegistro as never,
        actualizarFila: mocksStore.actualizarFila as never,
        marcarYaEnviada: mocksStore.marcarYaEnviada as never,
        registrarQrPayload: mocksStore.registrarQrPayload as never,
      },
    );
    expect(mocksCola.guardarRegistro).not.toHaveBeenCalled();
    expect(mocksStore.actualizarFila).toHaveBeenCalledWith("f1", {
      estado: "DUPLICADA",
      dupOf: "f2",
    });
  });
});

// ── 4 · Cliente con Worker fake (§H.1 — serial/hard-kill/boot/jamás throw) ──

describe("e107 T5 · prescan-qr.client (serial FIFO + hard-kill + boot honesto)", () => {
  beforeEach(() => {
    fabricados = [];
    ultimo = null;
    readyAuto = true;
    flagsState.prescan = true;
    vi.stubGlobal("Worker", class {});
    vi.stubGlobal("createImageBitmap", class {});
    vi.stubGlobal("OffscreenCanvas", class {});
    __setFabricaWorkerDeteccionParaTest(() => fabricaFalsa());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __setFabricaWorkerDeteccionParaTest(null);
  });

  it("12 · listo() → ready de la URL ?v=8 (1 solo worker)", async () => {
    const c = crearClientePrescan();
    expect(await c.listo()).toBe(true);
    expect(fabricados.length).toBe(1);
    c.destruir();
  });

  it("13 · serial estricto: 2 detectar concurrentes → 1 a la vez + transfer SIEMPRE", async () => {
    const c = crearClientePrescan();
    await c.listo();
    const bmp1 = { width: 400, height: 300 } as unknown as ImageBitmap;
    const bmp2 = { width: 400, height: 300 } as unknown as ImageBitmap;
    const p1 = c.detectar(bmp1);
    const p2 = c.detectar(bmp2);
    await Promise.resolve();
    await Promise.resolve();
    expect(ultimo!.enviados.length).toBe(1); // el 2.º ESPERA (FIFO)
    expect(ultimo!.enviados[0]!.msg.type).toBe("detect");
    expect(ultimo!.enviados[0]!.transfer).toContain(bmp1); // bitmap SIEMPRE transferido
    const ts1 = ultimo!.enviados[0]!.msg.ts as number;
    responderDetect(ultimo!, ts1, QUAD_OK);
    const r1 = await p1;
    expect(r1).toBe(QUAD_OK);
    await Promise.resolve();
    expect(ultimo!.enviados.length).toBe(2); // ahora sí salió el 2.º
    expect(ultimo!.enviados[1]!.transfer).toContain(bmp2);
    const ts2 = ultimo!.enviados[1]!.msg.ts as number;
    responderDetect(ultimo!, ts2, null);
    expect(await p2).toBeNull(); // corners null → null (sin QR)
    c.destruir();
  });

  it("14 · warp: quad sale en el msg (fracciones); 'warped'.bitmap resuelto", async () => {
    const c = crearClientePrescan();
    await c.listo();
    const bmpFull = { width: 4000, height: 3000 } as unknown as ImageBitmap;
    const warpedBmp = { width: 1200, height: 900, close: vi.fn() } as unknown as ImageBitmap;
    const p = c.warpar(bmpFull, QUAD_OK);
    await Promise.resolve();
    await Promise.resolve();
    expect(ultimo!.enviados[0]!.msg.type).toBe("warp");
    expect(ultimo!.enviados[0]!.msg.quad).toBe(QUAD_OK);
    expect(ultimo!.enviados[0]!.transfer).toContain(bmpFull);
    const ts = ultimo!.enviados[0]!.msg.ts as number;
    ultimo!.onmessage?.({ data: { type: "warped", bitmap: warpedBmp, ts } } as MessageEvent);
    expect(await p).toBe(warpedBmp);
    c.destruir();
  });

  it("15 · hard-kill: worker colgado → terminate + null + respawn PEREZOSO", async () => {
    vi.useFakeTimers();
    try {
      const c = crearClientePrescan();
      await c.listo();
      const creado1 = ultimo!;
      const p = c.detectar({ width: 400, height: 300 } as unknown as ImageBitmap);
      const promesa = vi.advanceTimersByTimeAsync(PRESUPUESTO_FILA_MS + HARD_KILL_EXTRA_MS + 1);
      expect(await p).toBeNull(); // jamás frena el clic
      await promesa;
      expect(creado1.terminado).toBe(true); // terminate del zombi
      // respawn PEREZOSO: el próximo pedir() re-bootea con worker NUEVO
      readyAuto = true;
      const p2 = c.detectar({ width: 400, height: 300 } as unknown as ImageBitmap);
      await vi.advanceTimersByTimeAsync(1);
      expect(fabricados.length).toBe(2); // worker nuevo
      const ts2 = ultimo!.enviados[0]!.msg.ts as number;
      responderDetect(ultimo!, ts2, QUAD_OK);
      expect(await p2).toBe(QUAD_OK); // «las demás siguen» (§G)
      c.destruir();
    } finally {
      vi.useRealTimers();
    }
  });

  it("16 · boot-timeout: OpenCV nunca listo → listo()=false probando AMBAS URLs", async () => {
    vi.useFakeTimers();
    try {
      readyAuto = false; // worker jamás publica ready
      const c = crearClientePrescan();
      const promesa = c.listo();
      void promesa;
      await vi.advanceTimersByTimeAsync(BOOT_TIMEOUT_MS + 1); // URL ?v=8 vence
      await vi.advanceTimersByTimeAsync(BOOT_TIMEOUT_MS + 1); // URL sin query vence
      expect(await promesa).toBe(false); // abort honesto (§G)
      expect(fabricados.length).toBe(2);
      expect(fabricados.every((w) => w.terminado)).toBe(true);
      c.destruir();
    } finally {
      vi.useRealTimers();
    }
  });

  it("17 · onerror (crash duro) → null + terminate; el próximo pedir re-bootea", async () => {
    const c = crearClientePrescan();
    await c.listo();
    const p = c.detectar({ width: 400, height: 300 } as unknown as ImageBitmap);
    await Promise.resolve();
    await Promise.resolve();
    ultimo!.onerror?.(new Error("crash"));
    expect(await p).toBeNull();
    expect(ultimo!.terminado).toBe(true);
    c.destruir();
  });

  it("18 · postMessage que TIRA → null sin throw (jamás tumba el clic)", async () => {
    const c = crearClientePrescan();
    await c.listo();
    ultimo!.postMessage = () => {
      throw new Error("postMessage roto");
    };
    const r = await c.detectar({ width: 400, height: 300 } as unknown as ImageBitmap);
    expect(r).toBeNull();
    c.destruir();
  });

  it("19 · 'error'/'busy' del worker → null conservador (el worker sigue vivo)", async () => {
    const c = crearClientePrescan();
    await c.listo();
    const p = c.detectar({ width: 400, height: 300 } as unknown as ImageBitmap);
    await Promise.resolve();
    await Promise.resolve();
    const ts = ultimo!.enviados[0]!.msg.ts as number;
    ultimo!.onmessage?.({ data: { type: "error", ts } } as MessageEvent);
    expect(await p).toBeNull();
    expect(ultimo!.terminado).toBe(false); // NO lo mata — recupera por su cuenta
    c.destruir();
  });

  it("20 · destruir con op en vuelo → resuelve null (jamás colgar al orquestador)", async () => {
    const c = crearClientePrescan();
    await c.listo();
    const p = c.detectar({ width: 400, height: 300 } as unknown as ImageBitmap);
    await Promise.resolve();
    await Promise.resolve();
    c.destruir();
    expect(await p).toBeNull();
  });

  it("21 · feature-detect: sin Worker/createImageBitmap/OffscreenCanvas → listo()=false sin instanciar", async () => {
    vi.unstubAllGlobals(); // node real: nada existe
    const espia = vi.fn(() => fabricaFalsa());
    __setFabricaWorkerDeteccionParaTest(espia as never);
    const c = crearClientePrescan();
    expect(await c.listo()).toBe(false);
    expect(espia).not.toHaveBeenCalled(); // jamás instanció nada
    expect(await c.detectar({} as unknown as ImageBitmap)).toBeNull();
  });
});

// ── 5 · Orquestador (re-entrada + kill-switch) ──────────────────────────────

describe("e107 T5 · prescanYIniciar (re-entrada + flag OFF byte-idéntico)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fabricados = [];
    ultimo = null;
    readyAuto = true;
    flagsState.prescan = true;
    storeState.corriendo = false;
    storeState.filas = [filaFixture("f1", "PENDIENTE")];
    vi.stubGlobal("Worker", class {});
    vi.stubGlobal("createImageBitmap", class {});
    vi.stubGlobal("OffscreenCanvas", class {});
    __setFabricaWorkerDeteccionParaTest(() => fabricaFalsa());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __setFabricaWorkerDeteccionParaTest(null);
  });

  it("22 · flag OFF (kill-switch) → se llamó `iniciar` y NO se instanció worker", async () => {
    flagsState.prescan = false;
    await prescanYIniciar();
    expect(mocksStore.iniciar).toHaveBeenCalledTimes(1);
    expect(fabricados.length).toBe(0); // SIN worker — byte-idéntico a hoy
    expect(usePrescanStore.getState().corriendo).toBe(false);
    // e14-quad-streaming (P4/P5): sin flags → CERO stamps (byte-idéntico).
    expect(mocksStore.actualizarFila).not.toHaveBeenCalled();
  });

  it("23 · re-entrada: doble llamada concurrente ⇒ 1 corrida (1 worker, 1 iniciar)", async () => {
    const p1 = prescanYIniciar();
    const p2 = prescanYIniciar(); // corriendo=true ya emitido en el prefijo sync
    await Promise.all([p1, p2]);
    expect(fabricados.length).toBe(1); // UNA corrida
    expect(mocksStore.iniciar).toHaveBeenCalledTimes(1); // R7 único
    const st = usePrescanStore.getState();
    expect(st.corriendo).toBe(false);
    expect(st.fase).toBe("fin");
    expect(st.total).toBe(1);
  });

  it("24 · cola ya corriendo (R2) → iniciar() y fuera (sin worker)", async () => {
    storeState.corriendo = true;
    await prescanYIniciar();
    expect(mocksStore.iniciar).toHaveBeenCalledTimes(1);
    expect(fabricados.length).toBe(0);
  });

  it("25 · sin PENDIENTE (R3) → iniciar() directo, idempotente como hoy", async () => {
    storeState.filas = [filaFixture("f1", "YA-ENVIADA")];
    await prescanYIniciar();
    expect(mocksStore.iniciar).toHaveBeenCalledTimes(1);
    expect(fabricados.length).toBe(0);
  });
});

// ── 5-b · KIT e14-quad-streaming-v1 (P4/P5) — quad + streaming seguro ───────

describe("e14-quad-streaming T6 · quadDeFracciones (puro — jamás inventa)", () => {
  it("29 · Float32Array(8) válido → Quad del core (4 puntos en orden)", () => {
    // 0.25/0.75 son EXACTOS en float32 (0.1 no lo es — comparación bit a bit).
    const q = quadDeFracciones(Float32Array.of(0.25, 0.25, 0.75, 0.25, 0.75, 0.75, 0.25, 0.75));
    expect(q).toEqual([
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.25 },
      { x: 0.75, y: 0.75 },
      { x: 0.25, y: 0.75 },
    ]);
  });

  it("30 · forma/NaN/null → null (conservador — sin quad el runner usa detección propia)", () => {
    expect(quadDeFracciones(null)).toBeNull();
    expect(quadDeFracciones(undefined)).toBeNull();
    expect(quadDeFracciones(Float32Array.of(1, 2, 3))).toBeNull(); // longitud
    expect(
      quadDeFracciones(Float32Array.of(0.1, 0.1, 0.9, Number.NaN, 0.9, 0.9, 0.1, 0.9)),
    ).toBeNull(); // NaN
  });
});

describe("e14-quad-streaming T6 · turno-clasificacion (semáforo del filtro del runner)", () => {
  beforeEach(() => {
    __resetTurnoClasificacionParaTest();
  });

  afterEach(() => {
    __resetTurnoClasificacionParaTest();
  });

  it("31 · abrir/cerrar: enCurso refleja el turno; inicioMs queda; reset limpia", () => {
    expect(turnoClasificacionEnCurso()).toBe(false); // nunca abrió
    expect(turnoClasificacionInicioMs()).toBe(0);
    abrirTurnoClasificacion(1234);
    expect(turnoClasificacionEnCurso()).toBe(true);
    expect(turnoClasificacionInicioMs()).toBe(1234);
    cerrarTurnoClasificacion();
    expect(turnoClasificacionEnCurso()).toBe(false); // filtro inerte
    expect(turnoClasificacionInicioMs()).toBe(1234); // el instante queda (informativo)
    __resetTurnoClasificacionParaTest();
    expect(turnoClasificacionInicioMs()).toBe(0);
  });
});

describe("e14-quad-streaming T6 · prescanYIniciar (stamps P4/P5 — flags ON)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks NO limpia IMPLEMENTACIONES (solo llamadas) — tests
    // previos del archivo dejan mockRejectedValue ("IDB caída", test 11) /
    // mockReturnValue — re-poner los caminos felices para este describe.
    mocksCola.leerRegistro.mockResolvedValue({ archivo: new Blob(["x"]) });
    mocksCola.guardarRegistro.mockResolvedValue(undefined);
    mocksStore.originalQrDePayload.mockReturnValue(null);
    mocksStore.enviadaPorPayload.mockResolvedValue(null);
    mocksStore.marcarYaEnviada.mockResolvedValue(true);
    fabricados = [];
    ultimo = null;
    readyAuto = true;
    flagsState.prescan = true;
    flagsState.quad = false;
    flagsState.streaming = false;
    storeState.corriendo = false;
    storeState.filas = [filaFixture("f1", "PENDIENTE")];
    vi.stubGlobal("Worker", class {});
    vi.stubGlobal("createImageBitmap", class {});
    vi.stubGlobal("OffscreenCanvas", class {});
    __setFabricaWorkerDeteccionParaTest(() => fabricaFalsa());
    __resetTurnoClasificacionParaTest();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __setFabricaWorkerDeteccionParaTest(null);
    __resetTurnoClasificacionParaTest();
    flagsState.quad = false;
    flagsState.streaming = false;
  });

  it("32 · streaming ON + fila que falla temprano → barrido de cierre estampa prescanOk + turno cierra", async () => {
    flagsState.streaming = true;
    storeState.filas = [
      { id: "f1", estado: "PENDIENTE" }, // createImageBitmap stub (class) TIRA → catch → sin veredicto
    ];
    await prescanYIniciar();
    // Barrido de cierre: la fila quedó decidida (JAMÁS colgada).
    expect(mocksStore.actualizarFila).toHaveBeenCalledWith("f1", { prescanOk: true });
    expect(turnoClasificacionEnCurso()).toBe(false); // turno CERRADO al terminar
    expect(mocksStore.iniciar).toHaveBeenCalled(); // R7 (el runner consume todo)
  });

  it("33 · streaming ON + PROCESAR IGUAL → stamp UPFRONT (RL-e65b-6 — va directo al pool)", async () => {
    flagsState.streaming = true;
    storeState.filas = [
      { id: "f-owner", estado: "PENDIENTE", forzarDedupOff: true },
      { id: "f1", estado: "PENDIENTE" },
    ];
    await prescanYIniciar();
    expect(mocksStore.actualizarFila).toHaveBeenCalledWith("f-owner", { prescanOk: true });
    // f1 (objetivo normal): el barrido de cierre la decide (el stub tira).
    expect(mocksStore.actualizarFila).toHaveBeenCalledWith("f1", { prescanOk: true });
    expect(turnoClasificacionEnCurso()).toBe(false);
  });

  it("34 · abort honesto (fábrica null) + streaming ON → TODO el objetivo decide en el barrido", async () => {
    flagsState.streaming = true;
    __setFabricaWorkerDeteccionParaTest(() => null); // ni una URL bootea → listo()=false inmediato
    await prescanYIniciar();
    expect(mocksStore.actualizarFila).toHaveBeenCalledWith("f1", { prescanOk: true });
    expect(mocksStore.iniciar).toHaveBeenCalledTimes(1); // R7 con TODO decidido
    expect(turnoClasificacionEnCurso()).toBe(false);
  });

  it("35 · flujo completo (worker auto-responde) + streaming+quad ON → stamp prescanOk + quad EXACTO, iniciar temprano", async () => {
    flagsState.streaming = true;
    flagsState.quad = true;
    const warpedFalso = {
      width: 1200,
      height: 900,
      close: () => {},
    } as unknown as ImageBitmap;
    // Worker auto-responde: detect → QUAD_OK · warp → bitmap (sin timing frágil).
    __setFabricaWorkerDeteccionParaTest(() => {
      const w = fabricaFalsa();
      const basePost = w.postMessage.bind(w);
      w.postMessage = (msg: unknown, transfer?: Transferable[]) => {
        basePost(msg, transfer);
        const m = msg as { type?: string; ts?: number };
        queueMicrotask(() => {
          if (m.type === "detect") {
            w.onmessage?.({
              data: { type: "result", corners: QUAD_OK, ts: m.ts },
            } as MessageEvent);
          } else if (m.type === "warp") {
            w.onmessage?.({
              data: { type: "warped", bitmap: warpedFalso, ts: m.ts },
            } as MessageEvent);
          }
        });
      };
      return w;
    });
    // Decode del blob OK (el stub class TIRABA — ahora devuelve bitmap con close).
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () =>
        ({ width: 400, height: 300, close: () => {} }) as unknown as ImageBitmap),
    );
    await prescanYIniciar();
    // Stamp EXACTO: prescanOk (P5) + quad del worker (P4 — fracciones 0-1;
    // closeTo — el Float32Array del worker trae precisión float32).
    expect(mocksStore.actualizarFila).toHaveBeenCalledWith("f1", {
      prescanOk: true,
      quad: [
        { x: expect.closeTo(0.1), y: expect.closeTo(0.1) },
        { x: expect.closeTo(0.9), y: expect.closeTo(0.1) },
        { x: expect.closeTo(0.9), y: expect.closeTo(0.9) },
        { x: expect.closeTo(0.1), y: expect.closeTo(0.9) },
      ],
    });
    expect(mocksStore.iniciar).toHaveBeenCalledTimes(2); // temprano (1.er stamp) + R7
    expect(turnoClasificacionEnCurso()).toBe(false);
  });

  it("36 · quad ON sin streaming → stamp SOLO del quad; iniciar SOLO el R7 de siempre", async () => {
    flagsState.quad = true;
    const warpedFalso = { width: 1200, height: 900, close: () => {} } as unknown as ImageBitmap;
    __setFabricaWorkerDeteccionParaTest(() => {
      const w = fabricaFalsa();
      const basePost = w.postMessage.bind(w);
      w.postMessage = (msg: unknown, transfer?: Transferable[]) => {
        basePost(msg, transfer);
        const m = msg as { type?: string; ts?: number };
        queueMicrotask(() => {
          if (m.type === "detect") {
            w.onmessage?.({
              data: { type: "result", corners: QUAD_OK, ts: m.ts },
            } as MessageEvent);
          } else if (m.type === "warp") {
            w.onmessage?.({
              data: { type: "warped", bitmap: warpedFalso, ts: m.ts },
            } as MessageEvent);
          }
        });
      };
      return w;
    });
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () =>
        ({ width: 400, height: 300, close: () => {} }) as unknown as ImageBitmap),
    );
    await prescanYIniciar();
    expect(mocksStore.actualizarFila).toHaveBeenCalledWith("f1", {
      quad: [
        { x: expect.closeTo(0.1), y: expect.closeTo(0.1) },
        { x: expect.closeTo(0.9), y: expect.closeTo(0.1) },
        { x: expect.closeTo(0.9), y: expect.closeTo(0.9) },
        { x: expect.closeTo(0.1), y: expect.closeTo(0.9) },
      ],
    });
    expect(mocksStore.iniciar).toHaveBeenCalledTimes(1); // SOLO R7 — sin streaming
  });
});

// ── 6 · leerQrDeWarped (cadena del harness — BD → jsQR → null) ──────────────

describe("e107 T5 · leerQrDeWarped (BarcodeDetector → jsQR → null, jamás throw)", () => {
  it("26 · BarcodeDetector presente → rawValue EXACTO (sin tocar canvas)", async () => {
    vi.stubGlobal(
      "BarcodeDetector",
      class {
        async detect(): Promise<{ rawValue: string }[]> {
          return [{ rawValue: "PL-EXACTO" }];
        }
      },
    );
    try {
      const r = await leerQrDeWarped({ width: 800, height: 600 } as unknown as ImageBitmap);
      expect(r).toBe("PL-EXACTO");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("27 · sin BD y sin OffscreenCanvas → null honesto (node)", async () => {
    const r = await leerQrDeWarped({ width: 800, height: 600 } as unknown as ImageBitmap);
    expect(r).toBeNull();
  });

  it("28 · BD que TIRA + canvas que TIRA → null (jamás throw)", async () => {
    vi.stubGlobal(
      "BarcodeDetector",
      class {
        detect(): Promise<{ rawValue: string }[]> {
          throw new Error("BD roto");
        }
      },
    );
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext(): null {
          throw new Error("canvas roto");
        }
      },
    );
    try {
      const r = await leerQrDeWarped({ width: 800, height: 600 } as unknown as ImageBitmap);
      expect(r).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
