/**
 * WAVE3 §A.2 — ORDEN-WAVE3-remoto-rescate-obs-v1 (feat/ledger-remoto-envios-v1):
 * PRIMERA API route del app — el ledger REMOTO de envíos (D1). El acceso al
 * binding vive aquí (getCloudflareContext — @opennextjs/cloudflare ya es
 * devDep). SIN CORS (same-origin: cada origen consulta su propio binding →
 * la MISMA D1 — idempotencia cross-origen real).
 *
 *  · POST { action: "check" | "registrar", payloadHash, serie?, filaId?, origenUrl? }
 *    - check:     SELECT → { duplicado, tsOriginal?, filaOriginal? }
 *    - registrar: INSERT ON CONFLICT DO NOTHING → { ok, duplicado } (idempotente)
 *    - D1 caído / binding ausente → 500 { error } (el cliente lo trata como
 *      «sin red extra» — doctrina del conservador: la fila sigue su curso).
 *  · DELETE ?confirmacion=e14-reset-pruebas → vacía la tabla (válvula de
 *    pruebas del dueño — NUNCA se llama automáticamente; sin el parámetro
 *    exacto → 403).
 *
 * PRIVACIDAD dura: al servidor JAMÁS viaja el payload QR completo — solo su
 * SHA-256 (64 hex), la serie y metadatos mínimos (longitudes acotadas).
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Tipo ESTRUCTURAL mínimo del binding D1 (sin depender de tipos globales
 *  de workers — mockeable en los tests del route handler). */
interface D1Preparada {
  bind: (...valores: (string | number | null)[]) => {
    first: () => Promise<Record<string, unknown> | null>;
    run: () => Promise<{ meta?: { changes?: number } }>;
  };
  first: () => Promise<Record<string, unknown> | null>;
  run: () => Promise<{ meta?: { changes?: number } }>;
}
interface D1Como {
  prepare: (sql: string) => D1Preparada;
}

/** Binding del ledger (o throw — el catch total responde 500 honesto). */
async function db(): Promise<D1Como> {
  const ctx = await getCloudflareContext({ async: true });
  const d1 = (ctx.env as { DB_ENVIOS_E14?: D1Como }).DB_ENVIOS_E14;
  if (!d1) throw new Error("BINDING_AUSENTE");
  return d1;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Limpieza defensiva de strings opcionales (longitudes acotadas — jamás
 *  inventar: sin dato → null). */
function limpiar(v: unknown, max: number): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return v.length > max ? v.slice(0, max) : v;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const cuerpo = (await request.json().catch(() => null)) as
      | {
          action?: string;
          payloadHash?: unknown;
          serie?: unknown;
          filaId?: unknown;
          origenUrl?: unknown;
        }
      | null;
    if (!cuerpo) return Response.json({ error: "CUERPO_INVALIDO" }, { status: 400 });
    const hash = typeof cuerpo.payloadHash === "string" ? cuerpo.payloadHash.toLowerCase() : "";
    if (!HEX64.test(hash)) {
      return Response.json({ error: "PAYLOAD_HASH_INVALIDO" }, { status: 400 });
    }
    if (cuerpo.action === "check") {
      const d1 = await db();
      const fila = await d1
        .prepare("SELECT ts, fila_id FROM envios WHERE payload_hash = ?1")
        .bind(hash)
        .first();
      if (!fila) return Response.json({ duplicado: false });
      return Response.json({
        duplicado: true,
        tsOriginal: typeof fila.ts === "number" ? fila.ts : null,
        filaOriginal: typeof fila.fila_id === "string" ? fila.fila_id : null,
      });
    }
    if (cuerpo.action === "registrar") {
      const d1 = await db();
      const r = await d1
        .prepare(
          "INSERT INTO envios (payload_hash, serie, fila_id, origen_url, ts) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(payload_hash) DO NOTHING",
        )
        .bind(hash, limpiar(cuerpo.serie, 32), limpiar(cuerpo.filaId, 64), limpiar(cuerpo.origenUrl, 256), Date.now())
        .run();
      const changes = r.meta?.changes ?? 0;
      return Response.json({ ok: true, duplicado: changes === 0 });
    }
    return Response.json({ error: "ACTION_INVALIDA" }, { status: 400 });
  } catch {
    // D1 caído / binding ausente — degradación honesta (el cliente continúa
    // como hoy: el remoto es una red EXTRA, jamás una dependencia).
    return Response.json({ error: "LEDGER_INDISPONIBLE" }, { status: 500 });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("confirmacion") !== "e14-reset-pruebas") {
      return Response.json({ error: "CONFIRMACION_REQUERIDA" }, { status: 403 });
    }
    const d1 = await db();
    await d1.prepare("DELETE FROM envios").run();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "LEDGER_INDISPONIBLE" }, { status: 500 });
  }
}
