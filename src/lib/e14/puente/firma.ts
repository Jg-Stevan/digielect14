/**
 * KIT e14-puente-supervision-v2 (Ola 0, bloque 0.1 — cierra S2, con la
 * corrección S-1 del documento de revisión) — FIRMA HMAC del lote.
 *
 * REGLA DE ORO S-1: la firma va sobre el STRING EXACTO que sale por la red.
 * El caller serializa UNA vez (`JSON.stringify(lote)`), firma ese string y
 * lo envía como body — jamás se re-serializa un objeto (JSON.parse →
 * stringify NO garantiza byte-igualdad: floats `1.50`, escapes unicode,
 * orden de claves numéricas — fallos intermitentes imposibles de depurar
 * en jornada).
 *
 * CLAVE DE JORNADA (0.1.1): vive en `localStorage["e14-clave-jornada"]`,
 * provisionada FUERA del repo (config local del operador, QR presencial o
 * endpoint propio). El bundle es público: si la clave viaja en `src/`,
 * volvimos al punto de partida. Sin clave → `headersDeLote` devuelve null y
 * el envío se pausa con motivo visible (nunca enviar sin firma a producción).
 *
 * Web Crypto puro: sin dependencias; `crypto.subtle` requiere contexto
 * seguro (la app ya exige https / localhost para la cámara).
 */

const CLAVE_OVERRIDE = "e14-clave-jornada";

export async function hmacBase64(clave: string, mensaje: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(clave),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = await crypto.subtle.sign("HMAC", k, enc.encode(mensaje));
  return btoa(String.fromCharCode(...new Uint8Array(firma)));
}

/** Clave de jornada provisionada (null = sin provisionar). */
export function claveJornada(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const clave = window.localStorage.getItem(CLAVE_OVERRIDE);
    return clave && clave.trim() ? clave.trim() : null;
  } catch {
    return null; // modo privado/iOS/SSR → sin clave
  }
}

/** Provisionar/rotar la clave (pantalla de configuración del puente). */
export function fijarClaveJornada(clave: string | null): void {
  try {
    if (typeof window === "undefined") return;
    if (clave && clave.trim()) window.localStorage.setItem(CLAVE_OVERRIDE, clave.trim());
    else window.localStorage.removeItem(CLAVE_OVERRIDE);
  } catch {
    /* silencioso — regla de oro del kit */
  }
}

/** Headers de autenticación para el lote YA SERIALIZADO. null = no hay clave
 *  provisionada (el caller NO debe enviar a producción sin firma). */
export async function headersDeLote(
  cuerpoRaw: string,
  claveJornadaValor: string,
): Promise<Record<string, string>> {
  const ts = Date.now().toString();
  return {
    "content-type": "application/json",
    "x-e14-ts": ts,
    "x-e14-firma": await hmacBase64(claveJornadaValor, `${ts}.${cuerpoRaw}`),
  };
}
