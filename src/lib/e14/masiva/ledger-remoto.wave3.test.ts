/**
 * Tests — WAVE3 §A (ORDEN-WAVE3-remoto-rescate-obs-v1, feat/ledger-remoto-
 * envios-v1): ledger REMOTO de envíos (D1).
 *  · Route handler (handler.ts vía route.e14api) — check/registrar/DELETE con binding D1
 *    MOCKEADO (estructura exacta de la API D1: prepare/bind/first/run +
 *    meta.changes). Validación defensiva (hash 64 hex, action inválida).
 *  · Cliente ledger-remoto.ts — fetch INYECTADO (cero red real):
 *    duplicado parse, indisponible → null (doctrina del conservador),
 *    registro con SOLO el SHA-256 (jamás el payload — privacidad dura),
 *    válvula de pruebas DELETE.
 *  · sha256HexDeTexto — hex 64 con el webcrypto real de node; null sin
 *    subtle (conservador).
 *  · Guard de contrato (source-inspection): el hook del runner vive dentro
 *    del bloque OPTIMA (ANTES de registrarEnvioMasiva), con guard
 *    forzarDedupOff (RL-e65b-6), timeout/indicibilidad → continúa, y el
 *    registro remoto es fire-and-forget DESPUÉS del envío local exitoso.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── D1 falsa (estructura EXACTA de la API real: prepare→bind→first/run) ──
const tabla = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => ({
    env: {
      DB_ENVIOS_E14: {
        prepare: (sql: string) => ({
          bind: (...v: (string | number | null)[]) => ({
            first: async () => {
              if (sql.includes("SELECT")) {
                const r = tabla.get(String(v[0]));
                return r ? { ...r } : null;
              }
              return null;
            },
            run: async () => {
              if (sql.includes("INSERT")) {
                const k = String(v[0]);
                if (tabla.has(k)) return { meta: { changes: 0 } };
                tabla.set(k, {
                  payload_hash: k,
                  serie: v[1],
                  fila_id: v[2],
                  origen_url: v[3],
                  ts: v[4],
                });
                return { meta: { changes: 1 } };
              }
              if (sql.includes("DELETE")) {
                const n = tabla.size;
                tabla.clear();
                return { meta: { changes: n } };
              }
              return { meta: { changes: 0 } };
            },
          }),
          first: async () => null,
          run: async () => {
            // run DIRECTO del statement (sin bind — lo usa el DELETE de la route):
            if (sql.includes("DELETE")) {
              const n = tabla.size;
              tabla.clear();
              return { meta: { changes: n } };
            }
            return { meta: { changes: 0 } };
          },
        }),
      },
    },
  })),
}));

import { DELETE, POST } from "../../../app/api/e14/envios/handler";
import {
  LEDGER_RUTA,
  consultarEnvioRemoto,
  registrarEnvioRemoto,
  sha256HexDeTexto,
  vaciarLedgerRemoto,
} from "./ledger-remoto";
import { readFileSync } from "node:fs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function postJson(cuerpo: unknown): Request {
  return new Request("https://app.local/api/e14/envios", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

beforeEach(() => {
  tabla.clear();
});

describe("WAVE3 §A.2 — route handler (check/registrar idempotente/DELETE)", () => {
  it("check: hash existente → duplicado:true + tsOriginal + filaOriginal", async () => {
    tabla.set(HASH_A, { payload_hash: HASH_A, serie: "18110011", fila_id: "F-1", ts: 1_724_000_000_000 });
    const r = await POST(postJson({ action: "check", payloadHash: HASH_A }));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { duplicado: boolean; tsOriginal?: number; filaOriginal?: string };
    expect(j.duplicado).toBe(true);
    expect(j.tsOriginal).toBe(1_724_000_000_000);
    expect(j.filaOriginal).toBe("F-1");
  });
  it("check: hash nuevo → duplicado:false", async () => {
    const r = await POST(postJson({ action: "check", payloadHash: HASH_B }));
    expect(((await r.json()) as { duplicado: boolean }).duplicado).toBe(false);
  });
  it("registrar: inserta; segundo registro IGUAL → duplicado:true y UNA sola fila", async () => {
    const r1 = await POST(postJson({ action: "registrar", payloadHash: HASH_A, serie: "18110011", filaId: "F-1", origenUrl: "https://digielect14.pages.dev" }));
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { duplicado: boolean }).duplicado).toBe(false);
    expect(tabla.size).toBe(1);
    const r2 = await POST(postJson({ action: "registrar", payloadHash: HASH_A }));
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as { duplicado: boolean }).duplicado).toBe(true);
    expect(tabla.size).toBe(1); // ON CONFLICT DO NOTHING — idempotente
  });
  it("validación defensiva: hash no-64-hex → 400; hash MAYÚSCULAS se normaliza (200); action inválida → 400", async () => {
    expect((await POST(postJson({ action: "check", payloadHash: "xyz" }))).status).toBe(400);
    // la route normaliza a minúsculas ANTES de validar (64 hex):
    expect((await POST(postJson({ action: "check", payloadHash: "A".repeat(64) }))).status).toBe(200);
    expect((await POST(postJson({ action: "bailar", payloadHash: HASH_A }))).status).toBe(400);
  });
  it("DELETE sin confirmación → 403; con e14-reset-pruebas → vacía", async () => {
    tabla.set(HASH_A, { payload_hash: HASH_A, ts: 1 });
    tabla.set(HASH_C, { payload_hash: HASH_C, ts: 2 });
    const sin = await DELETE(new Request("https://app.local/api/e14/envios", { method: "DELETE" }));
    expect(sin.status).toBe(403);
    expect(tabla.size).toBe(2); // NADA se borró (válvula protegida)
    const con = await DELETE(new Request("https://app.local/api/e14/envios?confirmacion=e14-reset-pruebas", { method: "DELETE" }));
    expect(con.status).toBe(200);
    expect(tabla.size).toBe(0);
  });
});

describe("WAVE3 §A.3 — cliente ledger-remoto (fetch inyectado, conservador)", () => {
  it("consultarEnvioRemoto: duplicado:true parse; 500 → null (indisponible); red cae → null", async () => {
    const okResp = new Response(JSON.stringify({ duplicado: true, filaOriginal: "F-9", tsOriginal: 7 }), { status: 200 });
    const traerOk = vi.fn(async (url: string) => {
      expect(url).toBe(LEDGER_RUTA);
      return okResp;
    });
    expect(await consultarEnvioRemoto(HASH_A, { traer: traerOk })).toEqual({
      duplicado: true,
      tsOriginal: 7,
      filaOriginal: "F-9",
    });
    const traer500 = vi.fn(async () => new Response("{}", { status: 500 }));
    expect(await consultarEnvioRemoto(HASH_A, { traer: traer500 })).toBeNull();
    const traerCaido = vi.fn(async () => {
      throw new Error("red caída");
    });
    expect(await consultarEnvioRemoto(HASH_A, { traer: traerCaido })).toBeNull();
  });
  it("registrarEnvioRemoto: SOLO el SHA-256 viaja (jamás el payload QR); error HTTP → throw (el caller traga)", async () => {
    let cuerpoCapturado: Record<string, unknown> | null = null;
    const traer = vi.fn(async (_url: string, init?: RequestInit) => {
      cuerpoCapturado = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ ok: true, duplicado: false }), { status: 200 });
    });
    await registrarEnvioRemoto(
      { payloadHash: HASH_A, serie: "18110011", filaId: "F-1", origenUrl: "https://digielect14.pages.dev" },
      { traer },
    );
    expect(cuerpoCapturado!.action).toBe("registrar");
    expect(cuerpoCapturado!.payloadHash).toBe(HASH_A);
    // PRIVACIDAD dura: el body jamás lleva un payload QR (base64 32 bytes):
    expect(JSON.stringify(cuerpoCapturado)).not.toContain("=");
    const traerError = vi.fn(async () => new Response("{}", { status: 503 }));
    await expect(registrarEnvioRemoto({ payloadHash: HASH_A }, { traer: traerError })).rejects.toThrow();
  });
  it("vaciarLedgerRemoto: DELETE con la confirmación EXACTA; fallo → {ok:false}", async () => {
    const traerOk = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("DELETE");
      expect(url).toContain("confirmacion=e14-reset-pruebas");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    expect(await vaciarLedgerRemoto({ traer: traerOk })).toEqual({ ok: true });
    const traer403 = vi.fn(async () => new Response(JSON.stringify({ error: "CONFIRMACION_REQUERIDA" }), { status: 403 }));
    const r = await vaciarLedgerRemoto({ traer: traer403 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("CONFIRMACION_REQUERIDA");
  });
});

describe("WAVE3 §A.3 — sha256HexDeTexto (privacidad dura: solo el hash viaja)", () => {
  it("hex 64 determinista con el webcrypto real; sin crypto.subtle → null (conservador)", async () => {
    const h1 = await sha256HexDeTexto("payload-qr-e14");
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(await sha256HexDeTexto("payload-qr-e14"));
    expect(h1).not.toBe(await sha256HexDeTexto("payload-qr-e14-distinto"));
    vi.stubGlobal("crypto", {}); // sin subtle (contexto raro)
    expect(await sha256HexDeTexto("x")).toBeNull();
  });
});

describe("WAVE3 §A.3 — guard de contrato (source-inspection del hook del runner)", () => {
  it("veto REMOTO dentro del bloque OPTIMA y ANTES del envío; escape forzarDedupOff; fire-and-forget DESPUÉS del envío local", () => {
    const src = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
    const iOptima = src.indexOf('if (actaDesenlace.status === "OPTIMA") {');
    const iRemoto = src.indexOf("veto ya-enviada REMOTO");
    const iEnvio = src.indexOf("registrarEnvioMasiva(actaDesenlace);");
    expect(iOptima).toBeGreaterThan(-1);
    expect(iRemoto).toBeGreaterThan(iOptima);
    expect(iEnvio).toBeGreaterThan(iRemoto); // el check remoto ANTES del envío
    // el escape del dueño manda TAMBIÉN sobre el remoto (RL-e65b-6):
    expect(src).toContain("if (diagQr && !fila.forzarDedupOff) {\n        const payloadHashRemoto");
    // indisponible → continúa (doctrina del conservador — jamás bloquea):
    expect(src).toContain("[e14] ledger remoto indisponible — continúo");
    // puerta D57 AL FINAL del enum vía marcarYaEnviada:
    expect(src).toContain('"payload-remoto", // WAVE3 §A.3/D57 — valor NUEVO AL FINAL');
    // el registro remoto nace SOLO tras el envío local exitoso (fire-and-forget):
    const iRegistro = src.indexOf("registrarEnvioRemoto({\n            payloadHash,");
    expect(iRegistro).toBeGreaterThan(iEnvio);
    expect(src).toContain("if (diagQr && onlineAlEnviar && !fila.forzarDedupOff) {");
    // G.5 — remotoMs estampa en el MISMO parche D61 (omitido si no corrió):
    expect(src).toContain("...(remotoMs != null ? { remotoMs } : {}),");
  });
  it("store.ts: el registro remoto nace TAMBIÉN al drenar (refrescarEnviosTrasDrenaje — fire-and-forget)", () => {
    const src = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
    const iDrenaje = src.indexOf("export async function refrescarEnviosTrasDrenaje");
    const iRegistro = src.indexOf("registrarEnvioRemoto({\n            payloadHash,");
    expect(iDrenaje).toBeGreaterThan(-1);
    expect(iRegistro).toBeGreaterThan(iDrenaje);
    expect(src).toContain("void (async () => {\n          const payloadHash = await sha256HexDeTexto(payloadDrenado);");
  });
});
