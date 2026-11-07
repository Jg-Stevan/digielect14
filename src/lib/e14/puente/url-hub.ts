/**
 * KIT e14-puente-supervision-v2 (Ola 0, bloque 0.5 — cierra S3) —
 * NORMALIZADOR ÚNICO de overrides de URL del hub.
 *
 * Problema cerrado: `envio.ts` aceptaba cualquier override de
 * `localStorage["e14-puente-url"]` que cumpliera `/^https?:\/\//i` —
 * permitía `http://` con fotos de actas en el body (fuga en claro).
 * Ahora: SOLO `https:` pasa; `http://`, string basura, string vacío → null
 * (el caller cae al hub por defecto y registra el intento).
 *
 * Misma doctrina que el helper único del gate (Ola 7): un solo criterio,
 * un solo módulo — `flags.ts` y `obs/politica.ts` re-implementan la MISMA
 * regla para `endpointReportes` (duplicado A PROPÓSITO: los kits son
 * autónomos entre sí — ver comentario gemelo allí).
 */

/** URL del hub normalizada o null (jamás `http:` — fotos de actas por https). */
// Host local: localhost, IPs privadas y `.local` (mDNS RFC 6762 — jamás
// enrutable en Internet público). Es el caso del `hub-local.mjs` del hermano,
// que también sirve http en la LAN como fallback del cert self-signed.
const esHostLocal = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname.endsWith(".local") || // mDNS RFC 6762 — no enrutable en Internet público
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);

/** URL del hub normalizada o null. REGLA (0.5/S3): `https:` siempre pasa;
 *  `http:` SOLO si el host es local (hub-local en LAN). Un `http://` ajeno
 *  (exfiltración de actas en claro) o basura → null. */
export function normalizarHubUrl(cruda: string | null): string | null {
  if (!cruda) return null;
  let url: URL;
  try {
    url = new URL(cruda);
  } catch {
    return null;
  }
  if (url.protocol === "http:") {
    if (!esHostLocal(url.hostname)) return null; // fotos de actas jamás por http ajeno
  } else if (url.protocol !== "https:") {
    return null;
  }
  // Base SIN barra final: los callers concatenan `${hub}${RUTA_ACTAS}`.
  return url.toString().replace(/\/+$/, "");
}

/** ¿El origen es una red local (hub-local.mjs del mismo equipo)? Duplicado de
 *  `envio.esOrigenLocal` para uso sin arrastrar el transporte completo. */
export function esOrigenLocalDe(
  origen: string,
  actual: string = typeof window === "undefined" ? "" : window.location.origin,
): boolean {
  try {
    if (!origen) return false;
    const host = new URL(origen, actual || undefined).hostname;
    return (
      host === "localhost" ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}
