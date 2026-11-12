/**
 * KIT e14-remediacion-movil-v1 (D3 — #13 · P2): LCP y CLS OBSERVABLES.
 *
 * Problema (#13): el LCP de 14,7 s medido en campo llegó SIN elemento
 * identificado — el observer era RETROSPECTIVO (se instalaba tarde y las
 * entradas ya no existían → `element: null`). Este kit instala el observer
 * ANTES de la carga (script inline en <head> — lo inyecta layout.tsx) y
 * recupera las entradas previas con `buffered: true`. CLS ya está mitigado
 * por diseño (shell h-dvh sin saltos) — ahora queda MEDIDO para
 * verificarlo en campo.
 *
 * Dos piezas (misma lógica, dos lenguajes):
 *  · SCRIPT_LCP_CLS — IIFE JS PLANO (sin imports) para <head>: corre antes
 *    de hidratar, registra los DOS PerformanceObserver
 *    (largest-contentful-paint + layout-shift, buffered:true), expone
 *    window.__e14LcpCls y despacha "e14-lcp-cls" en cada publicación.
 *  · instalarObserverLcpCls() — auto-instalable, idempotente, lado TS
 *    (bootstrap del shell):
 *     · si el script de <head> corrió (marcador __e14LcpClsScript): se
 *       SUSCRIBE a su publicación — UN solo par de observers por carga.
 *     · si NO corrió (CSP sin 'unsafe-inline', inyección perdida): instala
 *       sus PROPIOS observers (buffered:true) y publica igual.
 *
 * Publicación (en cada una — máx 2 por carga): al `load` (o inmediato si
 * ya cargó) y al pasar a `hidden` SOLO si cambió el candidato (el LCP
 * «final» se cierra en hidden — regla de cierre de web-vitals; CLS sigue
 * creciendo con el uso). Cada publicación = UNA línea de logger
 * (`[e14] lcp-cls …`) + evento obs tipo `perf` con `codigo: "obs:lcp-cls"`.
 *
 * NOTA de camino (§13): NO existe tipo "entorno" en TipoEvento (unión
 * cerrada del paquete — intocable en este alcance). El patrón EXACTO de los
 * emisores de entorno del repo es perf+codigo (src/lib/e14/ocr/rapidocr.ts
 * → "ocr:multihilo-entorno": tipo "perf" + datos{codigo,…} con sesion/
 * dispositivo/appVersion VACÍOS — appendEvento los sella). El evento perf
 * NO viaja por red (transporte.ts TIPOS_LOTE) — llega al mantenedor por export
 * manual / reporte de sesión, igual que el resto del perf.
 *
 * PRIVACIDAD: solo números y nombres de elemento (tag/#id/clases) — cero
 * contenido de actas (qa-obs-privacidad manda). REGLA DE ORO §2.4: TODO
 * try/catch, jamás lanza, silencioso si no hay PerformanceObserver.
 */
import { logger } from "@jg-stevan/scanner-core/dominio/logger";
import { appendEvento } from "@jg-stevan/scanner-core/obs-base/buffer";

/** Resultado publicado (window.__e14LcpCls — y detail del evento interno). */
export interface ResultadoLcpCls {
  /** Último candidato LCP (el mayor visto). null = ninguna entrada
   *  (sin soporte / sin render) — honesto, jamás inventado. */
  lcp: { valor: number; id: string | null; selector: string | null } | null;
  /** CLS acumulado: SOLO shifts sin hadRecentInput (la interacción del
   *  usuario no penaliza) — total redondeable y NÚMERO de shifts. */
  cls: { total: number; shifts: number };
}

/** Estado mutable del agregador (PURO — lo tocan solo los acumuladores). */
export interface EstadoLcpCls {
  lcpValor: number | null;
  lcpId: string | null;
  lcpSelector: string | null;
  clsTotal: number;
  clsShifts: number;
}

/** Entradas estrechadas por defecto (el callback entrega PerformanceEntry —
 *  se estrecha defensivo para no depender de la versión de lib.dom). */
interface EntradaLcp {
  startTime?: number;
  element?: Element | null;
}
interface EntradaShift {
  value?: number;
  hadRecentInput?: boolean;
}

/** Global tipado (declara los dos marcadores del kit — cero `any`). */
declare global {
  interface Window {
    __e14LcpCls?: ResultadoLcpCls;
    __e14LcpClsScript?: boolean;
  }
}

/** Selector BARATO del elemento LCP (tag + #id + 2 primeras clases),
 *  truncado a 80. Sin frameworks de query — el LCP solo necesita SER
 *  identificable. SVG: className NO es string → cae a getAttribute.
 *  Jamás lanza; null si no hay elemento (el bug #13 queda MEDIDO). */
export function selectorLcp(el: Element | null | undefined): string | null {
  try {
    if (!el || typeof el.tagName !== "string") return null;
    let s = el.tagName.toLowerCase();
    const id = typeof (el as { id?: unknown }).id === "string" && (el as { id: string }).id !== "" ? (el as { id: string }).id : null;
    if (id) s += `#${id}`;
    const clases =
      typeof el.className === "string"
        ? el.className
        : (typeof el.getAttribute === "function" ? el.getAttribute("class") : null) ?? "";
    const partes = clases.trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (partes.length) s += `.${partes.join(".")}`;
    return s.slice(0, 80) || null;
  } catch {
    return null;
  }
}

/** Estado cero (PURO). */
export function estadoLcpClsInicial(): EstadoLcpCls {
  return { lcpValor: null, lcpId: null, lcpSelector: null, clsTotal: 0, clsShifts: 0 };
}

/** LCP: la ÚLTIMA entrada gana (el navegador emite el candidato VIGENTE en
 *  cada actualización — el último es el mayor). `id: ""` se normaliza a
 *  null (un id vacío no identifica nada). PURO sobre el estado. */
export function acumularLcp(estado: EstadoLcpCls, entradas: readonly PerformanceEntry[]): void {
  for (const entrada of entradas) {
    try {
      const e = entrada as unknown as EntradaLcp;
      if (typeof e?.startTime !== "number") continue;
      estado.lcpValor = e.startTime;
      const el = e.element ?? null;
      const id = el && typeof (el as { id?: unknown }).id === "string" && (el as { id: string }).id !== "" ? (el as { id: string }).id : null;
      estado.lcpId = id;
      estado.lcpSelector = selectorLcp(el);
    } catch {
      /* silencioso — la medición jamás lanza */
    }
  }
}

/** CLS: suma `value` de shifts SIN hadRecentInput + cuenta (PURO). */
export function acumularCls(estado: EstadoLcpCls, entradas: readonly PerformanceEntry[]): void {
  for (const entrada of entradas) {
    try {
      const e = entrada as unknown as EntradaShift;
      if (typeof e?.value !== "number") continue;
      if (e.hadRecentInput) continue;
      estado.clsTotal += e.value;
      estado.clsShifts += 1;
    } catch {
      /* silencioso — la medición jamás lanza */
    }
  }
}

/** Resultado congelado del estado (PURO — la forma EXACTA del global). */
export function resultadoDe(estado: EstadoLcpCls): ResultadoLcpCls {
  return {
    lcp:
      estado.lcpValor === null
        ? null
        : { valor: estado.lcpValor, id: estado.lcpId, selector: estado.lcpSelector },
    cls: { total: estado.clsTotal, shifts: estado.clsShifts },
  };
}

/** Publicación lado TS: UNA línea de logger + evento obs perf con codigo
 *  "obs:lcp-cls" (patrón rapidocr "ocr:multihilo-entorno" — VERBATIM la
 *  forma del appendEvento: sesion/dispositivo/appVersion vacíos, los sella
 *  el buffer). Async pero void al caller — jamás lanza (§2.4). */
async function procesarPublicacion(r: ResultadoLcpCls, fase: string): Promise<void> {
  try {
    const lcpTxt = r.lcp ? `${Math.round(r.lcp.valor)} ms` : "sin-candidato";
    const elTxt = r.lcp ? (r.lcp.id ? `#${r.lcp.id}` : (r.lcp.selector ?? "?")) : "—";
    logger.info(
      `[e14] lcp-cls LCP=${lcpTxt} elemento=${elTxt} | CLS=${r.cls.total.toFixed(4)} (${r.cls.shifts} shifts) [${fase}]`,
    );
    await appendEvento({
      tipo: "perf",
      ts: Date.now(),
      sesion: "",
      dispositivo: "",
      appVersion: "",
      datos: {
        codigo: "obs:lcp-cls",
        fase, // "inmediato" | "load" | "final"
        lcpMs: r.lcp ? Math.round(r.lcp.valor) : null,
        lcpId: r.lcp?.id ?? null,
        lcpSelector: r.lcp?.selector ?? null,
        clsTotal: r.cls.total,
        clsShifts: r.cls.shifts,
      },
    });
  } catch {
    /* la publicación jamás lanza (§2.4) */
  }
}

/** Camino B — observers PROPIOS (el script de <head> NO corrió). Misma
 *  lógica del script: buffered:true, publica al load/inmediato y al pasar
 *  a hidden SOLO si cambió el candidato. TODO dentro de try. */
function instalarObservadoresPropios(): void {
  try {
    if (typeof PerformanceObserver === "undefined") return; // silencioso
    const estado = estadoLcpClsInicial();
    let publicado: { lcp: number | null; cls: number } | null = null;

    const publicarAhora = (fase: string): void => {
      try {
        const r = resultadoDe(estado);
        window.__e14LcpCls = r;
        publicado = { lcp: estado.lcpValor, cls: estado.clsTotal };
        void procesarPublicacion(r, fase);
      } catch {
        /* silencioso */
      }
    };

    try {
      new PerformanceObserver((lista) => {
        try {
          acumularLcp(estado, lista.getEntries());
        } catch {
          /* silencioso */
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      /* sin soporte LCP — el CLS sigue */
    }

    try {
      new PerformanceObserver((lista) => {
        try {
          acumularCls(estado, lista.getEntries());
        } catch {
          /* silencioso */
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      /* sin soporte CLS — el LCP sigue */
    }

    if (document.readyState === "complete") publicarAhora("inmediato");
    else window.addEventListener("load", () => publicarAhora("load"), { once: true });

    // LCP/CLS «final»: al pasar a hidden re-publica SOLO si cambió algo.
    document.addEventListener("visibilitychange", () => {
      try {
        if (document.visibilityState !== "hidden") return;
        if (publicado && publicado.lcp === estado.lcpValor && publicado.cls === estado.clsTotal) return;
        publicarAhora("final");
      } catch {
        /* silencioso */
      }
    });
  } catch {
    /* silencioso */
  }
}

let instalado = false;

/** Auto-instalable, IDEMPOTENTE, SSR-safe. Camino A (normal): el script de
 *  <head> corrió — suscribirse a su publicación y NO duplicar observers.
 *  Camino B: script ausente — observers propios. Jamás lanza. */
export function instalarObserverLcpCls(): void {
  try {
    if (instalado) return;
    instalado = true;
    if (typeof window === "undefined") return; // SSR/tests node → nada

    if (window.__e14LcpClsScript) {
      // Camino A — UN solo par de observers por carga (los del script).
      const alPublicar = (ev: Event): void => {
        try {
          const d = (ev as CustomEvent<{ resultado?: ResultadoLcpCls; fase?: string }>).detail;
          if (!d || !d.resultado || typeof d.resultado !== "object") return;
          void procesarPublicacion(d.resultado, typeof d.fase === "string" ? d.fase : "load");
        } catch {
          /* silencioso */
        }
      };
      window.addEventListener("e14-lcp-cls", alPublicar);
      // Hidratación tardía (móvil lento): el load ya pasó — consumir el
      // global publicado AHORA (el «final» de hidden seguirá llegando).
      if (window.__e14LcpCls) void procesarPublicacion(window.__e14LcpCls, "load");
      return;
    }

    instalarObservadoresPropios(); // Camino B — el script no corrió
  } catch {
    /* silencioso — el kit jamás rompe el bootstrap (§2.4) */
  }
}

/** IIFE JS PLANO (sin imports — corre en <head> ANTES de hidratar). Mismo
 *  observer del módulo: LCP (último candidato) + CLS (sin hadRecentInput),
 *  buffered:true, publica al load (o inmediato) + hidden si cambió, expone
 *  window.__e14LcpCls y despacha "e14-lcp-cls" con {resultado, fase}.
 *  Sin template literals ni ${} — string plano seguro para dangerouslySetInnerHTML. */
export const SCRIPT_LCP_CLS = `
(function () {
  try {
    var w = window;
    if (w.__e14LcpClsScript) return;
    w.__e14LcpClsScript = true;
    var estado = { lcp: null, id: null, sel: null, cls: 0, shifts: 0 }, publicado = null;
    function selDe(el) {
      try {
        if (!el || typeof el.tagName !== "string") return null;
        var s = el.tagName.toLowerCase();
        if (el.id) s += "#" + el.id;
        var clases = typeof el.className === "string" ? el.className : (el.getAttribute ? el.getAttribute("class") : "");
        var partes = String(clases || "").trim().split(/\\s+/).filter(Boolean).slice(0, 2);
        if (partes.length) s += "." + partes.join(".");
        return s.slice(0, 80) || null;
      } catch (_e) { return null; }
    }
    try {
      new PerformanceObserver(function (l) {
        try {
          var es = l.getEntries();
          for (var i = 0; i < es.length; i++) {
            estado.lcp = es[i].startTime;
            estado.id = es[i].element && es[i].element.id ? es[i].element.id : null;
            estado.sel = selDe(es[i].element);
          }
        } catch (_e) {}
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch (_e) {}
    try {
      new PerformanceObserver(function (l) {
        try {
          var es = l.getEntries();
          for (var i = 0; i < es.length; i++) {
            if (!es[i].hadRecentInput) { estado.cls += es[i].value; estado.shifts++; }
          }
        } catch (_e) {}
      }).observe({ type: "layout-shift", buffered: true });
    } catch (_e) {}
    function publicar(fase) {
      try {
        var r = {
          lcp: estado.lcp === null ? null : { valor: estado.lcp, id: estado.id, selector: estado.sel },
          cls: { total: estado.cls, shifts: estado.shifts }
        };
        w.__e14LcpCls = r;
        publicado = { lcp: estado.lcp, cls: estado.cls };
        try {
          var elTxt = r.lcp ? (r.lcp.id ? "#" + r.lcp.id : (r.lcp.selector || "?")) : "—";
          console.info("[e14] lcp-cls LCP=" + (r.lcp ? Math.round(r.lcp.valor) + " ms" : "sin-candidato") + " elemento=" + elTxt + " | CLS=" + r.cls.total.toFixed(4) + " (" + r.cls.shifts + " shifts) [" + fase + "]");
        } catch (_e) {}
        try { w.dispatchEvent(new CustomEvent("e14-lcp-cls", { detail: { resultado: r, fase: fase } })); } catch (_e) {}
      } catch (_e) {}
    }
    if (document.readyState === "complete") publicar("inmediato");
    else window.addEventListener("load", function () { publicar("load"); }, { once: true });
    document.addEventListener("visibilitychange", function () {
      try {
        if (document.visibilityState !== "hidden") return;
        if (publicado && publicado.lcp === estado.lcp && publicado.cls === estado.cls) return;
        publicar("final");
      } catch (_e) {}
    });
  } catch (_e) { /* silencioso total — jamás rompe el arranque */ }
})();
`;
