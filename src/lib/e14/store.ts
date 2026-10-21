/**
 * Estado global (zustand): vista activa, acta en revisión, mesas, progreso,
 * historial y conexión. Toda la data nace del
 * bridge (D1) — las vistas nunca tocan el bridge directamente.
 * STITCH REDESIGN (SPEC-e14-redesign-stitch §4/D2): el sistema de
 * notificaciones flotantes queda ELIMINADO (estado + acción + call-sites).
 * El feedback vive en la UI persistente de estado (píldoras, nube, bloque
 * ENVIADO, franja del visor, feedback en botón).
 */
import { create } from "zustand";
import { getBridge } from "./get-bridge";
import { rotateProcessedDataUrl } from "./image-utils";
import { ocrTextIsValid } from "@jg-stevan/scanner-core/ocr";
import type { PageFilter } from "@jg-stevan/scanner-core/types";
import type { PaginaObjetivo } from "./bridge";
import type { Acta, FuenteCaptura, HistorialRow, Mesa, ProgresoAnalisis, TipoPagina } from "./types";
// KIT e14-carga-masiva-v1 (T3.4): solo la capa de DATOS de la cola (sin
// dependencia del mini-store — cero ciclos de import).
import { leerRegistro } from "./masiva/cola";
import type { Quad } from "@jg-stevan/scanner-core/types";
import {
  claveDeMesa,
  claveDePuesto,
  tipoPaginaDe,
  tituloYUbicacionDe,
  type ClasificacionE14,
} from "./clasificador";
import { cargarDivipol, mesasDePuesto } from "./divipol";
// KIT L6: persistencia de la jornada (IDB vanilla — mismo patrón de la cola
// masiva) + derivación del guion real (fix M10).
import {
  cargarJornada,
  guardarActaEnRevision,
  guardarJornada,
  leerActaEnRevision,
  mesasRealesDe,
  TOPE_HISTORIAL,
} from "./jornada";
import {
  COLA_OFFLINE_INICIAL,
  SOLICITUDES_RESCANEO_INICIAL,
  guionDePuesto,
  historialInicial,
  mesasIniciales,
  progresoInicial,
} from "./seed";

// KIT e14-carga-masiva-v1 (T3.1): vista MASIVA — módulo separado (orquestación
// en src/lib/e14/masiva/, D-masiva-módulo-separado); aquí SOLO la unión.
export type Vista = "escanear" | "analizando" | "revision" | "actas" | "resumen" | "masiva";

// KIT e14-recorte-manual-v1 (T2): copy del aviso cuando el pipeline del
// RECORTE falla (error duro). Mismo tono corto/sin guía del repo (D1/gate-v2);
// se pinta como píldora en REVISIÓN — no hay toasts (redesign-stitch D2).
const MSG_RECORTE_FALLIDO = "NO SE PUDO RECORTAR — INTENTA DE NUEVO";

/** KIT e14-optimizacion-v1 (T5): ids de acta ya contados en motivosNoEnvio —
 *  el recorte re-evaluado (analisisCompletado corre 2× con el mismo acta)
 *  no duplica. En memoria de sesión: se resetea al recargar, igual que el
 *  historial (kit §3-T5 — PROHIBIDO persistir). */
const contadosNoEnvio = new Set<string>();

/** FIX (auditoría 2-a #10): contador de ids de historial — dos filas creadas
 *  en el MISMO milisegundo (envío auto + escalación, ráfaga MASIVA)
 *  colisionaban como React keys. Mismo patrón del contador de construirActa. */
let contadorHistorial = 0;
function idHistorial(): string {
  return `h-${Date.now()}-${contadorHistorial++}`;
}

/** §D3 (SPEC-e14-simulacion-scores): banda de un chip de calidad del mock.
 *  Los ids SON los del mock (ScanView §5) y el mapeo dueño es fijo:
 *  la completa = óptima · la cortada = intermedio · la borrosa = bajo. */
export type BandaSim = "optima" | "medio" | "baja";

/** §D3: score INYECTADO por banda (el del bracket del chip). El desenlace
 *  real lo decide el gate (§D4). §D8.5 (SPEC-e14-score-ocr Rev. 3): la b/n
 *  del dueño as-is = medio 7.0 · la borrosa original as-is = bajo 4.3 ·
 *  8.2 + AUTO → piso 10.0 (ÓPTIMA enviada) · 7.0 con AUTO → ADVERTENCIA
 *  (el chip manda — el piso solo re-aplica con score ≥ 8) · 4.3 →
 *  RECHAZADA. Los mismos números viven pintados en NIVELES_CALIDAD. */
export const SCORE_SIMULADO: Record<BandaSim, number> = {
  optima: 8.2,
  medio: 7.0,
  baja: 4.3,
};

/** §D3: opciones de simulación por chips — SOLO store↔dispararEscaneo; el
 *  bridge las recibe como `simular`/`scoreSimulado` (OpcionesEscaneo). */
export interface OpcionesSimEscaneo {
  simular: boolean;
  scoreSimulado: number;
}

interface E14Store {
  vista: Vista;
  online: boolean;
  actaActual: Acta | null;
  /** Página de mesa apuntada por el escaneo en curso (D7). */
  paginaObjetivo: PaginaObjetivo | null;
  /** Fuente de captura del próximo escaneo (D35: SIMULACIÓN = pipeline real). */
  fuente: FuenteCaptura;
  /** Archivo elegido para la fuente ARCHIVO (L2 lo consume). */
  archivoPendiente: File | null;
  /** Video vivo de la fuente CÁMARA (L3: grab del frame si el disparo no trae foto). */
  framePendiente: HTMLVideoElement | null;
  /** Último evento de progreso del pipeline (alimenta ANALIZANDO, §7.2). */
  progresoAnalisis: ProgresoAnalisis | null;
  /** true cuando el pipeline resolvió (piso escénico D16 de ANALIZANDO). */
  analisisResuelto: boolean;
  /** L5 §7.5: true mientras el bridge re-corre el pipeline del RECORTE. */
  recortando: boolean;
  /** KIT e14-recorte-manual-v1 (T2): aviso visible cuando el pipeline del
   *  recorte FALLA (error duro — el catch silencioso se acabó). El catch
   *  sólo avisa: no cambia el gate ni el score. `null` = sin error; se
   *  limpia al iniciar un recorte y a los ~6 s (píldora en REVISIÓN). */
  errorRecorte: string | null;
  /** F2 §F2.2: true mientras el bridge re-procesa la foto con un filtro. */
  revelando: boolean;
  actasSesion: number;
  mesas: Mesa[];
  /** Fase B (§6): archivado «dónde va» — clasificaciones guardadas por
   *  clave de mesa real; la vista ACTAS las añade al seed (modo demo). */
  archivadas: Record<string, ActaArchivada>;
  /** Regla del dueño «solo un puesto debe de aparecer»: el puesto de la
   *  ÚLTIMA clasificación archivada. ACTAS y RESUMEN renderizan SOLO este
   *  puesto; al escanear otro puesto se reemplaza completo. */
  puestoActual: PuestoActual | null;
  /** MODO SIMULACIÓN: toggle que llena la vista con el puesto demo (seed
   *  §6.4) cuando NO hay puesto real — overlay de VISTA, jamás escribe en
   *  `archivadas`/`puestoActual` (cero contaminación de datos reales). */
  modoSimulacion: boolean;
  /** KIT actas-vivas-paginas-v1 (FASE A): true cuando el guion del SIM quedó
   *  completo (todas las páginas OK) — detiene el tick de 5 s en ACTAS. */
  simCompleta: boolean;
  /** KIT actas-vivas-paginas-v1 (FASE A): último acta «subida» por el tick,
   *  p. ej. «MESA 02 · TRANSMISIÓN P1 ✓» (feedback bajo MESAS SIMULADAS). */
  simUltima: string | null;
  completadas: number;
  asignadasHoy: number;
  colaOffline: number;
  solicitudesRescaneo: number;
  historial: HistorialRow[];
  /** KIT e14-optimizacion-v1 (T5): contador en memoria de sesión «por qué
   *  no se envió» — espejo PASIVO de desenlaces YA ocurridos. Sin
   *  persistencia (igual que historial): se resetea al recargar. Claves:
   *  advertencia:<techo> · revision:clasif-<nivel> · rechazo:<tipo>. */
  motivosNoEnvio: Record<string, number>;
  /** KIT e14-carga-masiva-v1 (T3.4): REVISIÓN abierta desde la bandeja
   *  MASIVA (abrirActaMasiva) — BottomNav pinta MASIVA activo (y ESCANEAR
   *  no). Default false; se pone false en dispararEscaneo y al navegar a
   *  "escanear". Solo presentación: jamás cambia el flujo de REVISIÓN. */
  masivaOrigen: boolean;

  navegar: (vista: Vista) => void;
  /** MODO SIMULACIÓN (regla del dueño): alterna el toggle «SIM» de ACTAS.
   *  KIT actas-vivas-paginas-v1 (FASE A): ENCENDER entrega guion FRESCO
   *  (seed nuevo + SIM reiniciado); APAGAR solo apaga. */
  alternarModoSimulacion: () => void;
  /** KIT actas-vivas-paginas-v1 (FASE A): un tick del SIM VIVO — «sube» un
   *  acta al guion demo (marca la próxima página como OK cada 5 s). Overlay
   *  de VISTA (D6 INTOCABLE): SOLO escribe mesas/simUltima/simCompleta,
   *  JAMÁS archivadas/puestoActual/historial/completadas/actasSesion. */
  avanzarSimulacion: () => void;
  setFuente: (fuente: FuenteCaptura) => void;
  setArchivoPendiente: (archivo: File | null) => void;
  /** Registra el <video> vivo de la cámara (null al detener el stream). */
  setFramePendiente: (frame: HTMLVideoElement | null) => void;
  alternarConexion: () => void;
  /** §7 (SPEC-rediseno-revision): sin `intento` explícito, una captura
   *  CONTINÚA el ciclo de repetición si el acta previa sigue sin resolver
   *  (RECHAZADA o EN_REVISION_HUMANA «repetir-primero») — el contador cuenta
   *  CAPTURAS; ciclo nuevo (ENVIADA/OPTIMA/ADVERTENCIA/agotada) → 1.
   *  §D3 (SPEC-e14-simulacion-scores): `sim` presente SOLO cuando el disparo
   *  viene de un chip (simularScore) — enruta el MISMO camino con fuente
   *  SIMULACION + asset fijo de la banda + score inyectado; los guards de
   *  ARCHIVO/CAMARA no aplican y no consume archivoPendiente/framePendiente. */
  dispararEscaneo: (intento?: number, sim?: OpcionesSimEscaneo) => Promise<void>;
  /** §D2/§D3 (SPEC-e14-simulacion-scores): los 3 chips de calidad encima del
   *  obturador SON botones de simulación — disparan el MISMO camino de
   *  dispararEscaneo (REVISIÓN, banner, toast y ACTAS idénticos) con la fuente
   *  SIMULACION, el asset FIJO de la banda del dueño (la completa = óptima ·
   *  la cortada = intermedio · la borrosa = bajo) y su score inyectado. Nada
   *  se fuerza a mano: el desenlace lo decide `evaluarGate` (§D4) y el ciclo
   *  de intentos/contingencia es el mismo de las capturas reales (AC5). */
  simularScore: (banda: BandaSim) => void;
  analisisCompletado: () => void;
  enviarActa: () => void;
  repetirFoto: () => void;
  /** D6-bis (SPEC-rediseno-chrome-3-estados Rev. 3): escalación MANUAL a
   *  revisión humana — el botón «REVISIÓN HUMANA» (solo ADVERTENCIA/RECHAZADA,
   *  habilitado tras rechazos repetidos) entrega el acta al sabor contingencia
   *  EXACTO del camino automático (§7.5): status EN_REVISION_HUMANA +
   *  intento = maxIntentos (cede el ciclo) + fila de historial + toast.
   *  Sin re-escaneo: NO pasa por el gate ni por el pipeline. */
  escalarRevisionHumana: () => void;
  /**
   * Panel de corrección (SPEC-cabecera-clasificacion §5): persiste la
   * ubicación corregida por el operador como nivel AUTO-manual, archiva su
   * hueco (Fase B §6, con aviso §G.4.1 si duplicado) y pasa al flujo normal
   * de envío (ADVERTENCIA-equivalente).
   */
  guardarUbicacion: (clasificacion: ClasificacionE14) => void;
  /**
   * L5 §7.5 (rescate D20): aplica el recorte manual del QuadEditor —
   * bridge.recortar re-ejecuta el pipeline con el quad manual (F5-MANUAL) y
   * NO consume intento. F4/D37: `rotacionNueva` hornea la rotación LOCAL
   * del editor (undefined = conserva acta.rotation). Toast según resultado.
   * KIT e14-recorte-manual-v1 (T2): devuelve `true` si el recorte RESOLVIÓ
   * (éxito o timeout-controlado — el acta se actualizó) y `false` en error
   * duro (el editor NO se cierra — REVISIÓN pinta `errorRecorte`).
   */
  aplicarRecorte: (quad: Quad, rotacionNueva?: number) => Promise<boolean>;
  /**
   * F2 (§F2.2, D36): cambia el filtro del acta — bridge.revelar re-procesa
   * la foto (SOLO processImage, sin re-OCR/re-calidad — igual que
   * setFilterOnPage del core) y el toast copia el texto del lab (L1214-1218).
   */
  cambiarFiltro: (filtro: PageFilter) => Promise<void>;
  /**
   * F-OCR del lab (EditorView.tsx L1360-1395, D39): re-reconoce el texto del
   * acta sobre la PROCESADA y lo guarda. Toaster = copia de los toasts del lab
   * (títulos en mayúsculas = estilo de toasts e14, descripciones verbatim).
   */
  reconocerTextoActa: () => Promise<void>;
  /** KIT e14-carga-masiva-v1 (T3.2): contador «por qué no se envió»
   *  EXTRAÍDO de analisisCompletado (A2) — la lógica y las claves quedan
   *  byte-idénticas (mismo contadosNoEnvio, mismo incremento). Lo llama el
   *  flujo normal (analisisCompletado) Y el runner MASIVA. */
  contarMotivoNoEnvioActa: (acta: Acta) => void;
  /** KIT e14-carga-masiva-v1 (T3.3): envío automático de una ÓPTIMA
   *  MASIVA — reutiliza el registrarEnvio interno (A3) con el título de ESA
   *  acta (mismo formato que tituloPaginaActual). NO toca actaActual (el
   *  flujo normal sigue igual). */
  registrarEnvioMasiva: (acta: Acta) => void;
  /** KIT e14-carga-masiva-v1 (T3.4): abre un acta de la bandeja MASIVA en
   *  REVISIÓN (cargada de IDB vía módulo masiva) — recorte manual, filtros
   *  y envío manual intactos: todo lo que ya existe opera sobre
   *  actaActual. */
  abrirActaMasiva: (id: string) => Promise<void>;
  /**
   * KIT camara-visor-v1 (G3 — upgrade silencioso del lab L1789-1842):
   * re-procesa el acta con la foto FULL-RES del sensor que aterrizó en
   * segundo plano tras el disparo rápido por escalera (bridge.mejorarResolucion
   * — re-proceso sin consumir intento, quad re-detectado, gate completo).
   * Guardas de identidad del lab: `objetivo` es la referencia EXACTA del acta
   * que creó este disparo (capturada por ScanView al resolver dispararEscaneo)
   * — si el usuario re-disparó o editó (actaActual ≠ objetivo) el upgrade se
   * descarta en silencio; nunca toca un acta ya ENVIADA ni corre junto a un
   * recorte en vuelo (el rescate del editor manda). Si el re-proceso da
   * OPTIMA se auto-envía con el MISMO camino de aplicarRecorte (gate-v2 G4).
   */
  mejorarFotoActa: (fotoNueva: string, objetivo: Acta) => Promise<void>;
  /**
   * L5 §7 ReviewView: gira fotoProcesada 90° (rotateProcessedDataUrl del lab,
   * canvas puro) y hornea rotation para el PDF §6. Gate: foto (D35 — la
   * SIMULACIÓN también rota real).
   */
  rotarFoto: () => Promise<void>;
  /** KIT L6: restaura la jornada persistida al arrancar (llamado UNA vez
   *  desde el shell) — estado liviano + mesas reales derivadas + acta en
   *  revisión si quedó una a medias. Idempotente; sin registro → arranque
   *  fresco (seed demo, como hoy). */
  arrancarJornada: () => Promise<void>;
  /** KIT L6: REINICIAR JORNADA — borra TODO el turno (mesas archivadas,
   *  historial, contadores, motivos) + la cola MASIVA + el acta en
   *  revisión, y deja la app como recién instalada (nuevo día de
   *  votación). La confirmación de 2 toques vive en la UI (RESUMEN). */
  reiniciarJornada: () => Promise<void>;
}

/** Siguiente página a escanear: EN_PROCESO > PENDIENTE > RESCANEO (por mesa). */
function proximaPagina(mesas: Mesa[]): PaginaObjetivo | null {
  const prioridad: Record<string, number> = { EN_PROCESO: 0, PENDIENTE: 1, RESCANEO: 2, OK: 9 };
  let mejor: { mesaId: string; tipo: TipoPagina; pagina: 1 | 2; prio: number } | null = null;
  for (const mesa of mesas) {
    for (const p of mesa.paginas) {
      const prio = prioridad[p.estado] ?? 9;
      if (prio < 9 && (!mejor || prio < mejor.prio)) {
        mejor = { mesaId: mesa.id, tipo: p.tipo, pagina: p.pagina, prio };
      }
    }
  }
  return mejor ? { mesaId: mejor.mesaId, tipo: mejor.tipo, pagina: mejor.pagina } : null;
}

/** Recalcula progresoPct y estado de una mesa tras un cambio de página. */
function recalcularMesa(mesa: Mesa): Mesa {
  const noPendientes = mesa.paginas.filter((p) => p.estado !== "PENDIENTE").length;
  const enProceso = mesa.paginas.some((p) => p.estado === "EN_PROCESO");
  const pendientes = mesa.paginas.some((p) => p.estado === "PENDIENTE");
  const progresoPct = Math.round((noPendientes / mesa.paginas.length) * 100);
  const estado = pendientes || enProceso ? "EN_PROCESO" : "COMPLETADA";
  return { ...mesa, progresoPct, estado: estado as Mesa["estado"] };
}

/** KIT actas-vivas-paginas-v1 (FASE A): lógica EXTRAÍDA de registrarEnvio
 *  (marcaba la paginaObjetivo como OK y recalculaba su mesa, inline) —
 *  cero duplicación, cero cambio de comportamiento. La usa el envío REAL
 *  (registrarEnvio) Y el tick del SIM (avanzarSimulacion). */
function marcarPaginaOK(mesas: Mesa[], objetivo: PaginaObjetivo): Mesa[] {
  return mesas.map((m) =>
    m.id === objetivo.mesaId
      ? recalcularMesa({
          ...m,
          paginas: m.paginas.map((p) =>
            p.tipo === objetivo.tipo && p.pagina === objetivo.pagina
              ? { ...p, estado: "OK" }
              : p,
          ),
        })
      : m,
  );
}

/** Hueco archivado de una mesa real (§6: cuerpo DELEGADOS|TRANSMISIÓN × pág 1/2).
 *  KIT actas-vivas-paginas-v1 (FASE C): `estado` — OK (acta limpia) o
 *  RESCANEO (la captura archivada llegó ADVERTENCIA: ⚠ en ACTAS, cuenta
 *  como no-OK y deja la mesa EN PROCESO invitando al re-escaneo; el
 *  re-archivo del mismo hueco lo sube a OK — la más reciente manda). */
export interface HuecoArchivado {
  tipo: TipoPagina;
  pagina: 1 | 2;
  estado: "OK" | "RESCANEO";
}
/** Entrada Fase B (§6): clasificación guardada + huecos ocupados de la mesa. */
export interface ActaArchivada {
  clasificacion: ClasificacionE14;
  huecos: HuecoArchivado[];
}

/** PUESTO ACTUAL (regla del dueño: «solo un puesto debe de aparecer»): el
 *  puesto de la ÚLTIMA clasificación archivada. ACTAS y RESUMEN renderizan
 *  SOLO este puesto; al escanear otro puesto se reemplaza completo. */
export interface PuestoActual {
  /** Prefijo de clave «dep-mun-zon-std» (claveDePuesto). */
  clave: string;
  /** «ROMA - CONSULADO» (puesto.nombre en MAYÚSCULAS — convención de tituloYUbicacionDe). */
  titulo: string;
  /** Línea de ruta: país/municipio por NOMBRE, zona y puesto por CÓDIGO. */
  departamento: string;
  municipio: string;
  zona: string;
  puesto: string;
}

/**
 * Fase B (§6): archiva el hueco de una clasificación bajo su clave de mesa
 * (códigos con ceros, p. ej. «88-335-05-02-001»). Duplicado del MISMO hueco
 * → reemplaza (la clasificación más reciente queda como vigente) y avisa
 * (análisis §G.4.1). Idempotente: re-archivar el mismo acta es silencioso
 * para el llamador que ignora `duplicado`.
 * KIT actas-resumen-puesto-v2: además devuelve el PUESTO de la clasificación
 * (regla del dueño «solo un puesto» — la última archivada manda).
 */
function archivarHueco(
  archivadas: Record<string, ActaArchivada>,
  clasif: ClasificacionE14,
  /** KIT actas-vivas-paginas-v1 (FASE C): true → hueco RESCANEO (la
   *  captura archivada llegó ADVERTENCIA). */
  conRescate: boolean,
): { nuevas: Record<string, ActaArchivada>; duplicado: boolean; puesto: PuestoActual | null } {
  const clave = claveDeMesa(clasif);
  const tipo = clasif.tipo ? tipoPaginaDe(clasif.tipo) : null;
  const prefijo = claveDePuesto(clasif);
  if (!clave || !tipo || !prefijo)
    return { nuevas: archivadas, duplicado: false, puesto: null };
  // PUESTO ACTUAL (regla del dueño): la última clasificación archivada manda.
  const puesto: PuestoActual = {
    clave: prefijo,
    titulo: (clasif.puesto?.nombre || "PUESTO SIN NOMBRE").toUpperCase(),
    departamento: clasif.departamento?.nombre ?? "",
    municipio: clasif.municipio?.nombre ?? "",
    zona: clasif.zona?.codigo ?? "",
    puesto: clasif.puesto?.codigo ?? "",
  };
  // KIT actas-vivas-paginas-v1 (FASE B): la página del papel es DATO — si el
  // OCR/1D NO la leyó (pagina == null) el hueco va al PRIMER hueco LIBRE de
  // ese tipo (P1 libre → P1 · si no P2 libre → P2 · si no → P1, que
  // reemplaza — duplicado, semántica de hoy). NUNCA se asume P1 en silencio
  // (bug del dueño 16-oct: pág 2 de Frankfurt archivada en TRANSMISIÓN P1 →
  // la mesa 012 quedaba incompleta para siempre). Con página conocida →
  // exactamente igual que hoy.
  const previa = archivadas[clave];
  const paginaHueco: 1 | 2 = clasif.pagina
    ? clasif.pagina.index === 2
      ? 2
      : 1
    : (() => {
        const huecos = previa?.huecos ?? [];
        const ocupado = (p: 1 | 2) => huecos.some((h) => h.tipo === tipo && h.pagina === p);
        return !ocupado(1) ? 1 : !ocupado(2) ? 2 : 1;
      })();
  const hueco: HuecoArchivado = {
    tipo,
    pagina: paginaHueco,
    // KIT actas-vivas-paginas-v1 (FASE C): el hueco hereda el estado del
    // desenlace de la captura que se archiva; el re-archivo del mismo hueco
    // reemplaza clasificación Y estado (la más reciente manda — ya existía).
    estado: conRescate ? "RESCANEO" : "OK",
  };
  if (!previa) {
    return {
      nuevas: { ...archivadas, [clave]: { clasificacion: clasif, huecos: [hueco] } },
      duplicado: false,
      puesto,
    };
  }
  const yaEstaba = previa.huecos.some((h) => h.tipo === hueco.tipo && h.pagina === hueco.pagina);
  return {
    nuevas: {
      ...archivadas,
      [clave]: {
        // hueco duplicado → REEMPLAZA (§G.4.1): la foto más reciente gana el
        // hueco. FIX (auditoría 2-a C2): el re-archivo también reemplaza el
        // ESTADO del hueco (AC-RC5) — antes se conservaban previa.huecos
        // intactos y un RESCANEO ⚠ quedaba congelado para siempre (la mesa
        // jamás cerraba aunque el re-escaneo saliera ÓPTIMO).
        clasificacion: clasif,
        huecos: yaEstaba
          ? previa.huecos.map((h) =>
              h.tipo === hueco.tipo && h.pagina === hueco.pagina ? hueco : h,
            )
          : [...previa.huecos, hueco],
      },
    },
    duplicado: yaEstaba,
    puesto,
  };
}

function hashMock(): string {
  const hex = Array.from({ length: 12 }, () =>
    "0123456789abcdef"[Math.floor(Math.random() * 16)],
  ).join("");
  return `${hex}…`;
}

/** Guard anti doble-rotación (espejo del rotatingRef del lab L1054 — la
 *  rotación rápida es async y un doble tap giraría 180°). */
let rotandoFotoEnVuelo = false;

// ---------- KIT L6: estado del PERSISTER (módulo — declarado ANTES del
// create para excluir cualquier TDZ con HMR re-evaluando el módulo) ----------
let arrancada = false; // idempotencia de arrancarJornada (doble montaje incl.)
let persisterActivo = false; // gate multi-instancia (se abre al terminar arrancarJornada)
// FIX (hallazgo E2E #2): arranca en null (NO undefined) — igual que el
// actaActual inicial del store. Con undefined, el PRIMER set del arranque
// (ScanView montando, antes de que arrancarJornada lea el slot) disparaba
// la suscripción con actaActual=null ≠ undefined → limpiaba el slot del
// acta en revisión ANTES de poder restaurarlo (la recarga perdía el acta).
let ultimaActaPersistida: Acta | null | undefined = null;
let ultimoEstadoJson = "";

export const useE14Store = create<E14Store>((set, get) => {
  const bridge = getBridge();

  // KIT e14-carga-masiva-v1 (T3.3): `actaEnvio` — el envío MASIVA trae SU
  // acta (archiva SU hueco en ACTAS); el flujo normal sigue usando
  // actaActual. El hash del envío queda SOLO en el acta del flujo normal
  // (masiva jamás toca actaActual). Sin `actaEnvio`: byte-idéntico a antes.
  const registrarEnvio = (tituloPagina: string, actaEnvio?: Acta) => {
    const { online, historial, completadas, mesas, paginaObjetivo, actaActual, archivadas } = get();
    const actaFuente = actaEnvio ?? actaActual;
    const hora = bridge.horaHistorial();
    const fila: HistorialRow = {
      id: idHistorial(),
      titulo: tituloPagina,
      estado: "ENVIADO",
      hora,
    };
    let colaOffline = get().colaOffline;
    let hash: string;
    if (online) {
      hash = hashMock();
    } else {
      colaOffline += 1;
      hash = "EN COLA";
    }
    // FIX M1 (auditoría 2-a/2-c): paginaObjetivo SOLO del flujo NORMAL (sin
    // actaEnvio). El objetivo del escaneo individual jamás se resetea a null
    // tras una captura — un envío MASIVA posterior lo aplicaba sobre `mesas`
    // marcando OK una página que NUNCA se transmitió (el comentario del
    // runner lo prometía intacto y el código no lo cumplía).
    const mesasActualizadas =
      !actaEnvio && paginaObjetivo
        ? mesas.map((m) =>
            m.id === paginaObjetivo.mesaId
              ? recalcularMesa({
                  ...m,
                  paginas: m.paginas.map((p) =>
                    p.tipo === paginaObjetivo.tipo && p.pagina === paginaObjetivo.pagina
                      ? { ...p, estado: "OK" }
                      : p,
                  ),
                })
              : m,
          )
        : mesas;
    // Fase B (§6): acta con clasificación AUTO (gate o panel) → archiva su
    // hueco. Idempotente: si el panel ya la archivó, el reemplazo es
    // silencioso (mismo acta, mismos datos).
    let archivadasNuevas = archivadas;
    let puestoNuevo: PuestoActual | null = null;
    if (actaFuente?.clasificacion?.nivel === "AUTO") {
      const r = archivarHueco(
        archivadas,
        actaFuente.clasificacion,
        // KIT actas-vivas-paginas-v1 (FASE C): el estado del hueco lo pone el
        // desenlace de la captura que se archiva (ADVERTENCIA → RESCANEO).
        actaFuente.status === "ADVERTENCIA",
      );
      archivadasNuevas = r.nuevas;
      puestoNuevo = r.puesto;
    }
    set({
      historial: [fila, ...historial],
      completadas: Math.min(completadas + 1, get().asignadasHoy),
      colaOffline,
      mesas: mesasActualizadas,
      archivadas: archivadasNuevas,
      // PUESTO ACTUAL (kit actas-resumen-puesto-v2): el del archivo AUTO manda.
      puestoActual: puestoNuevo ?? get().puestoActual,
      actaActual:
        actaFuente === actaActual && actaActual
          ? { ...actaActual, hashSha256: hash }
          : actaActual,
    });
    return { online, hora };
  };

  // KIT e14-carga-masiva-v1 (T3.3): espejo de tituloPaginaActual para un
  // acta FUERA del flujo (A3 — mismo formato). Con clasificación AUTO el
  // título trae página (respétala); sin AUTO → título/tipo que trae el
  // acta (honesto, SIN MESA inventada — la clasificación es la que manda).
  const tituloDeActa = (acta: Acta): string => {
    const c = acta.clasificacion;
    if (c?.nivel === "AUTO" && c.puesto && c.mesa !== null && c.tipo) {
      const p = c.pagina == null ? "PÁG ?" : c.pagina.index === 1 ? "P1" : "P2";
      return `${c.puesto.nombre} · MESA ${c.mesa} — ${tipoPaginaDe(c.tipo)} ${p}`;
    }
    return acta.titulo ? `${acta.titulo} — ${acta.tipo}` : "ACTA SIN CLASIFICAR";
  };

  const tituloPaginaActual = (): string => {
    const { paginaObjetivo, actaActual } = get();
    // Fase B (§6): título de mesa REAL cuando la clasificación está resuelta.
    const c = actaActual?.clasificacion;
    if (c?.nivel === "AUTO" && c.puesto && c.mesa !== null && c.tipo) {
      // KIT actas-vivas-paginas-v1 (FASE B): página DESCONOCIDA → honesto
      // en el historial («PÁG ?»), NUNCA P1 mentiroso.
      const p = c.pagina == null ? "PÁG ?" : c.pagina.index === 1 ? "P1" : "P2";
      return `${c.puesto.nombre} · MESA ${c.mesa} — ${tipoPaginaDe(c.tipo)} ${p}`;
    }
    if (!paginaObjetivo) return "MESA 01 — TRANSMISIÓN P1";
    const p = paginaObjetivo.pagina === 1 ? "P1" : "P2";
    return `${paginaObjetivo.mesaId} — ${paginaObjetivo.tipo} ${p}`;
  };

  return {
    vista: "escanear",
    online: true,
    actaActual: null,
    paginaObjetivo: null,
    // §D1 (SPEC-e14-simulacion-scores): la app SIEMPRE arranca en CÁMARA
    // (fuente por defecto del producto — pill AUTO activa, visor vivo u
    // overlay §E del PR #33 sin permiso). Nunca se persiste la última fuente.
    fuente: "CAMARA",
    archivoPendiente: null,
    framePendiente: null,
    progresoAnalisis: null,
    analisisResuelto: false,
    recortando: false,
    // KIT e14-recorte-manual-v1 (T2): sin error de recorte al arrancar.
    errorRecorte: null,
    revelando: false,
    actasSesion: 0,
    mesas: mesasIniciales(),
    archivadas: {},
    puestoActual: null,
    modoSimulacion: false,
    simCompleta: false,
    simUltima: null,
    completadas: progresoInicial().completadas,
    asignadasHoy: progresoInicial().asignadasHoy,
    colaOffline: COLA_OFFLINE_INICIAL,
    solicitudesRescaneo: SOLICITUDES_RESCANEO_INICIAL,
    historial: historialInicial(),
    // KIT e14-optimizacion-v1 (T5): contador de sesión arranca vacío.
    motivosNoEnvio: {},
    // KIT e14-carga-masiva-v1 (T3.4): la app NO arranca desde MASIVA.
    masivaOrigen: false,

    navegar: (vista) =>
      set({ vista, ...(vista === "escanear" ? { masivaOrigen: false } : {}) }),

    // KIT actas-vivas-paginas-v1 (FASE A): ENCENDER → guion FRESCO (seed
    // nuevo + SIM reiniciado — AC-SIM2); APAGAR → solo apaga. Overlay de
    // vista: no toca archivadas/puestoActual/historial/completadas (D6).
    // KIT e14-luz-sim-puntos-v1 (T-S): ENCENDER → guion del PUESTO REAL del
    // acta escaneada (puestoActual → DIVIPOL p.t mesas × 4 páginas, fresco
    // — AC-SIM2). Sin puesto real o sin t DIVIPOL → seed demo (como hoy).
    // APAGAR → solo apaga. Overlay de vista (Opción A): SOLO mesas/
    // simCompleta/simUltima — D6 (jamás archivadas/puestoActual/historial).
    // FIX M10 (auditoría 2-a, kit L6): APAGAR ahora RESTAURA el guion REAL
    // (derivado de archivadas+puestoActual) — antes el progreso FALSO del
    // SIM quedaba quemado en `mesas` (todas OK) y `proximaPagina` devolvía
    // null para el resto de la sesión: todo escaneo real perdía página
    // objetivo y RESUMEN mostraba el avance inventado como real.
    alternarModoSimulacion: () => {
      const encender = !get().modoSimulacion;
      if (!encender) {
        set({ modoSimulacion: false });
        const puesto = get().puestoActual;
        if (puesto) {
          const [dep, mun, zon, std] = puesto.clave.split("-");
          void cargarDivipol()
            .then((base) => {
              const total = mesasDePuesto(base, dep, mun, zon, std);
              // Solo si sigue APAGADO (no re-montó el guion SIM debajo).
              if (total && !get().modoSimulacion) {
                set({ mesas: mesasRealesDe(get().archivadas, puesto, total) });
              }
            })
            .catch(() => {
              /* sin base → mesas queda como esté (degradación honesta) */
            });
        } else {
          // Sin puesto real → guion demo FRESCO (mismo estado de arranque).
          set({ mesas: mesasIniciales() });
        }
        return;
      }
      // Puesto demo INMEDIATO (la vista nunca queda vacía mientras carga DIVIPOL).
      set({
        modoSimulacion: true,
        mesas: mesasIniciales(),
        simCompleta: false,
        simUltima: null,
      });
      const puesto = get().puestoActual;
      if (!puesto) return;
      const [dep, mun, zon, std] = puesto.clave.split("-");
      void cargarDivipol()
        .then((base) => {
          const total = mesasDePuesto(base, dep, mun, zon, std);
          // El dueño pudo APAGAR durante la carga (base en caché ~instantáneo,
          // pero el guard es obligatorio): solo aplica si sigue ON.
          if (!total || !get().modoSimulacion) return;
          set({ mesas: guionDePuesto(total), simCompleta: false, simUltima: null });
        })
        .catch(() => {
          /* sin base → el guion demo ya está montado (degradación honesta) */
        });
    },

    // KIT actas-vivas-paginas-v1 (FASE A): SIM VIVO — cada tick «sube» un
    // acta al guion demo (proximaPagina YA existe con la prioridad
    // EN_PROCESO > PENDIENTE > RESCANEO; el seed arranca en m2-D2 y el
    // puesto se completa ~8 ticks). D6: SOLO mesas (guion del puesto demo)
    // + feedback — jamás datos reales. Guion completo → simCompleta (el
    // tick de ACTAS se detiene SOLO).
    avanzarSimulacion: () => {
      const objetivo = proximaPagina(get().mesas);
      if (!objetivo) {
        if (!get().simCompleta) set({ simCompleta: true });
        return;
      }
      const mesas = marcarPaginaOK(get().mesas, objetivo);
      set({
        mesas,
        simUltima: `${objetivo.mesaId} · ${objetivo.tipo} P${objetivo.pagina} ✓`,
        simCompleta: mesas.every((m) => m.paginas.every((p) => p.estado === "OK")),
      });
    },

    setFuente: (fuente) => set({ fuente }),

    setArchivoPendiente: (archivo) => set({ archivoPendiente: archivo }),

    setFramePendiente: (frame) => set({ framePendiente: frame }),

    alternarConexion: () => {
      const { online, colaOffline, actaActual } = get();
      if (online) {
        set({ online: false });
      } else {
        set({ online: true });
        if (colaOffline > 0) {
          set({
            colaOffline: 0,
            actaActual:
              actaActual && actaActual.hashSha256 === "EN COLA"
                ? { ...actaActual, hashSha256: hashMock() }
                : actaActual,
          });
        }
      }
    },

    dispararEscaneo: async (intentoParam?, sim?) => {
      // FIX M4 (auditoría 2-b): guard IN-FLIGHT — un disparo durante el
      // análisis en curso (IMPORTAR mientras takePhoto vuela hasta 8 s,
      // doble tap del obturador, el timeout de despacharCaptura llegando
      // tarde) lanzaba un 2º pipeline concurrente: doble OCR compitiendo
      // por el wasm, actasSesion +2. La vista "analizando" se setea
      // SÍNCRONAMENTE al entrar → el guard cierra la carrera.
      if (get().vista === "analizando") return;
      const { mesas, fuente, archivoPendiente, framePendiente, actaActual: previa } = get();
      // §D3 (SPEC-e14-simulacion-scores): un chip SIEMPRE corre la fuente
      // SIMULACION con el asset fijo de su banda + score inyectado (el bridge
      // resuelve el asset por `scoreSimulado`). No toca archivoPendiente ni
      // framePendiente — los guards de fuentes reales NO aplican (los chips
      // funcionan en los 3 modos, sin cámara viva). Sin `sim`, nada cambia.
      const simActiva = sim?.simular === true && typeof sim.scoreSimulado === "number";
      const fuenteEfectiva: FuenteCaptura = simActiva ? "SIMULACION" : fuente;
      // §7 (SPEC-rediseno-revision): el conteo cuenta CAPTURAS del ciclo de
      // repetición. Una captura SIN intento explícito (importar/disparo del
      // scanner) continúa el ciclo si el acta previa sigue sin resolver
      // (RECHAZADA, o EN_REVISION_HUMANA «repetir-primero» antes de agotar);
      // ciclo nuevo (ENVIADA/OPTIMA/ADVERTENCIA/contingencia agotada) → 1.
      // REPETIR FOTO (repetirFoto) siempre pasa el intento explícito +1.
      const intento =
        intentoParam ??
        (previa &&
        (previa.status === "RECHAZADA" ||
          (previa.status === "EN_REVISION_HUMANA" && previa.intento < previa.maxIntentos))
          ? previa.intento + 1
          : 1);
      // L2: en fuente ARCHIVO el disparo necesita imagen (REPETIR FOTO vuelve
      // al picker en vez de reventar el pipeline sin archivo). El aviso vive
      // ahora en la franja del visor de ScanView (pre-check de la vista).
      if (fuenteEfectiva === "ARCHIVO" && !archivoPendiente) {
        set({ vista: "escanear", masivaOrigen: false });
        return;
      }
      // L3: la fuente CÁMARA necesita una captura (foto ZSL/nativa ya en el
      // store) o el video vivo para el grab del frame. REPETIR FOTO vuelve al
      // visor (la cámara se reinicia al reactivar la vista) — espejo de D23.
      // (aviso en la franja del visor de ScanView, §4 del redesign-stitch)
      if (fuenteEfectiva === "CAMARA" && !archivoPendiente && !framePendiente) {
        set({ vista: "escanear", masivaOrigen: false });
        return;
      }
      const objetivo = proximaPagina(mesas);
      set({
        vista: "analizando",
        actaActual: null,
        progresoAnalisis: null,
        analisisResuelto: false,
        // KIT e14-carga-masiva-v1 (T3.4): una captura nueva NUNCA es de MASIVA.
        masivaOrigen: false,
      });
      // FIX M12 (auditoría 2-c): AUTO-PAUSA del runner MASIVA ante una
      // captura INDIVIDUAL — dos pipelines corriendo compiten por el wasm
      // mono-hilo (D45 secuencial estricto) y el escaneo interactivo manda.
      // Import DINÁMICO: runner.ts importa este store (evita el ciclo).
      // Fire-and-forget idempotente (pausarRunner solo levanta stopFlag).
      void import("./masiva/runner")
        .then((m) => m.pausarRunner())
        .catch(() => {
          /* módulo no cargado → no hay runner vivo */
        });
      try {
        const acta = await bridge.escanearActa({
          objetivo,
          intento,
          maxIntentos: 4,
          fuente: fuenteEfectiva,
          archivo: simActiva ? undefined : (archivoPendiente ?? undefined),
          frameActual:
            !simActiva && fuenteEfectiva === "CAMARA" ? framePendiente : undefined,
          // §D3: campos de simulación SOLO cuando el disparo viene de un chip.
          simular: simActiva ? true : undefined,
          scoreSimulado: simActiva ? sim!.scoreSimulado : undefined,
          onProgreso: (p) => set({ progresoAnalisis: p }),
        });
        set({
          actaActual: acta,
          paginaObjetivo: objetivo,
          actasSesion: get().actasSesion + 1,
          analisisResuelto: true,
          archivoPendiente: null,
        });
        // D7 (SPEC-rediseno-revision §7.5): contingencia automática al
        // AGOTAR intentos — el sistema escala solo (C4), sin botón manual:
        // fila de historial. Con intento < max NO hay historial (aún es
        // «repetir-primero"). El aviso persistente vive en la píldora de
        // estado REVISIÓN HUMANA de la REVISIÓN (redesign-stitch §4.3).
        if (acta.status === "EN_REVISION_HUMANA" && intento >= acta.maxIntentos) {
          const fila: HistorialRow = {
            id: idHistorial(),
            titulo: tituloPaginaActual(),
            estado: "REVISION_HUMANA",
            hora: bridge.horaHistorial(),
          };
          set({ historial: [fila, ...get().historial] });
        }
      } catch (err) {
        // FIX M3 (auditoría 2-a): el fallo del pipeline deja de ser mudo —
        // mismo patrón del kit e14-recorte-manual-v1 (T2): razonable en
        // consola. La UI vuelve al visor (los guards de entrada ya cubren
        // lo previsible; esto cubre lo imprevisto: asset SIM caído, decode
        // de archivo corrupto, video no listo).
        console.error("[e14] dispararEscaneo falló:", err);
        set({ vista: "escanear", progresoAnalisis: null, analisisResuelto: false });
      }
    },

    analisisCompletado: () => {
      const { actaActual } = get();
      if (!actaActual) return;
      // D4: ÓPTIMA (≥8) se envía automáticamente al capturar. Offline → el
      // estado persistente vive en la NUBE del TopBar (roja) + la cola de
      // RESUMEN (redesign-stitch §4.3).
      if (actaActual.status === "OPTIMA") {
        const hora = bridge.horaEnvio();
        registrarEnvio(tituloPaginaActual());
        set({
          actaActual: {
            ...get().actaActual!,
            status: "ENVIADA",
            enviadoAutomaticamente: hora,
          },
          vista: "revision",
        });
        return;
      }
      // KIT e14-optimizacion-v1 (T5), extraído a contarMotivoNoEnvioActa por
      // e14-carga-masiva-v1 (T3.2): contador «por qué no se envió» — espejo
      // pasivo de desenlaces YA ocurridos (todas las ramas no-OPTIMA). SOLO
      // aquí (kit §3-T5): el recorte re-evaluado no duplica (Set
      // contadosNoEnvio por id). Claves byte-idénticas al refactor.
      get().contarMotivoNoEnvioActa(actaActual);
      if (actaActual.status === "RECHAZADA") {
        const fila: HistorialRow = {
          id: idHistorial(),
          titulo: tituloPaginaActual(),
          estado: "RESCANEO_REQUERIDO",
          hora: bridge.horaHistorial(),
        };
        set({
          solicitudesRescaneo: get().solicitudesRescaneo + 1,
          historial: [fila, ...get().historial],
        });
        // §F-6 (SPEC-camara-funcional) → redesign-stitch §4.3: el motivo del
        // rechazo ya vive PERSISTENTE en la REVISIÓN (píldora de estado +
        // banner + píldora flotante de la tarjeta con el motivo REAL:
        // INCOMPLETA/BAJO/GENÉRICO — D1/PR #33). Sin toast.
      }
      set({ vista: "revision" });
    },

    enviarActa: () => {
      const { actaActual } = get();
      // D20 (L5) + G4 (KIT e14-gate-v2): envío MANUAL para ADVERTENCIA. La
      // ÓPTIMA ya no espera envío manual: el auto-envío D4 dispara al
      // capturar (analisisCompletado) Y tras el recorte (aplicarRecorte) —
      // el recorte es un flujo NORMAL: re-evalúa y, si pasa, auto-envía
      // como cualquier captura (sin banner ni CTA especial).
      if (
        !actaActual ||
        (actaActual.status !== "ADVERTENCIA" && actaActual.status !== "OPTIMA")
      ) {
        return;
      }
      registrarEnvio(tituloPaginaActual());
      set({
        actaActual: { ...get().actaActual!, status: "ENVIADA" },
        vista: "revision",
      });
      // Envío OK / cola offline → NUBE del TopBar + bloque ENVIADO (§4.3).
    },

    repetirFoto: () => {
      const { actaActual: previa } = get();
      // FIX M2 (auditoría 2-a): §7 — el ciclo de repetición CIERRA con
      // ADVERTENCIA/ENVIADA/OPTIMA/contingencia agotada → repetir desde ahí
      // abre ciclo NUEVO (intento 1). Solo RECHAZADA (y EN_REVISION_HUMANA
      // «repetir-primero» bajo el tope) CONTINÚA el ciclo: intento+1 con
      // TOPE maxIntentos. Antes un intento explícito sin tope fabricaba
      // «INTENTO 5 DE 4» + una fila REVISION_HUMANA nueva por cada intento
      // extra (dispararEscaneo L696 cree que es contingencia C4).
      const continuaCiclo =
        previa &&
        (previa.status === "RECHAZADA" ||
          (previa.status === "EN_REVISION_HUMANA" &&
            previa.intento < previa.maxIntentos));
      const intento = continuaCiclo
        ? Math.min((previa?.intento ?? 0) + 1, previa?.maxIntentos ?? 4)
        : 1;
      void get().dispararEscaneo(intento);
    },

    simularScore: (banda) => {
      // §D2/§D3 (SPEC-e14-simulacion-scores): un chip es UNA captura del ciclo
      // — reutiliza dispararEscaneo INTACTO (intento vigente: continúa el
      // ciclo si el acta previa sigue sin resolver, ciclo nuevo → 1) para que
      // REVISIÓN, banner, toast, historial, ACTAS y contingencia C4 se
      // comporten idénticos a las capturas reales. El guard cubre el race de
      // un double-tap: vista ya en "analizando" → ignorado (AC7).
      if (get().vista === "analizando") return;
      void get().dispararEscaneo(undefined, {
        simular: true,
        scoreSimulado: SCORE_SIMULADO[banda],
      });
    },

    escalarRevisionHumana: () => {
      const acta = get().actaActual;
      // Guard del dueño: SOLO score intermedio (ADVERTENCIA) y bajo
      // (RECHAZADA). ENVIADA/OPTIMA/EN_RH: no-op.
      if (!acta || (acta.status !== "ADVERTENCIA" && acta.status !== "RECHAZADA")) return;
      const fila: HistorialRow = {
        id: idHistorial(),
        titulo: tituloPaginaActual(),
        estado: "REVISION_HUMANA",
        hora: bridge.horaHistorial(),
      };
      set({
        actaActual: { ...acta, status: "EN_REVISION_HUMANA", intento: acta.maxIntentos },
        historial: [fila, ...get().historial],
      });
    },

    guardarUbicacion: (clasificacion) => {
      const { actaActual, archivadas } = get();
      if (!actaActual) return;
      // §5: la corrección del operador es AUTO-manual (confianza plena).
      const final: ClasificacionE14 = {
        ...clasificacion,
        nivel: "AUTO",
        confianzas: { departamento: 1, municipio: 1, puesto: 1, tipo: 1 },
      };
      const { nuevas, puesto } = archivarHueco(
        archivadas,
        final,
        // KIT actas-vivas-paginas-v1 (FASE C): el estado del acta corregida
        // manda (llegó ADVERTENCIA → hueco RESCANEO; re-archivo la sube a OK).
        actaActual.status === "ADVERTENCIA",
      );
      // §1.4 (SPEC-titulo-ubicacion): la corrección del panel también pasa el
      // título/ubicación al acta (AUTO-manual → el helper aplica).
      const titUbi = tituloYUbicacionDe(final);
      // §5: «pasa a flujo normal de envío (ADVERTENCIA-equivalente)» — la
      // foto era buena, la ubicación ya está corregida.
      set({
        actaActual: {
          ...actaActual,
          clasificacion: final,
          status: "ADVERTENCIA",
          ...(titUbi ? { titulo: titUbi.titulo, ubicacion: titUbi.ubicacion } : {}),
        },
        archivadas: nuevas,
        // PUESTO ACTUAL (kit actas-resumen-puesto-v2): la corrección del
        // panel TAMBIÉN manda (AUTO-manual → el puesto corregido es el actual).
        puestoActual: puesto ?? get().puestoActual,
      });
    },

    aplicarRecorte: async (quad, rotacionNueva) => {
      const { actaActual } = get();
      if (!actaActual?.fotoOriginal) {
        return false;
      }
      // FIX M5 (auditoría 2-b): guard SIMÉTRICO — un upgrade silencioso en
      // vuelo (revelando, ~15 s) compite por el wasm y su resolve tardío
      // sobrescribiría el acta recortada (mismo patrón que mejorarFotoActa).
      if (get().recortando || get().revelando) return false;
      // KIT e14-recorte-manual-v1 (T2): cada intento NACE sin error previo.
      set({ recortando: true, progresoAnalisis: null, errorRecorte: null });
      try {
        // RecorTE manual → pipeline §5 re-ejecutado con F5-MANUAL; el acta
        // conserva identidad (intento/fuente/paginación) — rescate sin intento.
        // F4/D37: la rotación LOCAL del editor se hornea en fotoProcesada.
        const acta = await bridge.recortar(
          actaActual,
          quad,
          (p) => set({ progresoAnalisis: p }),
          rotacionNueva,
          undefined,
          // KIT e14-esquinas-suaves-v1 (Q2): recorte del editor = decisión CON VISTA
          // (escudo-manual: la tinta al filo del crop manual nunca RECHAZA).
          true,
        );
        set({ actaActual: acta, progresoAnalisis: null });
        // G4 (KIT e14-gate-v2): flujo post-recorte NORMAL — el recorte
        // re-evalúa y si el gate da OPTIMA+AUTO se auto-envía como
        // CUALQUIER captura (mismo camino de analisisCompletado D4).
        // Adiós la excepción D20 «el rescate nunca se auto-envía»: sin
        // flag, sin banner de envío manual y sin CTA especial. La razón
        // de ser de D20 (no hay doble transmisión) se conserva por otra
        // vía: el recorte SOLO existe en actas NO enviadas.
        if (acta.status === "OPTIMA") {
          const hora = bridge.horaEnvio();
          registrarEnvio(tituloPaginaActual());
          set({
            actaActual: {
              ...get().actaActual!,
              status: "ENVIADA",
              enviadoAutomaticamente: hora,
            },
            vista: "revision",
          });
          // KIT e14-recorte-manual-v1 (T2): resolvió (éxito) — el editor
          // puede cerrarse.
          return true;
        }
        // El desenlace (SIGUE RECHAZADA / SIN_VOTOS / ADVERTENCIA…) vive
        // PERSISTENTE en la píldora de estado de la REVISIÓN (§4.3).
        // KIT e14-recorte-manual-v1 (T2): resolvió (incluye el timeout-
        // controlado — el acta RECHAZADA por tiempo ya muestra el recorte
        // horneado, T1). El editor SÍ se cierra.
        return true;
      } catch (err) {
        // KIT e14-recorte-manual-v1 (T2): el fallo DEJA DE SER SILENCIOSO —
        // razonable en consola + aviso visible con el mecanismo del repo
        // (sin toasts — redesign-stitch D2 los retiró): píldora en REVISIÓN.
        // El editor NO se cierra (onAplicar cierra solo con `true`) — el
        // dueño reintenta SIN perder su quad. El gate/score no cambian.
        console.error("[e14] aplicarRecorte falló:", err);
        set({ progresoAnalisis: null, errorRecorte: MSG_RECORTE_FALLIDO });
        // Auto-limpieza ~6 s (guard por mensaje: no borra un error MÁS NUEVO).
        setTimeout(() => {
          if (get().errorRecorte === MSG_RECORTE_FALLIDO) set({ errorRecorte: null });
        }, 6000);
        return false;
      } finally {
        set({ recortando: false });
      }
    },

    rotarFoto: async () => {
      const { actaActual } = get();
      // Actas con foto procesada (D35: SIMULACIÓN también — el gate es la foto;
      // F-ROT-RAPID gira la PROCESADA sin re-ejecutar el pipeline).
      if (!actaActual?.fotoProcesada) return;
      if (rotandoFotoEnVuelo) return;
      rotandoFotoEnVuelo = true;
      try {
        // F-ROT-RAPID del lab (L1080): gira la PROCESADA sin re-ejecutar el
        // pipeline; la rotación queda HORNEADA (rotation += 90) para que el
        // PDF §6 y un eventual re-recorte la respeten.
        const { url } = await rotateProcessedDataUrl(actaActual.fotoProcesada, 90);
        set({
          actaActual: {
            ...actaActual,
            fotoProcesada: url,
            rotation: ((actaActual.rotation ?? 0) + 90) % 360,
          },
        });
      } catch {
        // La rotación fallida no cambia estado — el acta conserva su foto.
      } finally {
        rotandoFotoEnVuelo = false;
      }
    },

    cambiarFiltro: async (filtro) => {
      const { actaActual } = get();
      if (!actaActual?.fotoOriginal) {
        return;
      }
      if (get().revelando) return;
      set({ revelando: true });
      try {
        // F2/D36: revelar = SOLO processImage (sin re-OCR/re-calidad — igual
        // que setFilterOnPage del core); el acta conserva identidad por spread.
        const acta = await bridge.revelar(actaActual, filtro);
        // FIX M5 (auditoría 2-b): re-validación de identidad al resolver —
        // un recorte aplicado durante el revelado (~1-3 s) NO debe ser
        // sobrescrito por la foto SIN recorte de este resolve (patrón del
        // upgrade silencioso del lab, L1008 del propio store).
        if (get().actaActual !== actaActual) return;
        set({ actaActual: acta });
        // El feedback persistente es la PROPIA foto re-velada + el chip del
        // filtro activo en el sheet (§4.3 del redesign-stitch — sin toast).
      } catch {
        set({ actaActual: actaActual });
      } finally {
        set({ revelando: false });
      }
    },

    reconocerTextoActa: async () => {
      const { actaActual } = get();
      // Guard (spec §F2.1): sin foto procesada no hay nada que reconocer.
      // (El estado "corriendo" — ocrRunning del lab L347 — vive en ReviewView.)
      if (!actaActual?.fotoProcesada) {
        return;
      }
      try {
        const texto = await bridge.reconocerTexto(actaActual);
        // Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx L1380-1387
        // (ocrTextIsValid → guardar; «sin texto» se muestra persistente en el
        // propio sheet: contadores a 0 + nota OCR_NO_TEXT del lab).
        if (ocrTextIsValid(texto)) {
          set({ actaActual: { ...actaActual, ocrTexto: texto } });
        }
      } catch {
        // Error de reconocimiento: los contadores del sheet quedan como están.
      }
    },

    mejorarFotoActa: async (fotoNueva, objetivo) => {
      const { actaActual } = get();
      // Guardas del lab L1818-1832 (silenciosas — el upgrade JAMÁS rompe nada):
      // identidad de la captura (el usuario pudo re-disparar/editar), acta ya
      // enviada (nada que mejorar), recorte del editor en vuelo (el rescate manda).
      if (!actaActual || actaActual !== objetivo) return;
      if (actaActual.status === "ENVIADA") return;
      if (get().recortando || get().revelando) return;
      if (!actaActual.fotoOriginal) return;
      set({ revelando: true }); // RECORTAR queda fuera durante el re-proceso
      try {
        const acta = await bridge.mejorarResolucion(objetivo, fotoNueva, (p) =>
          set({ progresoAnalisis: p }),
        );
        // El usuario pudo actuar mientras el upgrade volaba (~15 s): solo
        // escribo si el acta SIGUE siendo la misma (misma identidad del lab).
        if (get().actaActual !== objetivo) return;
        set({ actaActual: acta, progresoAnalisis: null });
        // G4 (KIT e14-gate-v2) — MISMO patrón de aplicarRecorte: el upgrade
        // re-evalúa y si el gate da OPTIMA se auto-envía como CUALQUIER
        // captura (mismo camino de analisisCompletado D4).
        if (acta.status === "OPTIMA") {
          const hora = bridge.horaEnvio();
          registrarEnvio(tituloPaginaActual());
          // FIX M7 (auditoría 2-b): NO teletransportar — el upgrade vuela
          // ~15 s en segundo plano; si el usuario ya navegó a ACTAS/RESUMEN
          // el acta se actualiza igual pero la vista NO se roba (el banner
          // de ENVIADA aparece cuando vuelva a REVISIÓN). Sin key `vista`:
          // cada vista conserva la suya.
          set({
            actaActual: {
              ...get().actaActual!,
              status: "ENVIADA",
              enviadoAutomaticamente: hora,
            },
          });
        }
      } catch {
        /* silencioso: el upgrade JAMÁS rompe nada (el acta queda como está) */
      } finally {
        set({ revelando: false });
      }
    },

    // ---------- KIT e14-carga-masiva-v1 (T3): integración mínima ----------

    contarMotivoNoEnvioActa: (acta) => {
      // Lógica EXTRAÍDA de analisisCompletado (kit e14-optimizacion-v1 T5,
      // A2) por e14-carga-masiva-v1 (T3.2) — MISMAS claves, mismo Set
      // anti-dup por id, mismo incremento: byte-idéntico (kit §5-T3.2).
      if (contadosNoEnvio.has(acta.id)) return;
      let clave: string | null = null;
      if (acta.status === "ADVERTENCIA") {
        const techo = acta.diagnostico?.score?.techos[0];
        clave = techo ? `advertencia:${techo}` : "advertencia:sin-diag";
      } else if (acta.status === "EN_REVISION_HUMANA") {
        const nivel = acta.clasificacion?.nivel;
        clave = nivel ? `revision:clasif-${nivel}` : "revision:sin-diag";
        // KIT e63f-autoenvio-v1 (F0 — balde fino, solo-aditivo): clave NUEVA
        // `revision:clasif-<nivel>:<motivo>` con el motivo EXACTO del
        // clasificador (clasifDebil — puesto-lugar/tipo/mesa-registro/ruta).
        // Las claves viejas (`revision:clasif-<nivel>`) quedan INTACTAS y
        // siguen contando byte-idénticas (nada que las consume se rompe).
        const motivo = acta.clasificacion?.clasifDebil;
        if (nivel && motivo) {
          const actualesFino = get().motivosNoEnvio;
          const claveFina = `revision:clasif-${nivel}:${motivo}`;
          set({
            motivosNoEnvio: {
              ...actualesFino,
              [claveFina]: (actualesFino[claveFina] ?? 0) + 1,
            },
          });
        }
      } else if (acta.status === "RECHAZADA") {
        clave = `rechazo:${acta.rechazo?.tipo.toLowerCase() ?? "desconocido"}`;
      }
      if (clave) {
        contadosNoEnvio.add(acta.id);
        const actuales = get().motivosNoEnvio;
        set({
          motivosNoEnvio: { ...actuales, [clave]: (actuales[clave] ?? 0) + 1 },
        });
      }
    },

    registrarEnvioMasiva: (acta) => {
      // T3.3: la MISMA vía del envío real (registrarEnvio interno — A3) con
      // el título de ESA acta (mismo formato que tituloPaginaActual —
      // tituloDeActa). NO toca actaActual (actaFuente ≠ actaActual dentro
      // de registrarEnvio); mesas queda intacta (paginaObjetivo no es de
      // MASIVA). El marcaje status ENVIADA + horaEnvio lo hornea el runner
      // en la copia que persiste (kit §5-T3.3).
      registrarEnvio(tituloDeActa(acta), acta);
    },

    abrirActaMasiva: async (id) => {
      // T3.4: acta de IDB → REVISIÓN con flag de origen. REVISIÓN funciona
      // INTACTA (recorte manual, filtros, envío manual — todo opera sobre
      // actaActual). Al volver, el mini-store MASIVA sincroniza la fila
      // (sincronizarAlVolver — F5: el acta conserva identidad).
      try {
        const registro = await leerRegistro(id);
        if (!registro.acta) return; // sin desenlace aún — nada que abrir
        set({ actaActual: registro.acta, vista: "revision", masivaOrigen: true });
      } catch {
        /* registro ausente/IDB caído → la bandeja queda como está (kit §3) */
      }
    },

    // ---------- KIT L6: persistencia de la jornada ----------

    arrancarJornada: async () => {
      if (arrancada) return; // idempotente (StrictMode double-mount incl.)
      arrancada = true;
      try {
        const j = await cargarJornada();
        if (!j) return; // arranque fresco (seed demo, como hoy)
        // El operador pudo disparar un escaneo antes de que la carga
        // resolviera (IDB lento): su actividad MANDA — no se pisa nada.
        if (get().actasSesion > 0 || get().actaActual) return;
        set({
          archivadas: j.archivadas,
          puestoActual: j.puestoActual,
          historial: j.historial,
          completadas: j.completadas,
          asignadasHoy: Math.max(j.asignadasHoy, j.completadas),
          actasSesion: j.actasSesion,
          colaOffline: j.colaOffline,
          solicitudesRescaneo: j.solicitudesRescaneo,
          motivosNoEnvio: j.motivosNoEnvio,
        });
        // mesas: DERIVADAS del puesto real (fix M10 — jamás el guion SIM).
        const puesto = j.puestoActual;
        if (puesto && !get().modoSimulacion) {
          const [dep, mun, zon, std] = puesto.clave.split("-");
          try {
            const base = await cargarDivipol();
            const total = mesasDePuesto(base, dep, mun, zon, std);
            if (total && !get().modoSimulacion) {
              set({ mesas: mesasRealesDe(j.archivadas, puesto, total) });
            }
          } catch {
            /* sin base → mesas queda en seed (degradación honesta) */
          }
        }
        // Acta que quedó a mitad de REVISIÓN (crash/recarga) — se restaura
        // con TODO: recorte, filtros y envío manual siguen intactos.
        const acta = await leerActaEnRevision();
        if (acta && !get().actaActual && get().actasSesion === j.actasSesion) {
          set({ actaActual: acta, vista: "revision" });
        }
      } catch {
        /* IDB caída → arranque fresco (la jornada vive en RAM, honesto) */
      } finally {
        // FIX (hallazgo E2E #3 — multi-instancia): el persister NO escribe
        // hasta que el arranque TERMINÓ. Antes, una segunda pestaña/instancia
        // que booteaba fresca sobrescribía la jornada persistida con su seed
        // ANTES de que cargarJornada pudiera restaurarla (la recarga en la
        // pestaña original perdía todo). Con el gate: toda instancia PRIMERO
        // restaura (o confirma que no hay nada) y solo entonces persiste.
        persisterActivo = true;
      }
    },

    reiniciarJornada: async () => {
      // El ciclo de intentos/estados en vuelo no sobrevive al reinicio.
      contadosNoEnvio.clear();
      set({
        vista: "escanear",
        actaActual: null,
        paginaObjetivo: null,
        progresoAnalisis: null,
        analisisResuelto: false,
        recortando: false,
        errorRecorte: null,
        revelando: false,
        // Jornada REAL a cero (nuevo día de votación).
        archivadas: {},
        puestoActual: null,
        historial: historialInicial(),
        completadas: progresoInicial().completadas,
        asignadasHoy: progresoInicial().asignadasHoy,
        actasSesion: 0,
        colaOffline: COLA_OFFLINE_INICIAL,
        solicitudesRescaneo: SOLICITUDES_RESCANEO_INICIAL,
        motivosNoEnvio: {},
        // Overlays y guiones también nacen frescos.
        mesas: mesasIniciales(),
        modoSimulacion: false,
        simCompleta: false,
        simUltima: null,
        masivaOrigen: false,
      });
      // Slot del acta en revisión FUERA (el estado liviano se re-persiste
      // fresco por el suscriptor de abajo).
      void guardarActaEnRevision(null);
      // La cola MASIVA también es de la jornada: pausa + VACIAR (su propio
      // mecanismo, con sus guards — imports dinámicos por el ciclo de módulos).
      void import("./masiva/runner")
        .then((m) => m.pausarRunner())
        .catch(() => undefined);
      void import("./masiva/store")
        .then((m) => m.useMasivaStore.getState().vaciar())
        .catch(() => undefined);
    },
  };
});

// ---------- KIT L6: persistencia por SUSCRIPCIÓN (una sola fuente) ----------
// El estado liviano se persiste en cada cambio REAL (comparación por JSON —
// el tick del SIM solo toca mesas/simUltima/simCompleta, que NO están en el
// slice → cero escrituras espurias, D6 intacto). El acta en revisión se
// persiste por IDENTIDAD de referencia (stringify de ~14 MB en cada set
// sería prohibitivo — el cambio de referencia es el evento exacto).
// SIMULACIÓN y origen MASIVA jamás ocupan el slot del acta.
if (typeof window !== "undefined" && typeof indexedDB !== "undefined") {
  useE14Store.subscribe((s) => {
    // Gate multi-instancia: sin arranque completado no se persiste NADA
    // (ni el estado ni el slot del acta) — ver comentario del finally.
    if (!persisterActivo) return;
    const estado = {
      version: 1,
      archivadas: s.archivadas,
      puestoActual: s.puestoActual,
      historial: s.historial.slice(0, TOPE_HISTORIAL),
      completadas: s.completadas,
      asignadasHoy: s.asignadasHoy,
      actasSesion: s.actasSesion,
      colaOffline: s.colaOffline,
      solicitudesRescaneo: s.solicitudesRescaneo,
      motivosNoEnvio: s.motivosNoEnvio,
    };
    const json = JSON.stringify(estado);
    if (json !== ultimoEstadoJson) {
      ultimoEstadoJson = json;
      void guardarJornada(estado);
    }
    if (s.actaActual !== ultimaActaPersistida) {
      ultimaActaPersistida = s.actaActual;
      const persistible =
        s.actaActual &&
        s.actaActual.fuente !== "SIMULACION" && // chips/demo jamás ocupan el slot
        !s.masivaOrigen // la cola MASIVA ya persiste las suyas
          ? s.actaActual
          : null;
      void guardarActaEnRevision(persistible);
    }
  });
}
