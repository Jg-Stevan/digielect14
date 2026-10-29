/**
 * KIT e14-puente-supervision-v1 (§5) — TRANSPORTE hacia el hub del panel de
 * supervisión (`supervision-e14` desplegado en Cloudflare Workers).
 *
 *   POST {hub}/actas  ← { dispositivo, actas: EntradaPuente[] }  (tope 10/lote)
 *     → { ok, recibidas, publicadas, insertadas, rechazadas: [{indice,motivo}] }
 *
 * · LOTES DE A 2 entradas por POST (el tope del hub es 10 — 2 mantiene cada
 *   request liviano en gama baja: cada entrada viaja con su foto dataURL).
 * · Timeout de 8 s con AbortController (gama baja / red de mesa).
 * · Éxito (HTTP ok) → el lote se BORRA de la cola (aunque el hub reporte
 *   rechazadas individuales: reintentar un sobre inválido sería veneno —
 *   la corrección llega con la próxima captura). Fallo → intentos++ en la
 *   cola y CORTE del ciclo (backoff implícito: el próximo envío lo repite).
 * · KILL LOCAL (FALLOS_KILL_LOCAL = 5): tras 5 fallos seguidos estado.activo
 *   = false — la cola queda INTACTA y solo `sincronizarAhora()` manual la
 *   reactiva (mismo criterio del kill del transporte obs, tope distinto por
 *   el volumen de fotos).
 * · Override de URL: localStorage["e14-puente-url"] (leído en CADA envío —
 *   cambiar el hub no exige recargar; default HUB_DEFAULT).
 * · fetch INYECTABLE (parámetro opcional — patrón del ledger-remoto
 *   histórico de la cola masiva) para pruebas sin red. Sin tests en esta
 *   sesión por política.
 *
 * REGLA DE ORO §2.4: TODO try/catch silencioso — el puente jamás rompe la
 * app; cero consola nativa (logger del repo).
 */
import { logger } from "../../logger";
import { idDispositivo } from "../obs/identidad";
import { borrarPendiente, contarPendientes, leerPendientes, marcarIntentos } from "./cola";
import { recuperarActasPuente } from "./recuperar";
import type { EntradaPuente, EstadoPuente } from "./tipos";

const HUB_DEFAULT = "https://e14-puente.julistevan02.workers.dev";
const CLAVE_OVERRIDE = "e14-puente-url";
/** Entradas por POST (tope del hub: 10 — mantenemos 2 por payload liviano). */
const TOPE_LOTE = 2;
const TIMEOUT_MS = 8000;
/** Kill local: 5 fallos seguidos → auto-detención (cola intacta). */
export const FALLOS_KILL_LOCAL = 5;

/** fetch inyectable (pruebas — patrón ledger-remoto histórico). */
type FetchComo = (input: string, init?: RequestInit) => Promise<Response>;

// ─── Estado del módulo (singleton — la UI lo lee con estadoPuente()) ───────

// El singleton se MUTA por propiedad (nunca se re-asigna — como el «estado»
// del transporte obs) → const para el lint del repo.
const estado: EstadoPuente = {
  activo: true,
  pendientes: 0,
  enviadasOk: 0,
  fallosSeguidos: 0,
  ultimoError: null,
  ultimaSyncTs: null,
};

/** Un envío a la vez (debounce del auto-push y del botón — sin solaparse). */
let enviandoEnCurso = false;

/** Estado visible (COPIA — los consumidores nunca mutan el interno). */
export function estadoPuente(): EstadoPuente {
  return { ...estado };
}

/** URL del hub: override de localStorage leído en cada envío (http(s) sólo —
 *  una clave corrupta cae al default; localStorage bloqueado → default). */
function urlDelHub(): string {
  try {
    if (typeof window !== "undefined") {
      const override = window.localStorage.getItem(CLAVE_OVERRIDE);
      if (override && /^https?:\/\//i.test(override)) return override;
    }
  } catch {
    /* privado/iOS/SSR → default */
  }
  return HUB_DEFAULT;
}

// ─── Envío de un lote ───────────────────────────────────────────────────────

interface ResultadoLote {
  ok: boolean;
  motivo: string | null;
}

async function enviarLote(
  entradas: EntradaPuente[],
  url: string,
  doFetch: FetchComo,
): Promise<ResultadoLote> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const res = await doFetch(`${url}/actas`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dispositivo: idDispositivo(), actas: entradas }),
      signal: control.signal,
      keepalive: true,
    });
    if (!res.ok) return { ok: false, motivo: `HTTP ${res.status}` };
    return { ok: true, motivo: null };
  } catch (e) {
    const motivo =
      e instanceof DOMException && e.name === "AbortError"
        ? `timeout ${TIMEOUT_MS / 1000} s`
        : e instanceof Error
          ? e.message
          : "fallo de red";
    return { ok: false, motivo };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Ciclo de envío (FIFO · lotes de a 2 · corte al primer fallo) ──────────

/**
 * Drenar la cola hacia el hub. No-op si ya hay un envío en curso (debounce)
 * o si el puente está en kill local (activo:false — solo sincronizarAhora()
 * reactiva). Nunca lanza.
 */
export async function enviarPendientes(
  fetchImpl?: FetchComo,
): Promise<{ enviadas: number; fallos: number }> {
  if (enviandoEnCurso || !estado.activo) return { enviadas: 0, fallos: 0 };
  enviandoEnCurso = true;
  let enviadas = 0;
  let fallos = 0;
  try {
    const url = urlDelHub();
    const doFetch: FetchComo =
      fetchImpl ?? ((input, init) => fetch(input, init));
    const pendientes = await leerPendientes();
    for (let i = 0; i < pendientes.length; i += TOPE_LOTE) {
      const lote = pendientes.slice(i, i + TOPE_LOTE);
      const hashes = lote.map((r) => r.hash);
      const entradas = lote.map((r) => r.entrada);
      const resultado = await enviarLote(entradas, url, doFetch);
      if (resultado.ok) {
        // Éxito → el lote sale de la cola (borrado fila a fila — el put
        // idempotente de encolarActa ya evita duplicados en re-encolado).
        for (const hash of hashes) await borrarPendiente(hash);
        enviadas += lote.length;
        estado.enviadasOk += lote.length;
        estado.fallosSeguidos = 0;
        estado.ultimoError = null;
        continue;
      }
      // Fallo → cargo de intentos persistido + CORTE (backoff implícito:
      // el siguiente envío repite desde el lote caído).
      for (const fila of lote) await marcarIntentos(fila.hash, fila.intentos + 1);
      fallos += 1;
      estado.fallosSeguidos += 1;
      estado.ultimoError = resultado.motivo;
      break;
    }
    estado.ultimaSyncTs = Date.now();
    estado.pendientes = await contarPendientes();
    if (!estado.activo) {
      // Kill local alcanzado en un ciclo anterior — respetarlo (cola intacta).
      return { enviadas, fallos };
    }
    if (estado.fallosSeguidos >= FALLOS_KILL_LOCAL) {
      estado.activo = false; // kill local — sincronizarAhora() reactiva
      try {
        logger.warn(
          `[e14] puente: autodetención tras ${FALLOS_KILL_LOCAL} fallos seguidos (cola intacta, ${estado.pendientes} pendientes) — reactivar con SINCRONIZAR AHORA`,
        );
      } catch {
        /* silencioso */
      }
    }
  } catch {
    /* silencioso — el envío jamás rompe al caller */
  } finally {
    enviandoEnCurso = false;
  }
  return { enviadas, fallos };
}

// ─── Sincronización manual (botón SINCRONIZAR AHORA) ───────────────────────

export interface ResumenSincronizacion {
  recuperadas: number;
  enviadas: number;
  fallos: number;
  detalle: string;
}

/**
 * Reactivar el puente (limpia el kill local y el contador de fallos),
 * recuperar actas históricas, drenar la cola y devolver un resumen legible
 * para el feedback inline de la tarjeta.
 */
export async function sincronizarAhora(
  fetchImpl?: FetchComo,
): Promise<ResumenSincronizacion> {
  let recuperadas = 0;
  let enviadas = 0;
  let fallos = 0;
  let detalle: string;
  try {
    estado.activo = true; // reactivación manual — presupuesto fresco
    estado.fallosSeguidos = 0;
    estado.ultimoError = null;
    const recuento = await recuperarActasPuente();
    const envio = await enviarPendientes(fetchImpl);
    recuperadas = recuento.recuperadas;
    enviadas = envio.enviadas;
    fallos = envio.fallos;
    const pendientes = await contarPendientes();
    estado.pendientes = pendientes;
    detalle = `${recuperadas} listas · ${enviadas} enviadas · ${pendientes} pendientes`;
    if (!estado.activo) {
      detalle = `${detalle} — puente detenido por fallos (${estado.ultimoError ?? "desconocido"})`;
    }
  } catch {
    detalle = "Error: no se pudo sincronizar";
  }
  return { recuperadas, enviadas, fallos, detalle };
}
