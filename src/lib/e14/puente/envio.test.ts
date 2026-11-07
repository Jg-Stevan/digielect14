/**
 * KIT e14-puente-supervision-v2 — TESTS del transporte (Ola 2, bloque 2.1 —
 * cierra T1/F4: `puente/` pasa de 0 % efectivo a suite propia).
 *
 * Encodean el CONTRATO AUTENTICADO de la Ola 0 (fallarían si alguien quita
 * las headers de la 0.1 o revierte el endurecimiento 0.5):
 *  1. lote válido lleva x-e14-ts + x-e14-firma (HMAC verificable del body crudo)
 *  2. dedupe: re-encolar la misma acta no duplica envíos
 *  3. kill local: 5 fallos seguidos pausan la cola (sin martillar el hub)
 *  4. reintento: 500 → 200 deja el outbox vacío
 *  5. borrado por lote elimina exactamente lo aceptado
 *  6. hub local (LAN) viaja SIN firma (contrato hub-local.mjs)
 *  7. sin clave de jornada → NO envía a producción (SIN_CLAVE_JORNADA), cola intacta
 *  8. 410 → contratoObsoleto pausa la cola SIN marcar el acta como fallida (H-4b)
 *  9. override `http://` rechazado por el normalizador (0.5/S3)
 * 10. 429 es transitorio: cola intacta, reintenta después
 *
 * Requiere `fake-indexeddb` (devDependency — el outbox del puente es IDB) y
 * entorno jsdom (localStorage + location para identidad/hub-local).
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { crearEntradadePrueba, resetearPuenteParaTests } from "./puente.test-utils";
import { contarPendientes, encolarActa } from "./cola";
import { claveJornada, fijarClaveJornada, hmacBase64 } from "./firma";
import { normalizarHubUrl } from "./url-hub";
import { FALLOS_KILL_LOCAL, enviarPendientes, estadoPuente, hubEnUso } from "./envio";

/** fetch falso: responde 200 con el cuerpo del hub v1. */
function fetchOk(registrar?: (url: string, init?: RequestInit) => void) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    registrar?.(String(input), init);
    return new Response(
      JSON.stringify({ ok: true, insertadas: 1, duplicados: 0, rechazadas: [] }),
      { status: 200 },
    );
  });
}

const HUB = "https://e14-puente.julistevan02.workers.dev";

beforeEach(() => {
  window.localStorage.clear();
  fijarClaveJornada("clave-de-jornada-tests");
});

afterEach(async () => {
  await resetearPuenteParaTests();
  vi.restoreAllMocks();
});

describe("puente/envio — contrato autenticado Ola 0", () => {
  it("envía un lote válido a /v1/actas con headers de firma verificables (S-1)", async () => {
    const capturas: { url: string; init?: RequestInit }[] = [];
    const doFetch = fetchOk((url, init) => capturas.push({ url, init }));
    await encolarActa(crearEntradadePrueba());
    const { enviadas } = await enviarPendientes(doFetch);
    expect(enviadas).toBe(1);
    expect(capturas.length).toBe(1);
    expect(capturas[0].url).toBe(`${HUB}/v1/actas`);
    const headers = capturas[0].init?.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-e14-ts"]).toBeTruthy();
    expect(headers["x-e14-firma"]).toBeTruthy();
    // La firma verifica contra EL BODY CRUDO exacto que salió por la red,
    // con el MISMO ts capturado en los headers (S-1: mismos bytes firmados
    // y enviados — el test lo recalcula de forma independiente).
    const clave = claveJornada() ?? "";
    const esperada = await hmacBase64(
      clave,
      `${headers["x-e14-ts"]}.${String(capturas[0].init?.body)}`,
    );
    expect(headers["x-e14-firma"]).toBe(esperada);
    expect(await contarPendientes()).toBe(0);
  });

  it("dedupe: la misma acta re-encolada no genera un segundo envío", async () => {
    const doFetch = fetchOk();
    await encolarActa(crearEntradadePrueba());
    await encolarActa(crearEntradadePrueba()); // put idempotente por hash
    const primera = await enviarPendientes(doFetch);
    expect(primera.enviadas).toBe(1);
    const segunda = await enviarPendientes(doFetch);
    expect(segunda.enviadas).toBe(0);
    expect(doFetch).toHaveBeenCalledTimes(1); // el reenvío no sale por fetch
    expect(await contarPendientes()).toBe(0);
  });

  it("kill local: tras 5 fallos seguidos pausa la cola y no martilla el hub", async () => {
    const doFetch = vi.fn(async () => new Response("boom", { status: 500 }));
    await encolarActa(crearEntradadePrueba());
    for (let i = 0; i < FALLOS_KILL_LOCAL; i++) {
      await enviarPendientes(doFetch);
    }
    expect(estadoPuente().activo).toBe(false);
    const llamadas = doFetch.mock.calls.length;
    await enviarPendientes(doFetch);
    expect(doFetch.mock.calls.length).toBe(llamadas); // pausado: sin más llamadas
    expect(await contarPendientes()).toBe(1); // cola intacta
  });

  it("reintento: un fallo transitorio se re-intenta y el outbox se vacía al aceptarse", async () => {
    let falloPrimero = true;
    const doFetch = vi.fn(async () => {
      if (falloPrimero) {
        falloPrimero = false;
        return new Response("boom", { status: 500 });
      }
      return new Response(JSON.stringify({ ok: true, insertadas: 1 }), { status: 200 });
    });
    await encolarActa(crearEntradadePrueba());
    await enviarPendientes(doFetch); // 500 — el lote queda con intentos+1
    expect(await contarPendientes()).toBe(1);
    const segunda = await enviarPendientes(doFetch); // 200
    expect(segunda.enviadas).toBe(1);
    expect(await contarPendientes()).toBe(0);
  });

  it("borrado por lote elimina exactamente los items aceptados (lotes de a 2)", async () => {
    const doFetch = fetchOk();
    await encolarActa(crearEntradadePrueba("88_335_005_02", "001", 1));
    await encolarActa(crearEntradadePrueba("88_335_005_02", "001", 2));
    await encolarActa(crearEntradadePrueba("88_335_005_03", "002", 1));
    const { enviadas } = await enviarPendientes(doFetch);
    expect(enviadas).toBe(3);
    expect(doFetch).toHaveBeenCalledTimes(2); // 2 + 1 en dos POST (tope 2/lote)
    expect(await contarPendientes()).toBe(0);
  });

  it("hub local (LAN) envía SIN firma — contrato hub-local.mjs", async () => {
    const capturas: { url: string; init?: RequestInit }[] = [];
    const doFetch = fetchOk((url, init) => capturas.push({ url, init }));
    // Override a un origen LAN: el normalizador solo pasa https, pero un
    // origen https LAN (el hub-local real sirve https self-signed) es válido.
    window.localStorage.setItem("e14-puente-url", "https://192.168.1.50:8443");
    await encolarActa(crearEntradadePrueba());
    await enviarPendientes(doFetch);
    expect(capturas.length).toBe(1);
    expect(capturas[0].url).toBe("https://192.168.1.50:8443/v1/actas");
    const headers = capturas[0].init?.headers as Record<string, string>;
    expect(headers["x-e14-firma"]).toBeUndefined(); // LAN sin firma
    expect(headers["content-type"]).toBe("application/json");
  });

  it("sin clave de jornada NO envía a producción (falla cerrado, cola intacta)", async () => {
    fijarClaveJornada(null);
    const doFetch = fetchOk();
    await encolarActa(crearEntradadePrueba());
    const { enviadas, fallos } = await enviarPendientes(doFetch);
    expect(doFetch).not.toHaveBeenCalled();
    expect(enviadas).toBe(0);
    expect(fallos).toBeGreaterThanOrEqual(1);
    expect(estadoPuente().sinClaveJornada).toBe(true);
    expect(await contarPendientes()).toBe(1); // nada se pierde
  });

  it("410 → contratoObsoleto pausa la cola SIN marcar el acta como fallida (H-4b)", async () => {
    const doFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: "CONTRATO_OBSOLETO" }), { status: 410 }),
    );
    await encolarActa(crearEntradadePrueba());
    const { fallos } = await enviarPendientes(doFetch);
    expect(fallos).toBe(1);
    expect(estadoPuente().contratoObsoleto).toBe(true);
    expect(estadoPuente().activo).toBe(false);
    expect(await contarPendientes()).toBe(1); // el acta NO se marca fallida ni se borra
  });

  it("429 sostenido activa kill local pero NO borra la cola (transitorio)", async () => {
    const doFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: "DEMASIADAS_PETICIONES" }), {
        status: 429,
      }),
    );
    await encolarActa(crearEntradadePrueba());
    for (let i = 0; i < FALLOS_KILL_LOCAL; i++) await enviarPendientes(doFetch);
    expect(estadoPuente().activo).toBe(false);
    expect(estadoPuente().ultimoError).toBe("HTTP 429");
    expect(await contarPendientes()).toBe(1); // reanuda con SINCRONIZAR AHORA
  });
});

describe("puente/url-hub — normalizador (0.5/S3)", () => {
  it("http:// ajeno → null (las fotos de actas jamás por http externo)", () => {
    expect(normalizarHubUrl("http://atacante.ejemplo")).toBeNull();
  });
  it("http:// LOCAL (hub-local.mjs en LAN) → aceptado (doctrina 0.5/S3)", () => {
    expect(normalizarHubUrl("http://192.168.1.50:8081")).toBe("http://192.168.1.50:8081");
    expect(normalizarHubUrl("http://ep.local/reportes")).toBe("http://ep.local/reportes");
  });
  it("https:// → normalizado (base SIN barra final — los callers concatenan la ruta)", () => {
    expect(normalizarHubUrl("https://hub.ejemplo")).toBe("https://hub.ejemplo");
    expect(normalizarHubUrl("https://hub.ejemplo/")).toBe("https://hub.ejemplo");
  });
  it("string basura → null", () => {
    expect(normalizarHubUrl("no soy una url")).toBeNull();
    expect(normalizarHubUrl("")).toBeNull();
    expect(normalizarHubUrl(null)).toBeNull();
  });
  it("el override http:// no llega al hub en uso (cae al default)", () => {
    window.localStorage.setItem("e14-puente-url", "http://atacante.ejemplo");
    expect(hubEnUso()).toBe(HUB);
  });
});
