"use client";

/**
 * REVISIÓN (§7.4–§7.5) — documento + banner por estado + CTAs.
 * STITCH REDESIGN (SPEC-e14-redesign-stitch Rev. 1 §3.2, mocks 2-6): UN
 * mismo esqueleto con 6 vestidos — TopBar (en page.tsx: retro + píldora de
 * estado + nube) + banner de ubicación (mono, dot del estado; ruta con `>`
 * en óptima/enviada) + chips grid-cols-3 (activo sólido del color del
 * estado) + tarjeta bg-brand-surface rounded-2xl con ESQUINAS AR del color
 * del estado y PÍLDORA FLOTANTE con el motivo real + LA FOTO REAL del acta
 * (rounded-lg border-gray-300 — NUNCA el formulario dibujado del mock,
 * §3.5/AC7) + fila de acciones neutra grid-cols-3 + CTAs por estado (mock
 * 2-6: rojo sólido con badge azul giratorio · ámbar outline · par con
 * REVISIÓN HUMANA surface · verde SEGUIR ESCANEANDO) + bloque
 * «✓ ENVIADO AUTOMÁTICAMENTE» + nav (shell BottomNav).
 * LA LÓGICA SIGUE INTACTA (Rev. 5 del score-ocr + todas las specs
 * previas): datos data-driven, gate, escalación, candado RH, parciales,
 * fallback de foto D4, visor F-ZOOM (SERIE 1), sheets Filtros/Texto.
 * D2 (redesign-stitch §4): SIN notificaciones — el feedback vive en la UI
 * persistente (píldoras, banner, píldora flotante, feedback en botón).
 */
import { useEffect, useMemo, useState } from "react";
import { useE14Store } from "@/lib/e14/store";
import { OCR_NO_TEXT } from "@jg-stevan/scanner-core/ocr";
import { defaultQuad, FILTER_PRESETS } from "@jg-stevan/scanner-core/types";
import type { PageFilter } from "@jg-stevan/scanner-core/types";
// G4 (KIT camara-visor-v1): descarga de la foto PROCESADA. downloadBlob y
// sanitizeFileName YA están publicados en el core (pdf-export 0.1.0) —
// dataUrlToBlob NO existe en el tarball (la instrucción la citaba; se porta
// como helper local de 5 líneas con fetch → blob, cero dependencias nuevas).
import { downloadBlob } from "@jg-stevan/scanner-core/pdf-export";
import {
  nombreExportacion,
  tipoDeBanda,
  type TipoCopia,
} from "@/lib/e14/clasificador";
import { QuadEditor } from "../QuadEditor";
import { ZoomableVisor } from "@jg-stevan/scanner-ui";
import { PanelClasificacion } from "../PanelClasificacion";
// KIT e14-diagnostico-autoenvio-v1 (C4): red de seguridad §9.1 — re-descarga
// del paquete ZIP si el navegador bloqueó la auto-descarga del desenlace.
import { descargarPaqueteDiagnostico } from "@/lib/e14/diagnostico";
import { Chip, PrimaryBtn, ToolbarBtn } from "../primitives";
import {
  CopyIcon,
  DownloadIcon,
  LoaderIcon,
  ScanTextIcon,
  SlidersIcon,
  WarnTriangleIcon,
  StitchCropIcon,
  StitchRotateIcon,
  StitchEyeIcon,
  StitchSpinIcon,
} from "../icons";

// Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx L89-L93
// (CSS_FILTERS — aproximación CSS de cada filtro para las previews en vivo:
// solo cosmética; el procesado real ocurre al elegir, vía store.cambiarFiltro).
const CSS_FILTERS: Record<PageFilter, string> = {
  original: "none",
  text: "brightness(1.12) contrast(1.35)",
  bw: "grayscale(1) contrast(2.6) brightness(1.05)",
};

// Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx L237-271
// (OcrHighlightedText — F-FIND: texto OCR con las coincidencias resaltadas.
// Sin consulta activa se renderiza el texto plano). Copia COMPLETA aunque e14
// hoy siempre pasa query={null}. El <mark> amarillo se conserva literal (es
// del lab, no del tema anterior de e14).
function OcrHighlightedText({
  text,
  query,
}: {
  text: string;
  query: string | null;
}) {
  const q = query?.trim();
  if (!q) {
    return (
      <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-white/90">
        {text}
      </p>
    );
  }
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  const needle = q.toLowerCase();
  return (
    <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-white/90">
      {parts.map((part, i) =>
        part.toLowerCase() === needle ? (
          <mark
            key={i}
            className="rounded-[3px] bg-[#ffd60a] px-0.5 font-semibold text-black"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  );
}

// G4 (KIT camara-visor-v1) — dataUrlToBlob LOCAL: el lab la tiene en su
// EditorView (L1144-1195 la usa para su F-IMG); el tarball 0.1.0 del core no
// la exporta → helper de módulo con fetch(dataUrl).blob() (data URLs son
// fetch-ables). Cero dependencias nuevas.
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export function ReviewView() {
  const acta = useE14Store((s) => s.actaActual);
  // KIT consenso-frankfurt-v1 (FASE 5, §6.1): el selector paginaObjetivo fue
  // RETIRADO de esta pantalla — PROHIBIDO paginaObjetivo?.tipo (era el tipo
  // del HUECO donde cayó archivada la acta, no el del acta: el «DELEGADOS»
  // falso del dueño con Frankfurt 746). El chip muestra solo señales REALES
  // del acta (clasifAuto → tipoDeBanda → «---»). El store no se toca: otras
  // pantallas siguen usando su propio selector.
  const recortando = useE14Store((s) => s.recortando);
  const revelando = useE14Store((s) => s.revelando);
  const aplicarRecorte = useE14Store((s) => s.aplicarRecorte);
  const rotarFoto = useE14Store((s) => s.rotarFoto);
  const cambiarFiltro = useE14Store((s) => s.cambiarFiltro);
  const reconocerTextoActa = useE14Store((s) => s.reconocerTextoActa);
  // L5 §7.5: editor de recorte y visor a pantalla completa (estado local —
  // el acta solo cambia por store.aplicarRecorte al APLICAR).
  const [editando, setEditando] = useState(false);
  const [visorAbierto, setVisorAbierto] = useState(false);
  // F2 (§F2.2): sheet de filtros (copia del lab EditorView L2253-2309).
  const [filtrosAbierto, setFiltrosAbierto] = useState(false);
  // F-OCR (§F3.3, D39): sheet «Texto reconocido» + estado "corriendo" LOCAL.
  const [textoAbierto, setTextoAbierto] = useState(false);
  const [ocrEjecutando, setOcrEjecutando] = useState(false);
  // D2 (redesign-stitch §4.3): feedback de COPIAR en el propio botón
  // (1.5 s «COPIADO ✓» / «NO SE PUDO COPIAR») — sin toast flotante.
  const [copiado, setCopiado] = useState<"ok" | "err" | null>(null);
  // G4 (KIT camara-visor-v1): mismo patrón de feedback — 1.5 s en el botón
  // «Imagen» («DESCARGADA ✓» / «NO SE PUDO»), sin toast flotante.
  const [imagenDesc, setImagenDesc] = useState<"ok" | "err" | null>(null);
  // KIT e14-diagnostico-autoenvio-v1 (C4): feedback del botón DIAGNÓSTICO ↓.
  const [diagDesc, setDiagDesc] = useState<"ok" | "err" | null>(null);
  // Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx L1563-1578
  // (ocrStats — contadores del sheet de texto). ADAPTACIÓN: sin `matches`
  // (F-FIND excluido — e14 no tiene biblioteca buscable, §1 del spec).
  const ocrStats = useMemo(() => {
    const text = acta?.ocrTexto ?? "";
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return { words, chars: text.length };
  }, [acta?.ocrTexto]);

  // L5: Esc cierra el visor (el cierre por toque lo resuelve el
  // ZoomableVisor dentro del modal — ver §4 del sync-visor).
  useEffect(() => {
    if (!visorAbierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVisorAbierto(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visorAbierto]);

  // G4 (KIT camara-visor-v1) — botón «Imagen»: descarga la foto PROCESADA
  // (la evidencia que ve el visor — D3 del kit; e14 NO reprocesa a 4032:
  // el pipeline ya produce fotoProcesada definitiva). Nombre de archivo:
  // nombreExportacion(clasificacion) + .jpg; sin clasificación →
  // E14_CAPTURA_<hora>. Feedback en el propio botón (estilo e14, D2).
  const descargarImagen = async (): Promise<void> => {
    const foto = acta?.fotoProcesada;
    if (!foto) return;
    try {
      const clave =
        acta.clasificacion && acta.clasificacion.nivel === "AUTO"
          ? nombreExportacion(acta.clasificacion)
          : null;
      const hora = new Date()
        .toTimeString()
        .slice(0, 8)
        .replace(/:/g, "");
      const nombre = `${clave ?? `E14_CAPTURA_${hora}`}.jpg`;
      downloadBlob(await dataUrlToBlob(foto), nombre);
      setImagenDesc("ok");
    } catch {
      setImagenDesc("err");
    } finally {
      window.setTimeout(() => setImagenDesc(null), 1500);
    }
  };

  if (!acta) return null;

  // Fase B (§6 — coherencia de display): clasificación AUTO resuelta → la
  // REVISIÓN muestra la ubicación REAL (tipo/mesa/página del acta).
  const clasifAuto = acta.clasificacion?.nivel === "AUTO" ? acta.clasificacion : null;
  // KIT consenso-frankfurt-v1 (FASE 5, §6.1): chip de tipo HONESTO —
  // PROHIBIDO paginaObjetivo?.tipo (era el tipo del HUECO donde CAYÓ
  // archivada la acta, no el del acta: el «DELEGADOS» falso del dueño con
  // Frankfurt 746). Sin clasifAuto → tipoDeBanda sobre el OCR; tampoco →
  // «---» (mismo estilo que MESA ---).
  const tipoBanda = tipoDeBanda(acta.ocrTexto ?? "");
  const tipoTexto = (t: TipoCopia | null | undefined): string =>
    t ? (t === "TRANSMISION" ? "TRANSMISIÓN" : "DELEGADOS") : "---";
  const tipo = clasifAuto?.tipo ? tipoTexto(clasifAuto.tipo) : tipoTexto(tipoBanda);
  // KIT actas-vivas-paginas-v1 (FASE B): paginaIdentificada exige página
  // LEÍDA — clasificación sin página (acta.pagina == null) → chip «PÁG -
  // DE -» (honesto; el default P1 mintió con la pág 2 de Frankfurt, bug
  // del dueño 16-oct). Con página leída sigue mostrando PÁG X DE Y.
  const paginaIdx = clasifAuto ? (clasifAuto.pagina?.index ?? 1) : (acta.pagina?.index ?? 1);
  const paginaTotal = clasifAuto ? (clasifAuto.pagina?.total ?? 2) : (acta.pagina?.total ?? 2);
  const status = acta.status;
  // D2/D3 Rev. 2: «---» = fallback SOLO cuando el sistema NO logra
  // identificar. UN solo predicado compartido por banner + chips.
  const hayClasificacion =
    acta.clasificacion != null && acta.clasificacion.nivel !== "MANUAL";
  const paginaIdentificada = acta.clasificacion != null && acta.pagina != null;
  // ── Banner de ubicación (mock §3.2.2): dot del color del estado + texto
  // uppercase real. Fix del dueño (14-oct) #1: el banner es el NOMBRE DEL
  // PUESTO (acta.titulo) — nunca la ruta con «>».
  const dotUbicacion = hayClasificacion
    ? "bg-brand-green"
    : status === "EN_REVISION_HUMANA"
      ? "bg-amber-400"
      : "bg-red-500";
  const textoBanner = (() => {
    // Fix del dueño (14-oct) #1: banner = nombre del puesto (p. ej.
    // «FRANKFURT - CONSULADO»), NUNCA la ruta construida a mano
    // (departamento > municipio > puesto > MESA > …). Sin clasificación
    // → estados de fallback de siempre.
    if (hayClasificacion) return acta.titulo;
    return status === "EN_REVISION_HUMANA"
      ? "CLASIFICACIÓN PENDIENTE"
      : "NO IDENTIFICADO";
  })();

  // ── Chips (mock §3.2.3): chip 1 = TONO del estado (sólido), chips 2-3
  // neutros. Mismas fuentes de datos de siempre (parciales incluidas).
  const toneEstado =
    status === "RECHAZADA"
      ? "crit"
      : status === "ADVERTENCIA" || status === "EN_REVISION_HUMANA"
        ? "warn"
        : "ok";
  // §D2 (SPEC-e14-score-ocr): lectura PARCIAL de MESA (display-only).
  const mesaParcial =
    !clasifAuto && acta.clasificacion?.parciales?.mesa != null
      ? acta.clasificacion.parciales.mesa
      : null;
  // §D4 (SPEC-e14-score-ocr): el visor NUNCA queda vacío — sin
  // fotoProcesada (detección con excepción/timeout) o procesada SIN tinta
  // (warp degenerado sobre superficie lisa → blanco puro) se muestra la
  // ORIGINAL con nota tenue. Con tinta (aunque poca, p. ej. la borrosa
  // B/N) se muestra la procesada como hoy — sin regresión.
  const fotoSinTinta = !acta.fotoProcesada || acta.procesadaVacia === true;
  const fotoVisible = fotoSinTinta
    ? (acta.fotoOriginal ?? acta.fotoProcesada)
    : acta.fotoProcesada;
  const mostrandoOriginal = fotoSinTinta && Boolean(acta.fotoOriginal);
  // §D8.4/AC4/AC14 (SPEC-e14-score-ocr Rev. 3) + SERIE 1 (sync-visor
  // §3): contain UNIVERSAL (REV. 2 — visor invariante por score; el
  // precedente as-is ya lo estrenó). El warp real produce un acta ALTA
  // (aspecto de página ~0.46–0.7) y la tarjeta flex-1 tiene otro aspecto →
  // object-cover escalaba a llenar y RECORTABA arriba/abajo (bug «la imagen
  // se ve GRANDE y CORTADA»). Con contain aparece letterboxing vertical:
  // la carta de papel blanca COMPLETA dentro del contenedor oscuro.
  const hayFoto = Boolean(fotoVisible);
  const altFoto = mostrandoOriginal
    ? "Foto original del acta (la procesada salió vacía)"
    : "Foto real del acta procesada por el core";
  // D35: SIMULACIÓN produce fotos reales (pipeline real) — el gate es la foto, no la fuente.
  // §D4: cualquier foto (procesada u original de respaldo) = acta real.
  const esReal = Boolean(fotoVisible);
  // F-OCR (§F1.2, D39): TEXTO activo cuando ya hay texto válido (el pipeline
  // corre el OCR SIEMPRE — §1 del spec; OCR_NO_TEXT distingue el vacío que
  // pudo dejar el pipeline: ocr.ts L12 del core, PROHIBIDO re-declararlo).
  const hayTexto = Boolean(acta.ocrTexto) && acta.ocrTexto !== OCR_NO_TEXT;

  // ── Esquinas AR (mock §3.3): verdes (óptima/enviada) · rojas (rechazada)
  // · ámbar (advertencia/EN_RH) — mismo predicado del tono de estado.
  const cornerColor =
    status === "RECHAZADA"
      ? "#E52222"
      : status === "ADVERTENCIA" || status === "EN_REVISION_HUMANA"
        ? "#F59E0B"
        : undefined; // verde (default del CSS del ZIP)

  // ── PÍLDORA FLOTANTE de la tarjeta (mock §3.2.4/§3.3): el MOTIVO REAL
  // (rechazo D1/PR #33 · parcial de Rev. 2 · razón de advertencia).
  // Fix del dueño (14-oct) #2: ÓPTIMA/ENVIADA también llevan píldora —
  // la tarjeta del óptimo tiene el mismo tratamiento que medio/bajo.
  const pillFlotante = (() => {
    if (status === "RECHAZADA") {
      if (acta.rechazo?.tipo === "INCOMPLETA")
        return { texto: `ACTA INCOMPLETA${acta.rechazo.detalle ? ` · ${acta.rechazo.detalle}` : ""}`, tono: "crit" as const };
      if (acta.rechazo?.tipo === "BAJO")
        return { texto: `SCORE BAJO${acta.rechazo.detalle ? ` · ${acta.rechazo.detalle}` : ""}`, tono: "crit" as const };
      // KIT e14-gate-v2 (G2): marcador obligatorio de votos fallido — copy
      // CORTO y descriptivo (decisión del dueño: SIN guía de cámara).
      if (acta.rechazo?.tipo === "SIN_VOTOS")
        return { texto: "ACTA SIN VOTOS", tono: "crit" as const };
      return { texto: "ACTA RECHAZADA", tono: "crit" as const };
    }
    if (status === "ADVERTENCIA") {
      // KIT actas-vivas-paginas-v1 (FASE C): el RECORTE del papel (OCR de
      // secciones) manda sobre las razones genéricas del medidor — el
      // operador debe ver que FALTA PAPEL (decisión: también sobre
      // LECTURA PARCIAL — el defecto físico es lo urgente de comunicar).
      if (acta.recortada)
        return {
          // KIT identificacion-codigo-v1 (FASE F): cuando la señal de esquinas
          // detectó el recorte, el aviso lleva el LADO («ACTA RECORTADA ·
          // SUP-IZQ») — pill/pill-texto existente GANA (§5 del kit).
          texto: acta.recorteLado
            ? `ACTA RECORTADA · ${acta.recorteLado.toUpperCase()}`
            : "ACTA RECORTADA",
          tono: "warn" as const,
        };
      if (mesaParcial != null) return { texto: "LECTURA PARCIAL", tono: "warn" as const };
      const m = acta.metricas;
      if (m) {
        const razon =
          m.sharpness <= m.contrast && m.sharpness <= m.brightness
            ? "LEVE DESFOQUE"
            : m.contrast <= m.brightness
              ? "CONTRASTE"
              : "LUMINOSIDAD";
        return { texto: razon, tono: "warn" as const };
      }
      return null;
    }
    // Fix del dueño (14-oct) #2: píldora verde para ÓPTIMA/ENVIADA.
    if (status === "OPTIMA" || status === "ENVIADA") return { texto: `✓ ${acta.score.toFixed(1)}/10 ÓPTIMA`, tono: "ok" as const };
    return null;
  })();

  // Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx L1446-1455
  // (copyOcrText). D2 redesign-stitch §4.3: feedback en el PROPIO botón.
  const copiarTexto = async () => {
    const text = acta.ocrTexto ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiado("ok");
    } catch {
      setCopiado("err");
    }
    window.setTimeout(() => setCopiado(null), 1500);
  };

  // F-OCR (§F2, D39): el estado "corriendo" es LOCAL — envuelve el store
  // action y lo apaga SIEMPRE (finally).
  const ejecutarOcr = async () => {
    setOcrEjecutando(true);
    try {
      await reconocerTextoActa();
    } finally {
      setOcrEjecutando(false);
    }
  };

  // KIT visor-accion-score-v1 (FASE A+B) — fila de acciones calculada FUERA
  // del flujo: vive en la ZONA FIJA de abajo (nunca scrollea; pegada a los
  // CTAs/BottomNav del shell — page.tsx intocable). FASE A: el botón
  // «Pantalla completa» sale (redundante — tocar la foto abre el visor vía
  // ZoomableVisor mode="card" onOpenFullscreen y la tarjeta ENVIADA es
  // táctil); el modal fullscreen SIGUE existiendo con el mismo punto de
  // entrada. ENVIADA → null: la zona fija NO se monta (sin toolbar fantasma).
  const filaAcciones =
    status === "OPTIMA" && esReal ? (
      // Rama OPTIMA (defensa G4 — transitoria, inalcanzable en REVISIÓN):
      // Recortar · Rotar 90° · Filtros · Imagen · Texto (5). Handlers intactos.
      <div className="grid grid-cols-3 gap-2 w-full select-none">
        <ToolbarBtn
          icon={<StitchCropIcon />}
          label="Recortar"
          onClick={esReal && acta.fotoOriginal ? () => setEditando(true) : undefined}
        />
        <ToolbarBtn
          icon={<StitchRotateIcon />}
          label="Rotar 90°"
          onClick={esReal ? () => void rotarFoto() : undefined}
        />
        <ToolbarBtn
          icon={<SlidersIcon />}
          label="Filtros"
          onClick={
            esReal && acta.fotoOriginal && !revelando
              ? () => setFiltrosAbierto(true)
              : undefined
          }
        />
        <ToolbarBtn
          icon={<DownloadIcon />}
          label={imagenDesc === "ok" ? "Descargada ✓" : imagenDesc === "err" ? "No se pudo" : "Imagen"}
          onClick={
            acta.fotoProcesada
              ? () => void descargarImagen()
              : undefined
          }
        />
        <ToolbarBtn
          icon={<ScanTextIcon />}
          label="Texto"
          active={hayTexto}
          onClick={
            acta.fotoProcesada && !ocrEjecutando
              ? () => setTextoAbierto(true)
              : undefined
          }
        />
      </div>
    ) : status !== "ENVIADA" ? (
      // Resto de estados: Recortar · Rotar 90° · Imagen — UNA sola fila de 3
      // (grid-cols-3; la 4ª celda que forzaba segunda fila murió con la FASE A).
      // KIT e14-diagnostico-autoenvio-v1 (C4): con acta.diagnostico presente
      // y status ≠ ENVIADA, 4ª celda compacta «DIAGNÓSTICO ↓» (grid-cols-4) —
      // red de seguridad OBLIGATORIA §9.1 (re-descarga del ZIP del desenlace).
      <div
        className={`grid gap-2 w-full select-none ${
          acta.diagnostico ? "grid-cols-4" : "grid-cols-3"
        }`}
      >
        <ToolbarBtn
          icon={<StitchCropIcon />}
          label="Recortar"
          onClick={esReal && acta.fotoOriginal ? () => setEditando(true) : undefined}
        />
        <ToolbarBtn
          icon={<StitchRotateIcon />}
          label="Rotar 90°"
          onClick={acta.fotoProcesada ? () => void rotarFoto() : undefined}
        />
        <ToolbarBtn
          icon={<DownloadIcon />}
          label={imagenDesc === "ok" ? "Descargada ✓" : imagenDesc === "err" ? "No se pudo" : "Imagen"}
          aria-label="Descargar imagen en alta calidad"
          onClick={
            acta.fotoProcesada
              ? () => void descargarImagen()
              : undefined
          }
        />
        {acta.diagnostico && (
          <ToolbarBtn
            icon={<DownloadIcon />}
            label={
              diagDesc === "ok"
                ? "Descargado ✓"
                : diagDesc === "err"
                  ? "No se pudo"
                  : "Diagnóstico"
            }
            aria-label="Descargar paquete de diagnóstico ZIP"
            onClick={() => {
              const r = descargarPaqueteDiagnostico(acta);
              setDiagDesc(r.ok ? "ok" : "err");
              if (r.ok) setTimeout(() => setDiagDesc(null), 2500);
            }}
          />
        )}
      </div>
    ) : null;

  return (
    // KIT visor-accion-score-v1 (FASE B): root en 2 ZONAS — scroll + barra
    // de acciones FIJA abajo. Shell (page.tsx: h-dvh + main flex-1 min-h-0)
    // INTOCABLE; único overflow-y-auto (sin scroll duplicado).
    <div className="flex-1 min-h-0 flex flex-col">
      {/* ZONA SCROLL — contenido de siempre, MISMO orden (banner + chips +
          tarjeta + nota + bloque ENVIADO + panel). max-w-md centrado aquí y
          en la zona fija: el centrado no baile. */}
      <div className="flex-1 min-h-0 overflow-y-auto max-w-md mx-auto w-full px-4 py-3 space-y-3">
        {/* Banner de ubicación (mock §3.2.2 — mono, dot del estado). */}
        {status === "ENVIADA" || status === "OPTIMA" ? (
          <div className="flex items-center px-3 py-1.5 rounded-xl bg-brand-surfacelight border border-brand-border text-[10px] font-mono shadow-sm overflow-x-auto no-scrollbar">
            <span className="text-brand-green font-bold tracking-wider whitespace-nowrap uppercase truncate">
              {textoBanner}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-brand-surfacelight border border-brand-border text-xs font-mono shadow-sm">
            <div className="flex items-center gap-2 truncate">
              <span className={`w-2 h-2 rounded-full shrink-0 ${dotUbicacion}`} />
              <span className="text-[11px] font-bold tracking-wider text-white uppercase truncate">
                {textoBanner}
              </span>
            </div>
          </div>
        )}

        {/* Chips de estado (mock §3.2.3 — grid-cols-3, activo sólido). */}
        <div className="grid grid-cols-3 gap-2 w-full select-none">
          <Chip tone={toneEstado} solid>
            {tipo}
          </Chip>
          <Chip tone="neutral">
            {clasifAuto ? (
              `MESA ${acta.ubicacion.mesa}`
            ) : mesaParcial != null ? (
              <>
                {`MESA ${String(mesaParcial).padStart(3, "0")}`}
                <span
                  className="ml-1 text-[9px] font-bold tracking-[0.1em] text-gray-400"
                  title="Lectura parcial del OCR — sin validar contra DIVIPOL"
                >
                  · PARCIAL
                </span>
              </>
            ) : hayClasificacion ? (
              `MESA ${acta.ubicacion.mesa}`
            ) : (
              "MESA ---"
            )}
          </Chip>
          <Chip tone="neutral">
            {paginaIdentificada ? `PÁG ${paginaIdx} DE ${paginaTotal}` : "PÁG - DE -"}
          </Chip>
        </div>

        {/* KIT consenso-frankfurt-v1 (Task 122, FASE 5 §6.2): LÍNEA DE ID —
            kit FINAL (pie/código/registro, §4.2) + tipo leído + página +
            FUENTE real de la procedencia. Sin kit → «KIT ---» (nunca
            inventar); tipo/página desconocidas → «---»/«-/-». El chip
            MESA · POR KIT se conserva (§6.3: todo lo demás SIN CAMBIO). */}
        {(() => {
          const cl = acta.clasificacion;
          const kitTxt = cl?.kit != null ? `KIT ${cl.kit}` : "KIT ---";
          const tipoId = cl?.tipo ? tipoTexto(cl.tipo) : tipoTexto(tipoBanda);
          // Misma HONESTIDAD que el chip PÁG (§6.3): sin clasificación la
          // página mostrada sería la del HUECO asignado, no la LEÍDA → "-/-".
          const pagId = paginaIdentificada ? { index: paginaIdx, total: paginaTotal } : null;
          const fuenteTxt =
            cl?.kitFuente === "PIE"
              ? "PIE"
              : cl?.kitFuente === "CODIGO"
                ? "CÓDIGO"
                : cl?.kitFuente === "REGISTRO"
                  ? "REGISTRO"
                  : "---";
          const mesaPorKit = cl?.avisos?.includes("MESA_POR_KIT") ?? false;
          return (
            <div className="grid gap-2 w-full select-none">
              <Chip tone="neutral">
                {`${kitTxt} · ${tipoId} · ${pagId ? `${pagId.index}/${pagId.total}` : "-/-"}`}
                <span
                  className="ml-1 text-[9px] font-bold tracking-[0.1em] text-gray-400"
                  title="Procedencia del KIT: pie impreso (PIE) · código 1D (CÓDIGO) · registro KIT→mesa (REGISTRO)"
                >
                  {`· ${fuenteTxt}`}
                </span>
              </Chip>
              {mesaPorKit && (
                <Chip tone="neutral">
                  {`MESA ${String(cl?.mesa ?? 0).padStart(3, "0")}`}
                  <span
                    className="ml-1 text-[9px] font-bold tracking-[0.1em] text-gray-400"
                    title="Mesa recuperada del registro KIT→mesa (cabecera sin MESA legible)"
                  >
                    · POR KIT
                  </span>
                </Chip>
              )}
            </div>
          );
        })()}

        {/* G4 (KIT e14-gate-v2): el banner informativo del envío manual
            fue ELIMINADO — el recorte es un flujo NORMAL: re-evalúa y si
            da OPTIMA se auto-envía (aplicarRecorte → mismo camino de
            analisisCompletado). OPTIMA es un estado TRANSITORIO: nunca se
            renderiza en REVISIÓN. */}

        {/* EN_RH (no cubierto por mocks — §2): banners informativos
            «repetir-primero» / contingencia, re-vestidos con tokens ámbar. */}
        {status === "EN_REVISION_HUMANA" && (
          <div className="rounded-xl bg-amber-950/60 border border-amber-500 px-3.5 py-2.5 flex items-center gap-2.5">
            <WarnTriangleIcon className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="font-mono text-[11px] font-bold tracking-wide uppercase text-white">
                {acta.intento < acta.maxIntentos
                  ? "CLASIFICACIÓN PENDIENTE"
                  : "ENVIADA A REVISIÓN HUMANA"}
              </span>
              <span className="text-[10px] text-gray-400 font-mono">
                {acta.intento < acta.maxIntentos
                  ? `Repita la foto para clasificarla automáticamente · INTENTO ${acta.intento} DE ${acta.maxIntentos}`
                  : "Un auditor validará esta acta"}
              </span>
            </div>
          </div>
        )}

        {/* Tarjeta del acta (mock §3.2.4): contenedor surface + esquinas AR
            del color del estado + PÍLDORA FLOTANTE con el motivo real +
            LA FOTO REAL (rounded-lg border-gray-300, §3.5/AC7 — el
            formulario dibujado del mock NO se porta). La tarjeta de
            ENVIADA es táctil (abre el visor fullscreen — ZoomableVisor). */}
        {status === "ENVIADA" ? (
          <div
            role="button"
            aria-label="Ver acta a pantalla completa"
            tabIndex={hayFoto ? 0 : -1}
            onKeyDown={
              hayFoto
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setVisorAbierto(true);
                    }
                  }
                : undefined
            }
            className="relative bg-brand-surface rounded-2xl p-2.5 border border-brand-border shadow-xl w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60"
          >
            {pillFlotante && (
              <span
                data-testid="barra-rechazo"
                className={`absolute -top-2.5 left-1/2 -translate-x-1/2 z-10 font-mono font-extrabold text-[9px] px-2.5 py-1 rounded uppercase tracking-wider whitespace-nowrap max-w-[92%] truncate shadow ${
                  // Fix del dueño (14-oct) #3: tono ok → verde (bg-brand-green).
                  pillFlotante.tono === "crit"
                    ? "bg-[#E52222] text-white"
                    : pillFlotante.tono === "ok"
                      ? "bg-brand-green text-black"
                      : "bg-[#F59E0B] text-black"
                }`}
              >
                {pillFlotante.texto}
              </span>
            )}
            <div className="scanner-corner-tl" style={cornerColor ? { borderColor: cornerColor } : undefined} />
            <div className="scanner-corner-tr" style={cornerColor ? { borderColor: cornerColor } : undefined} />
            <div className="scanner-corner-bl" style={cornerColor ? { borderColor: cornerColor } : undefined} />
            <div className="scanner-corner-br" style={cornerColor ? { borderColor: cornerColor } : undefined} />
            {fotoVisible ? (
              // G8 (KIT camara-visor-v1): altura DEFINIDA (patrón exacto del
              // lab — FIX v3 1.1 de PresentationView L520-531: iOS Safari no
              // resuelve `max-height:100%` contra padre auto). Con padre de
              // altura definida el stage `h-full` del paquete queda estable
              // y la imagen gira DENTRO vía object-contain — ROTAR deja de
              // mover el marco. NO se toca ZoomableVisor del paquete (pan a
              // 1× en card exigiría publicación npm — fuera de alcance).
              // KIT visor-accion-score-v1 (FASE B): 420px → 56vh — la tarjeta
              // crece con el viewport (AC-B2). INVARIANTE G8 intacto: altura
              // DEFINIDA en px/vh, JAMÁS derivada del aspecto de la imagen —
              // ROTAR 90° no mueve el marco.
              <div className="w-full h-[56vh] min-h-[340px] max-h-[640px] relative flex items-center justify-center mt-2">
                <ZoomableVisor
                  mode="card"
                  src={fotoVisible}
                  alt={altFoto}
                  onOpenFullscreen={() => setVisorAbierto(true)}
                />
              </div>
            ) : (
              <div className="mt-2 rounded-lg border border-gray-300 bg-brand-black h-48 flex items-center justify-center">
                <span className="font-mono text-[10px] tracking-widest text-gray-500 uppercase">
                  FOTO NO DISPONIBLE
                </span>
              </div>
            )}
          </div>
        ) : (
          <div
            role="button"
            aria-label="Ver acta a pantalla completa"
            tabIndex={hayFoto ? 0 : -1}
            onKeyDown={
              hayFoto
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setVisorAbierto(true);
                    }
                  }
                : undefined
            }
            className="relative bg-brand-surface rounded-2xl p-2.5 border border-brand-border shadow-xl w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60"
          >
            {pillFlotante && (
              <span
                // Fix del dueño (14-oct) #4: data-testid honesto (solo la
                // RECHAZADA es barra-rechazo; el resto es banner-revision).
                data-testid={status === "RECHAZADA" ? "barra-rechazo" : "banner-revision"}
                className={`absolute -top-2.5 left-1/2 -translate-x-1/2 z-10 font-mono font-extrabold text-[9px] px-2.5 py-1 rounded uppercase tracking-wider whitespace-nowrap max-w-[92%] truncate shadow ${
                  // Fix del dueño (14-oct) #3: tono ok → verde (bg-brand-green).
                  pillFlotante.tono === "crit"
                    ? "bg-[#E52222] text-white"
                    : pillFlotante.tono === "ok"
                      ? "bg-brand-green text-black"
                      : "bg-[#F59E0B] text-black"
                }`}
              >
                {pillFlotante.texto}
              </span>
            )}
            <div className="scanner-corner-tl" style={cornerColor ? { borderColor: cornerColor } : undefined} />
            <div className="scanner-corner-tr" style={cornerColor ? { borderColor: cornerColor } : undefined} />
            <div className="scanner-corner-bl" style={cornerColor ? { borderColor: cornerColor } : undefined} />
            <div className="scanner-corner-br" style={cornerColor ? { borderColor: cornerColor } : undefined} />
            {fotoVisible ? (
              // G8: misma altura definida (2º wrapper del visor de card) —
              // FASE B: mismo valor 56vh en ambos (invariante G8 intacto).
              <div className="w-full h-[56vh] min-h-[340px] max-h-[640px] relative flex items-center justify-center mt-2">
                <ZoomableVisor
                  mode="card"
                  src={fotoVisible}
                  alt={altFoto}
                  onOpenFullscreen={() => setVisorAbierto(true)}
                />
              </div>
            ) : (
              <div className="mt-2 rounded-lg border border-gray-300 bg-brand-black h-48 flex items-center justify-center">
                <span className="font-mono text-[10px] tracking-widest text-gray-500 uppercase">
                  FOTO NO DISPONIBLE
                </span>
              </div>
            )}
          </div>
        )}

        {/* §D4: nota tenue del respaldo — la tarjeta muestra la ORIGINAL
            porque la procesada salió vacía. */}
        {mostrandoOriginal && (
          <p className="text-center font-mono text-[9px] font-bold tracking-[0.18em] text-gray-400 uppercase">
            SE MUESTRA LA FOTO ORIGINAL
          </p>
        )}

        {/* Bloque ENVIADO (mock 6 §3.2.7 — solo ENVIADA): «✓ ENVIADO
            AUTOMÁTICAMENTE» + chip de la hora real del envío. */}
        {status === "ENVIADA" && (
          <div className="bg-brand-greendark/60 border border-brand-green/60 rounded-xl px-3.5 py-2 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-brand-green font-bold text-xs shrink-0">✓</span>
              <span className="text-brand-green font-bold text-[11px] uppercase tracking-wider font-mono truncate">
                {acta.enviadoAutomaticamente ? "ENVIADO AUTOMÁTICAMENTE" : "ENVIADO CORRECTAMENTE"}
              </span>
            </div>
            <span className="font-mono text-xs text-white font-bold bg-black/60 px-2.5 py-1 rounded-md border border-brand-border shrink-0">
              {acta.enviadoAutomaticamente ?? "--:--:--"}
            </span>
          </div>
        )}

        {/* ── PANEL DE CORRECCIÓN §5 (SPEC-cabecera-clasificacion): SOLO
            EN_REVISION_HUMANA con clasificación PENDIENTE al AGOTAR
            intentos. Lógica intacta. */}
        {status === "EN_REVISION_HUMANA" &&
          acta.intento >= acta.maxIntentos &&
          acta.clasificacion &&
          acta.clasificacion.nivel !== "AUTO" && <PanelClasificacion />}
      </div>

      {/* ZONA FIJA (FASE B) — fila de acciones SIEMPRE pegada abajo (encima
          de los CTAs/BottomNav del shell), NUNCA hace scroll. ENVIADA →
          filaAcciones=null → la zona no se monta: la tarjeta hereda el
          espacio (sin toolbar fantasma). */}
      {filaAcciones && (
        <div className="shrink-0 max-w-md mx-auto w-full px-4 pb-1 pt-2">
          {filaAcciones}
        </div>
      )}

      {/* L5 §7.5 — EDITOR DE RECORTE (overlay a pantalla completa).
          Puro por props (D19). INTACTO — solo re-vestido por QuadEditor. */}
      {editando && acta.fotoOriginal ? (
        <QuadEditor
          fotoOriginal={acta.fotoOriginal}
          // KIT e14-luz-sim-puntos-v1 (T-E): RECHAZADA = la detección ya
          // falló una vez (importadas: franja Sobel degenerada — ZIPs A56)
          // → NO se devuelve al dueño el quad fracasado como punto de
          // partida: el marco completo (puntos a arrastrar al papel).
          // ADVERTENCIA conserva quadDetectado (la detección acertó el
          // marco; solo hay que corregir una esquina).
          quadInicial={acta.status === "RECHAZADA" ? defaultQuad() : (acta.quadDetectado ?? defaultQuad())}
          rotation={acta.rotation ?? 0}
          aplicando={recortando}
          onCancelar={() => setEditando(false)}
          onAplicar={(quad, rotacion) => {
            void aplicarRecorte(quad, rotacion).then(() => setEditando(false));
          }}
        />
      ) : null}

      {/* ── F2 (§F2.2) — SHEET DE FILTROS (copia del lab, re-vestida con
          tokens Stitch: ok-tint → brand-green, surface-1 → brand-surface). */}
      {filtrosAbierto && acta.fotoOriginal ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setFiltrosAbierto(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-label="Filtros del acta"
            className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-[22px] bg-brand-surface pb-safe outline-none animate-editor-enter"
          >
            <div className="mx-auto mt-2.5 h-1.5 w-9 rounded-full bg-white/25" />
            <h3 className="px-5 pb-1 pt-3 text-center text-[17px] font-semibold text-white">
              Filtros
            </h3>
            <p className="sr-only">Elige un filtro para el acta en edición</p>
            <div className="flex gap-3 overflow-x-auto px-5 pb-5 pt-2 no-scrollbar">
              {FILTER_PRESETS.map((f) => {
                const activo = acta.filtro === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      void cambiarFiltro(f.id);
                      setFiltrosAbierto(false);
                    }}
                    className="flex w-[78px] shrink-0 flex-col items-center gap-1.5"
                  >
                    <span
                      className={`block h-[104px] w-full overflow-hidden rounded-xl border-2 ${
                        activo
                          ? "border-brand-green shadow-[0_0_0_3px_rgba(0,230,118,0.25)]"
                          : "border-white/10"
                      }`}
                    >
                      <img
                        src={acta.fotoOriginal}
                        alt=""
                        draggable={false}
                        style={{ filter: CSS_FILTERS[f.id] ?? "none" }}
                        className="h-full w-full object-cover"
                      />
                    </span>
                    <span
                      className={`text-[11px] ${
                        activo ? "font-medium text-white" : "text-gray-500"
                      }`}
                    >
                      {f.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      {/* ── F-OCR (§F3, D39) — SHEET «TEXTO RECONOCIDO» (copia del lab,
          re-vestida con tokens Stitch; feedback de COPIAR en el botón). */}
      {textoAbierto && acta ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setTextoAbierto(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-label="Texto reconocido del acta"
            className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-[22px] bg-brand-surface pb-safe outline-none animate-editor-enter"
          >
            <div className="mx-auto mt-2.5 h-1.5 w-9 rounded-full bg-white/25" />
            <h3 className="flex items-center justify-center gap-2 px-5 pb-1 pt-3 text-center text-[17px] font-semibold text-white">
              <ScanTextIcon className="size-[18px] text-brand-green" />
              Texto reconocido
            </h3>
            <p className="sr-only">Texto extraído por OCR del acta</p>

            <div className="px-5 pb-4 pt-1">
              {ocrEjecutando ? (
                <div className="flex min-h-[140px] flex-col items-center justify-center gap-3">
                  <LoaderIcon className="h-6 w-6 animate-spin text-brand-green" />
                  <span className="text-[13px] font-medium text-white/70">
                    Reconociendo texto…
                  </span>
                </div>
              ) : hayTexto ? (
                <>
                  <div className="max-h-[38vh] overflow-y-auto rounded-xl bg-black/40 p-3.5 ring-1 ring-inset ring-brand-border thin-scroll">
                    <OcrHighlightedText text={acta.ocrTexto ?? ""} query={null} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 px-0.5">
                    <span className="rounded-full bg-white/8 px-2.5 py-1 text-[11.5px] font-medium tabular-nums text-white/60">
                      {ocrStats.words} {ocrStats.words === 1 ? "palabra" : "palabras"}
                    </span>
                    <span className="rounded-full bg-white/8 px-2.5 py-1 text-[11.5px] font-medium tabular-nums text-white/60">
                      {ocrStats.chars} {ocrStats.chars === 1 ? "carácter" : "caracteres"}
                    </span>
                  </div>
                  <div className="mt-3 flex gap-2.5">
                    <button
                      type="button"
                      onClick={() => void ejecutarOcr()}
                      className="flex-1 rounded-full bg-white/10 py-2.5 text-[14px] font-semibold text-white/90 ring-1 ring-inset ring-white/15 transition-all active:scale-[0.97]"
                    >
                      Reconocer de nuevo
                    </button>
                    <button
                      type="button"
                      onClick={() => void copiarTexto()}
                      className={`flex flex-[1.3] items-center justify-center gap-1.5 rounded-full py-2.5 text-[14px] font-semibold transition-all active:scale-[0.97] ${
                        copiado === "ok"
                          ? "bg-brand-green text-black shadow-[0_4px_16px_rgba(0,230,118,0.4)]"
                          : copiado === "err"
                            ? "bg-red-500/80 text-white"
                            : "bg-brand-green text-black shadow-[0_4px_16px_rgba(0,230,118,0.4)]"
                      }`}
                    >
                      <CopyIcon className="size-4" />
                      {copiado === "ok"
                        ? "COPIADO ✓"
                        : copiado === "err"
                          ? "NO SE PUDO COPIAR"
                          : "Copiar texto"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex min-h-[140px] flex-col items-center justify-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/8">
                    <ScanTextIcon className="h-6 w-6 text-gray-500" />
                  </div>
                  <span className="max-w-[260px] text-center text-[13px] leading-snug text-gray-500">
                    Extrae el texto del acta para copiarlo.
                  </span>
                  <button
                    type="button"
                    onClick={() => void ejecutarOcr()}
                    className="rounded-full bg-brand-green px-6 py-2.5 text-[14px] font-semibold text-black shadow-[0_4px_16px_rgba(0,230,118,0.4)] transition-all active:scale-[0.97]"
                  >
                    Reconocer texto
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}

      {/* L5 §7 — PANTALLA COMPLETA: visor modal con F-ZOOM (SERIE 1
          e14-sync-visor §4 — COPIA del stage del lab): pinza 1×–6×
          anclada · pan con clamps · doble toque 2,5× · rueda · F-COMPARE
          manteniendo pulsado (si hay original) · chip % + RESTABLECER ·
          hint 6 s. Se conservan el role=dialog, el fondo bg-black/90 y
          Esc (efecto de arriba); el cierre por toque lo decide el
          ZoomableVisor (tap-fuera inmediato · tap sobre la imagen a 1×
          diferido 320 ms para no matar el doble toque). */}
      {visorAbierto && fotoVisible ? (
        <div
          role="dialog"
          aria-label="Foto del acta a pantalla completa"
          className="fixed inset-0 z-50 bg-black/90 animate-editor-enter"
        >
          <ZoomableVisor
            src={fotoVisible}
            alt={altFoto}
            compareSrc={
              acta.fotoOriginal != null && acta.fotoOriginal !== fotoVisible
                ? acta.fotoOriginal
                : undefined
            }
            onClose={() => setVisorAbierto(false)}
          />
          <span className="pointer-events-none absolute top-3 inset-x-0 text-center font-mono text-[9px] tracking-[0.2em] text-gray-400 uppercase">
            Toca o ESC para cerrar
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** CTAs del footer por estado (anclan sobre el BottomNav, §7.4/§7.5). */

// Candado del botón manual (D6-bis Rev. 4): «repetidamente» ≈ 3 capturas
// rechazadas del ciclo. Con maxIntentos = 4, la ventana es la pantalla
// «INTENTO 3 DE 4». Tunable: un solo número.
const UMBRAL_REVISION_HUMANA = 3;

/** D6-bis (Rev. 4, DEV-2): escalación manual — SOLO se monta con el candado
 *  abierto (puedeEscalar). STITCH (§3.2.6): surface/border + icono lupa-ojo
 *  del mock rechazada_2 (en ADVERTENCIA también surface — consolidación del
 *  spec sobre el mock 5 ámbar; decisión documentada). */
function BtnRevisionHumana({ onClick }: { onClick: () => void }) {
  return (
    <PrimaryBtn
      variant="outline"
      onClick={onClick}
      icon={<StitchEyeIcon className="w-4 h-4" />}
      ariaLabel="Enviar esta acta a revisión humana"
    >
      <span>REVISIÓN HUMANA</span>
    </PrimaryBtn>
  );
}

/** Badge azul de refresco de los CTAs de REPETIR (mock §3.2.6 — ZIP
 *  literal: w-5/6 h-5/6 rounded-md bg-blue-600/80 border-blue-400 + SVG
 *  rotate animate-spin). */
function BadgeRefresco({ size = 6 }: { size?: 5 | 6 }) {
  return (
    <span
      className={`${
        size === 6 ? "w-6 h-6" : "w-5 h-5"
      } rounded-md bg-blue-600/80 border border-blue-400 flex items-center justify-center shrink-0`}
      aria-hidden
    >
      <StitchSpinIcon className={size === 6 ? "w-3.5 h-3.5" : "w-3 h-3"} />
    </span>
  );
}

export function ReviewCtas() {
  const acta = useE14Store((s) => s.actaActual);
  const navegar = useE14Store((s) => s.navegar);
  // G4 (KIT e14-gate-v2): el selector enviarActa se retiró — la ÓPTIMA ya
  // no llega a REVISIÓN (se auto-envía al capturar y tras el recorte), y
  // el envío MANUAL solo existe para ADVERTENCIA vía REVISIÓN HUMANA.
  const repetirFoto = useE14Store((s) => s.repetirFoto);
  // Selector extra + candado (una sola fuente de verdad):
  const escalarRevisionHumana = useE14Store((s) => s.escalarRevisionHumana);

  if (!acta) return null;
  const status = acta.status;
  const puedeEscalar = acta.intento >= UMBRAL_REVISION_HUMANA;

  if (status === "ENVIADA") {
    // Mock 6 §3.2.7: CTA verde «SEGUIR ESCANEANDO» (bg-brand-green,
    // texto NEGRO, glow verde, mono bold uppercase). El flujo es el
    // mismo de siempre: navega a escanear.
    return (
      <button
        type="button"
        onClick={() => navegar("escanear")}
        className="w-full bg-brand-green hover:bg-emerald-400 text-black font-extrabold text-sm py-3.5 px-6 rounded-2xl shadow-[0_4px_20px_rgba(0,230,118,0.35)] flex items-center justify-center gap-2 tap-action transition-all select-none"
      >
        <span className="tracking-wide uppercase font-mono font-bold">
          SEGUIR ESCANEANDO
        </span>
      </button>
    );
  }

  if (status === "ADVERTENCIA") {
    // Mock 4/5 (§2): CTA único ámbar «REPETIR FOTO» (outline ámbar mono);
    // con candado → par [REPETIR FOTO] + [REVISIÓN HUMANA surface].
    return puedeEscalar ? (
      <div className="flex gap-2.5 w-full">
        <button
          type="button"
          onClick={repetirFoto}
          className="flex-1 min-w-0 w-full py-2.5 px-2 rounded-xl bg-brand-surface border border-amber-500/80 hover:bg-brand-surfacelight text-amber-400 font-mono font-bold text-[10px] leading-tight uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-sm tap-action transition-all text-center"
        >
          <StitchRotateIcon className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">REPETIR FOTO</span>
        </button>
        <BtnRevisionHumana onClick={escalarRevisionHumana} />
      </div>
    ) : (
      <div className="flex w-full">
        <button
          type="button"
          onClick={repetirFoto}
          className="w-full py-2.5 px-2 rounded-xl bg-brand-surface border border-amber-500/80 hover:bg-brand-surfacelight text-amber-400 font-mono font-bold text-[10px] leading-tight uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-sm tap-action transition-all text-center"
        >
          <StitchRotateIcon className="w-3.5 h-3.5 shrink-0" />
          <span>REPETIR FOTO</span>
        </button>
      </div>
    );
  }

  if (status === "RECHAZADA") {
    // Mock 2/3 (§2): CTA único rojo «OBLIGATORIO REPETIR FOTO (INTENTO X DE
    // 4)» con badge azul giratorio; con candado → par [REPETIR] +
    // [REVISIÓN HUMANA surface]. «DE 4» = política real (mock dice 3 — §6.2).
    return puedeEscalar ? (
      <div className="flex gap-2.5 w-full">
        <button
          type="button"
          onClick={repetirFoto}
          className="flex-1 min-w-0 bg-[#E52222] hover:bg-red-600 text-white font-black text-xs py-3.5 px-3 rounded-2xl shadow-[0_4px_20px_rgba(229,34,34,0.4)] flex items-center justify-center gap-2 tap-action transition-all uppercase tracking-wider leading-tight text-center"
        >
          <BadgeRefresco size={5} />
          <span>REPETIR</span>
        </button>
        <BtnRevisionHumana onClick={escalarRevisionHumana} />
      </div>
    ) : (
      <div className="flex w-full">
        <button
          type="button"
          id="btn-repeat-scan"
          onClick={repetirFoto}
          className="w-full bg-[#E52222] hover:bg-red-600 text-white font-black text-xs sm:text-sm py-4 px-4 rounded-2xl shadow-[0_4px_20px_rgba(229,34,34,0.4)] flex items-center justify-center gap-2.5 tap-action transition-all uppercase tracking-wider leading-tight text-center"
        >
          <BadgeRefresco size={6} />
          <span>
            OBLIGATORIO REPETIR FOTO (INTENTO {acta.intento} DE {acta.maxIntentos})
          </span>
        </button>
      </div>
    );
  }

  if (status === "EN_REVISION_HUMANA") {
    // §7.3: «repetir-primero» (intento < max): REPETIR CAPTURA;
    // contingencia (intento ≥ max): VOLVER AL ESCÁNER. Re-vestidos
    // (surface/border — mismo orden/ancho, §2 última fila).
    if (acta.intento < acta.maxIntentos) {
      return (
        <div className="flex w-full">
          <PrimaryBtn
            variant="outline"
            onClick={repetirFoto}
            icon={<StitchRotateIcon className="w-3.5 h-3.5" />}
          >
            <span>REPETIR CAPTURA (FOTO MÁS NÍTIDA)</span>
          </PrimaryBtn>
        </div>
      );
    }
    return (
      <div className="flex w-full">
        <PrimaryBtn variant="outline" onClick={() => navegar("escanear")}>
          <span>VOLVER AL ESCÁNER</span>
        </PrimaryBtn>
      </div>
    );
  }

  return null;
}
