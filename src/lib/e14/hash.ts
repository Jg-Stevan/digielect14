/**
 * C-08 — SHA-256 REAL de la evidencia (doctrina e14-sin-relleno): helper
 * PURO compartido por el historial del acta (store.ts) y el sobre del puente
 * (puente/mapear.ts). Vive FUERA del kit puente a propósito: lo consume la
 * capa de dominio y el kit conserva su autonomía de imports (§2.4 — el
 * puente no arrastra dependencias del dominio).
 *
 * Web Crypto puro (cero dependencias nuevas). `crypto.subtle` exige contexto
 * seguro (https/localhost) — sin él las funciones devuelven null y el caller
 * deja el campo AUSENTE: jamás un hash de relleno.
 */

/** SHA-256 → hex minúsculas (64 chars). Lanza si crypto.subtle no existe. */
async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const sutil = globalThis.crypto?.subtle;
  if (!sutil) throw new Error("SIN_CRYPTO_SUBTLE");
  const digest = await sutil.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * SHA-256 (hex 64) de los BYTES de un dataURL — la evidencia EXACTA que
 * viaja: el payload base64 se DECODIFICA (los bytes reales de la foto, sin
 * la inflación del ~33 % del envoltorio). Un dataURL no parseable cae al
 * hash UTF-8 del string completo (determinista — la identidad sigue siendo
 * estable). null = sin crypto.subtle (contexto no seguro) — el caller omite
 * el campo en vez de inventar.
 */
export async function sha256HexDeDataUrl(dataUrl: string): Promise<string | null> {
  try {
    // Sin flag `s` (target < es2018): el base64 de canvas/FileReader jamás
    // trae saltos de línea (misma convención de jornada.dataUrlABlob).
    const m = /^data:[^;,]*;base64,(.*)$/.exec(dataUrl);
    if (m) {
      try {
        const bin = atob(m[1]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return await sha256Hex(bytes);
      } catch {
        /* base64 podrido → cae al hash del string completo (determinista) */
      }
    }
    return await sha256Hex(new TextEncoder().encode(dataUrl));
  } catch {
    return null; // sin crypto.subtle — campo ausente honesto
  }
}
