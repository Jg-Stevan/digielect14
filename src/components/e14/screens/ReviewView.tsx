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
 * fallback de foto D4, visor F-ZOOM (SERIE 1).
 * C-26 — los sheets Filtros/Texto se retiraron: su ÚNICO punto de entrada
 * era la rama OPTIMA muerta (OPTIMA jamás se renderiza en REVISIÓN —
 * auto-envío D4 al capturar y tras el recorte) → Muerto = fuera (AGENTS.md).
 * D2 (redesign-stitch §4): SIN notificaciones — el feedback vive en la UI
 * persistente (píldoras, banner, píldora flotante, feedback en botón).
 */
import { useEffect, useMemo, useState } from "react";
import { useE14Store } from "@/lib/e14/store";
import { defaultQuad } from "@/lib/e14/fachada";
// G4 (KIT camara-visor-v1): descarga de la foto PROCESADA. downloadBlob y
// sanitizeFileName YA están publicados en el core (pdf-export 0.1.0) —
// dataUrlToBlob NO existe en el tarball (la instrucción la citaba; se porta
// como helper local de 5 líneas con fetch → blob, cero dependencias nuevas).
import { downloadBlob } from "@/lib/e14/core/pdf-export";
import {
  nombreExportacion,
  tipoDeBanda,
  type TipoCopia,
} from "@/lib/e14/fachada";
import { QuadEditor } from "../QuadEditor";
import { ZoomableVisor } from "@/lib/e14/ui/ZoomableVisor";
import { PanelClasificacion } from "../PanelClasificacion";
import { Chip, PrimaryBtn, ToolbarBtn } from "../primitives";
import {
  DownloadIcon,
  WarnTriangleIcon,
  StitchCropIcon,
  StitchRotateIcon,
  StitchEyeIcon,
  StitchSpinIcon,
} from "../icons";

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
  // falso del mantenedor con Frankfurt 746). El chip muestra solo señales REALES
  // del acta (clasifAuto → tipoDeBanda → «---»). El store no se toca: otras
  // pantallas siguen usando su propio selector.
  const recortando = useE14Store((s) => s.recortando);
  const aplicarRecorte = useE14Store((s) => s.aplicarRecorte);
  // KIT e14-recorte-manual-v1 (T2): fallo del recorte VISIBLE — píldora sobre
  // el editor (que NO se cierra en error duro).
  const errorRecorte = useE14Store((s) => s.errorRecorte);
  const rotarFoto = useE14Store((s) => s.rotarFoto);
  // L5 §7.5: editor de recorte y visor a pantalla completa (estado local —
  // el acta solo cambia por store.aplicarRecorte al APLICAR).
  const [editando, setEditando] = useState(false);
  const [visorAbierto, setVisorAbierto] = useState(false);
  // G4 (KIT camara-visor-v1): mismo patrón de feedback — 1.5 s en el botón
  // «Imagen» («DESCARGADA ✓» / «NO SE PUDO»), sin toast flotante.
  const [imagenDesc, setImagenDesc] = useState<"ok" | "err" | null>(null);

  // FIX C3 (auditoría 2-b): quadInicial del editor MEMOIZADO — defaultQuad()
  // es una factory (array NUEVO por render) y el effect de aterrizaje del
  // QuadEditor depende de [quadInicial]: cualquier re-render de REVISIÓN
  // mientras el editor está abierto (errorRecorte al fallar APLICAR,
  // recortando, revelando del upgrade silencioso) re-tweeneaba el quad al
  // marco completo y BORRABA el recorte del usuario (contrato T2 roto:
  // «reintenta SIN perder su quad»). Memoizado: identidad estable mientras
  // status/quadDetectado no cambien de verdad.
  const quadInicialEditor = useMemo(
    () =>
      acta?.status === "RECHAZADA" ? defaultQuad() : (acta?.quadDetectado ?? defaultQuad()),
    [acta?.status, acta?.quadDetectado],
  );

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
  // archivada la acta, no el del acta: el «DELEGADOS» falso del mantenedor con
  // Frankfurt 746). Sin clasifAuto → tipoDeBanda sobre el OCR; tampoco →
  // «---» (mismo estilo que MESA ---).
  const tipoBanda = tipoDeBanda(acta.ocrTexto ?? "");
  const tipoTexto = (t: TipoCopia | null | undefined): string =>
    t ? (t === "TRANSMISION" ? "TRANSMISIÓN" : "DELEGADOS") : "---";
  const tipo = clasifAuto?.tipo ? tipoTexto(clasifAuto.tipo) : tipoTexto(tipoBanda);
  // KIT actas-vivas-paginas-v1 (FASE B): paginaIdentificada exige página
  // LEÍDA — clasificación sin página (acta.pagina == null) → chip «PÁG -
  // DE -» (honesto; el default P1 mintió con la pág 2 de Frankfurt, bug
  // del mantenedor 16-oct). Con página leída sigue mostrando PÁG X DE Y.
  const paginaIdx = clasifAuto ? (clasifAuto.pagina?.index ?? 1) : (acta.pagina?.index ?? 1);
  const paginaTotal = clasifAuto ? (clasifAuto.pagina?.total ?? 2) : (acta.pagina?.total ?? 2);
  const status = acta.status;
  // D2/D3 Rev. 2: «---» = fallback SOLO cuando el sistema NO logra
  // identificar. UN solo predicado compartido por banner + chips.
  const hayClasificacion =
    acta.clasificacion != null && acta.clasificacion.nivel !== "MANUAL";
  const paginaIdentificada = acta.clasificacion != null && acta.pagina != null;
  // ── Banner de ubicación (mock §3.2.2): dot del color del estado + texto
  // uppercase real. Fix del mantenedor (14-oct) #1: el banner es el NOMBRE DEL
  // PUESTO (acta.titulo) — nunca la ruta con «>».
  const dotUbicacion = hayClasificacion
    ? "bg-brand-green"
    : status === "EN_REVISION_HUMANA"
      ? "bg-amber-400"
      : "bg-red-500";
  const textoBanner = (() => {
    // Fix del mantenedor (14-oct) #1: banner = nombre del puesto (p. ej.
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

  // ── CAPA 0 QR (C-10): SOLO presencia del payload, jamás su contenido
  // (llave opaca — red line 10). C-19 — en móvil el chip completo se
  // colapsa y el estado se muestra en una línea compacta (mismo dato).
  const qrLeido = acta.qrPayload != null;
  const qrCorrio = acta.qrEstado != null;
  const qrFalloLectura = !qrLeido && acta.qrEstado === "sin-payload";
  const qrMotivo = qrLeido
    ? null
    : qrCorrio
      ? "sin lectura: la capa 0 QR corrió y no leyó payload"
      : "sin lectura: la capa 0 QR no corrió en esta captura";

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
  // Fix del mantenedor (14-oct) #2: ÓPTIMA/ENVIADA también llevan píldora —
  // la tarjeta del óptimo tiene el mismo tratamiento que medio/bajo.
  const pillFlotante = (() => {
    if (status === "RECHAZADA") {
      if (acta.rechazo?.tipo === "INCOMPLETA")
        return { texto: `ACTA INCOMPLETA${acta.rechazo.detalle ? ` · ${acta.rechazo.detalle}` : ""}`, tono: "crit" as const };
      if (acta.rechazo?.tipo === "BAJO")
        return { texto: `SCORE BAJO${acta.rechazo.detalle ? ` · ${acta.rechazo.detalle}` : ""}`, tono: "crit" as const };
      // KIT e14-gate-v2 (G2): marcador obligatorio de votos fallido — copy
      // CORTO y descriptivo (decisión del mantenedor: SIN guía de cámara).
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
    // Fix del mantenedor (14-oct) #2: píldora verde para ÓPTIMA/ENVIADA.
    // Score visual = bruto del scoreDeCalidad ANTES de los caps del sitio.
    if (status === "OPTIMA" || status === "ENVIADA") {
      const sv = acta.scoreVisual != null ? acta.scoreVisual.toFixed(1) : "—";
      return { texto: `✓ ${acta.score.toFixed(1)}/10 ÓPTIMA · bruto ${sv}/10`, tono: "ok" as const };
    }
    return null;
  })();
  // RECHAZADA/ADVERTENCIA → el motivo vive en la ZONA FIJA (banner completo,
  // sin truncar, encima de Recortar/Rotar/Imagen). OPTIMA/ENVIADA conservan
  // el chip de score flotando sobre la tarjeta.
  const mostrarPillEnTarjeta = status === "OPTIMA" || status === "ENVIADA";
  const pillEnTarjeta = mostrarPillEnTarjeta ? pillFlotante : null;
  const pillEnZonaFija =
    status === "RECHAZADA" || status === "ADVERTENCIA" ? pillFlotante : null;

  // KIT visor-accion-score-v1 (FASE A+B) — fila de acciones calculada FUERA
  // del flujo: vive en la ZONA FIJA de abajo (nunca scrollea; pegada a los
  // CTAs/BottomNav del shell — page.tsx intocable). FASE A: el botón
  // «Pantalla completa» sale (redundante — tocar la foto abre el visor vía
  // ZoomableVisor mode="card" onOpenFullscreen y la tarjeta ENVIADA es
  // táctil); el modal fullscreen SIGUE existiendo con el mismo punto de
  // entrada.
  // ENVIADA → el aviso de envío ocupa la zona fija: queda pegado ENCIMA de
  // «SEGUIR ESCANEANDO» (los CTAs del shell viven debajo), siempre visible
  // sin scrollear ni tapar la foto.
  const filaAcciones =
    status !== "ENVIADA" ? (
      // Resto de estados: Recortar · Rotar 90° · Imagen — UNA sola fila de 3
      // fija (KIT e14-fuera-informes-v1 R-3: fuera la 4ª celda «DIAGNÓSTICO ↓»
      // y el grid-cols-4 condicional — el botón manual del paquete ZIP muere
      // con el sistema de informes; grid-cols-3 como toda la barra).
      <div className="w-full flex flex-col gap-2">
        {/* Motivo del estado SIEMPRE visible y completo: banner en la zona
            fija, encima de la fila de acciones (antes flotaba sobre la foto y
            se truncaba; con el acta recortada el motivo es largo). */}
        {pillEnZonaFija && (
          <div
            role="status"
            data-testid={status === "RECHAZADA" ? "barra-rechazo" : "banner-revision"}
            className={`font-mono font-bold text-[11px] px-3 py-1.5 rounded-lg uppercase tracking-wider text-center leading-snug break-words shadow-md ${
              pillEnZonaFija.tono === "crit"
                ? "bg-[#ef4444] text-white shadow-[0_4px_18px_rgba(239,68,68,0.45)]"
                : pillEnZonaFija.tono === "ok"
                  ? "bg-[#10b981] text-[#090d12]"
                  : "bg-[#f59e0b] text-[#090d12] shadow-[0_4px_18px_rgba(245,158,11,0.4)]"
            }`}
          >
            {pillEnZonaFija.texto}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 lg:gap-3 w-full select-none">
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
        </div>
      </div>
    ) : (
      <div
        role="status"
        className="bg-[#10b981]/15 border border-[#10b981]/40 rounded-xl px-4 py-2.5 flex items-center justify-between shadow-sm"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[#10b981] font-bold text-sm shrink-0">✓</span>
          <span className="text-[#10b981] font-bold text-[13px] uppercase tracking-wider font-mono truncate">
            {acta.enviadoAutomaticamente ? "ENVIADO AUTOMÁTICAMENTE" : "ENVIADO CORRECTAMENTE"}
          </span>
        </div>
        <span className="font-mono text-xs text-white font-bold bg-[#090d12] px-2.5 py-1 rounded-md border border-slate-800 shrink-0">
          {acta.enviadoAutomaticamente ?? "--:--:--"}
        </span>
      </div>
    );

  return (
    // KIT visor-accion-score-v1 (FASE B): root en 2 ZONAS — scroll + barra
    // de acciones FIJA abajo. Shell (page.tsx: h-dvh + main flex-1 min-h-0)
    // INTOCABLE; único overflow-y-auto (sin scroll duplicado).
    <div className="flex-1 min-h-0 flex flex-col">
      {/* ZONA SCROLL — banner + chips + tarjeta + nota + panel. La foto se
          acotó a 38vh (antes 56vh) para que TODO quepa sin desplazar en el
          teléfono; el aviso de envío vive en la zona fija inferior. max-w-md
          centrado aquí y en la zona fija: el centrado no baile. Task 2-b:
          lg:max-w-2xl — escritorio 2 columnas de ancho útil sin tocar el shell. */}
      <div className="flex-1 min-h-0 overflow-y-auto max-w-md lg:max-w-2xl xl:max-w-3xl mx-auto w-full px-4 lg:px-6 py-3 space-y-3 lg:space-y-4 flex flex-col">
        {/* Banner de ubicación (mock §3.2.2 — mono, dot del estado). */}
        {status === "ENVIADA" || status === "OPTIMA" ? (
          <div className="flex items-center px-3.5 py-2 rounded-xl bg-[#10161f] border border-slate-800 text-xs font-mono shadow-xs overflow-x-auto no-scrollbar">
            <span className="text-[#10b981] font-bold tracking-wider whitespace-nowrap uppercase truncate">
              {textoBanner}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[#10161f] border border-slate-800 text-xs font-mono shadow-xs">
            <div className="flex items-center gap-2 truncate">
              <span className={`w-2 h-2 rounded-full shrink-0 ${dotUbicacion}`} />
              <span className="text-[11px] font-bold tracking-wider text-white uppercase truncate">
                {textoBanner}
              </span>
            </div>
          </div>
        )}

        {/* C-10 — el chip de la CAPA 0 QR SIEMPRE se monta en REVISIÓN (antes
            solo nacía con payload y la ausencia era invisible): QR ✓ (payload
            presente, verde) · QR ✗ neutro (la capa no corrió — p. ej.
            IMPORTAR) · QR ✗ ámbar (la capa corrió y NO leyó — las actas E-14
            llevan QR impreso, así que «sin lectura» sobre cámara es fallo de
            la capa). Solo PRESENCIA, JAMÁS contenido del payload (llave
            opaca — red line 10). El motivo técnico va en el detalle del chip
            y en el title: «sin lectura» + por qué. Campos del motor:
            qrPayload (ausente = no corrió o timeout — jamás inventar) y
            qrEstado ("leido" | "sin-payload"); no hay qrError que reportar.
            C-19 — en móvil (< sm) se COLAPSA: el estado sigue visible en la
            línea compacta bajo los chips y el chip completo queda en sm+. */}
        <div
          className="hidden sm:flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#10161f] border border-slate-800 text-[10px] font-mono font-semibold tracking-wide w-full"
          aria-label={qrLeido ? "QR leído" : "QR sin lectura"}
          title={qrMotivo ?? undefined}
        >
          <span
            className={
              qrLeido
                ? "text-emerald-300/90"
                : qrFalloLectura
                  ? "text-amber-400"
                  : "text-gray-500"
            }
          >
            QR {qrLeido ? "✓" : "✗"}
          </span>
          <span className="text-gray-400 uppercase">capa 0 qr</span>
          {qrMotivo && (
            <span className="text-gray-500 uppercase truncate">sin lectura</span>
          )}
        </div>

        {/* Chips de estado (mock §3.2.3 — grid-cols-3, activo sólido). */}
        <div className="grid grid-cols-3 gap-2 lg:gap-3 w-full select-none">
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

        {/* C-19 — móvil: estado de la CAPA 0 QR colapsado (el chip completo
            queda desde sm+); mismo dato, sin robarle una fila al acta. */}
        <p
          className="sm:hidden font-mono text-[9px] font-semibold tracking-wider uppercase"
          aria-label={qrLeido ? "QR leído" : "QR sin lectura"}
          title={qrMotivo ?? undefined}
        >
          <span
            className={
              qrLeido
                ? "text-emerald-300/90"
                : qrFalloLectura
                  ? "text-amber-400"
                  : "text-gray-500"
            }
          >
            QR {qrLeido ? "✓" : "✗"}
          </span>{" "}
          <span className="text-gray-500">
            capa 0 qr{qrMotivo ? " · sin lectura" : ""}
          </span>
        </p>

        {/* LÍNEA DE ID («KIT --- · --- · -/-» + «MESA · POR KIT») — ELIMINADA
            a pedido del mantenedor. La identidad del acta sigue VIVA en el resto de
            la app: chips de estado de arriba (tipo/MESA/PÁG), clasificación
            (dedup, infoTitulo) e informe ZIP. Cero cambios de
            lógica: solo se retiró el bloque visual del KIT consenso-frankfurt
            (Task 122, FASE 5 §6.2). */}

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
        {/* Tarjeta del acta (mock §3.2.4) */}
        {status === "ENVIADA" ? (
          <div
            role="button"
            aria-label="Ver acta a pantalla completa"
            tabIndex={hayFoto ? 0 : -1}
            onClick={hayFoto ? () => setVisorAbierto(true) : undefined}
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
            className="relative bg-[#10161f] rounded-2xl p-3 border border-slate-800 shadow-2xl w-full text-left flex flex-col flex-1 min-h-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10b981]/60"
          >
            {pillEnTarjeta && (
              <span
                data-testid="banner-revision"
                className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 font-mono font-bold text-[11px] px-3.5 py-1.5 rounded-full uppercase tracking-wider whitespace-nowrap max-w-[92%] truncate shadow-md bg-[#10b981] text-[#090d12] shadow-[0_4px_18px_rgba(16,185,129,0.5)] font-extrabold"
              >
                {pillEnTarjeta.texto}
              </span>
            )}
            <div className="scanner-corner-tl" style={cornerColor ? { borderColor: cornerColor } : undefined} />
            <div className="scanner-corner-tr" style={cornerColor ? { borderColor: cornerColor } : undefined} />
            <div className="scanner-corner-bl" style={cornerColor ? { borderColor: cornerColor } : undefined} />
            <div className="scanner-corner-br" style={cornerColor ? { borderColor: cornerColor } : undefined} />
            {fotoVisible ? (
              <div className="w-full flex-1 min-h-[160px] lg:min-h-[240px] relative flex items-center justify-center mt-2">
                <ZoomableVisor
                  mode="card"
                  src={fotoVisible}
                  alt={altFoto}
                  onOpenFullscreen={() => setVisorAbierto(true)}
                />
              </div>
            ) : (
              <div className="mt-2 rounded-xl border border-slate-800 bg-[#090d12] h-48 flex items-center justify-center">
                <span className="font-mono text-[10px] tracking-widest text-slate-400 uppercase">
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
            onClick={hayFoto ? () => setVisorAbierto(true) : undefined}
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
            className="relative bg-[#10161f] rounded-2xl p-3 border border-slate-800 shadow-2xl w-full text-left flex flex-col flex-1 min-h-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10b981]/60"
          >
            {pillEnTarjeta && (
              <span
                data-testid="banner-revision"
                className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 font-mono font-bold text-[11px] px-3.5 py-1.5 rounded-full uppercase tracking-wider whitespace-nowrap max-w-[92%] truncate shadow-md bg-[#10b981] text-[#090d12] shadow-[0_4px_18px_rgba(16,185,129,0.5)] font-extrabold"
              >
                {pillEnTarjeta.texto}
              </span>
            )}
            <div className="scanner-corner-tl" style={cornerColor ? { borderColor: cornerColor } : undefined} />
            <div className="scanner-corner-tr" style={cornerColor ? { borderColor: cornerColor } : undefined} />
            <div className="scanner-corner-bl" style={cornerColor ? { borderColor: cornerColor } : undefined} />
            <div className="scanner-corner-br" style={cornerColor ? { borderColor: cornerColor } : undefined} />
            {fotoVisible ? (
              <div className="w-full flex-1 min-h-[160px] lg:min-h-[240px] relative flex items-center justify-center mt-2">
                <ZoomableVisor
                  mode="card"
                  src={fotoVisible}
                  alt={altFoto}
                  onOpenFullscreen={() => setVisorAbierto(true)}
                />
              </div>
            ) : (
              <div className="mt-2 rounded-xl border border-slate-800 bg-[#090d12] h-48 flex items-center justify-center">
                <span className="font-mono text-[10px] tracking-widest text-slate-400 uppercase">
                  FOTO NO DISPONIBLE
                </span>
              </div>
            )}
          </div>
        )}

        {mostrandoOriginal && (
          <p className="text-center font-mono text-[9px] font-bold tracking-[0.18em] text-slate-400 uppercase">
            {acta.recorteManualSinTinta
              ? "TU RECORTE SE APLICÓ — LA FOTO SALIÓ SIN TINTA SUFICIENTE; SE MUESTRA LA ORIGINAL"
              : "SE MUESTRA LA FOTO ORIGINAL"}
          </p>
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
        <div className="shrink-0 max-w-md lg:max-w-2xl xl:max-w-3xl mx-auto w-full px-4 lg:px-6 pb-1 pt-2">
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
          // → NO se devuelve al mantenedor el quad fracasado como punto de
          // partida: el marco completo (puntos a arrastrar al papel).
          // ADVERTENCIA conserva quadDetectado (la detección acertó el
          // marco; solo hay que corregir una esquina).
          quadInicial={quadInicialEditor}
          rotation={acta.rotation ?? 0}
          aplicando={recortando}
          onCancelar={() => setEditando(false)}
          onAplicar={(quad, rotacion) => {
            // KIT e14-recorte-manual-v1 (T2): el editor SOLO se cierra si el
            // recorte resolvió (éxito o timeout-controlado → `true`). En
            // error duro queda ABIERTO — la píldora avisa y el mantenedor
            // reintenta SIN perder su quad (antes el .then cerraba SIEMPRE).
            void aplicarRecorte(quad, rotacion).then((ok) => {
              if (ok) setEditando(false);
            });
          }}
        />
      ) : null}

      {/* KIT e14-recorte-manual-v1 (T2): el fallo del recorte DEJA DE SER
          SILENCIOSO — píldora del estilo existente (tono crit), fija SOBRE
          el overlay del editor (z-[60] > z-50 del QuadEditor) porque el
          editor NO se cierra en error duro. Se limpia sola (~6 s) o al
          reintentar. role=alert para screen readers. */}
      {errorRecorte && (
        <div
          role="alert"
          data-testid="error-recorte"
          className="fixed top-24 left-1/2 z-[60] -translate-x-1/2 animate-editor-enter font-mono font-extrabold text-[9px] uppercase tracking-wider px-2.5 py-1.5 rounded bg-[#E52222] text-white shadow-xl whitespace-nowrap max-w-[92%] truncate"
        >
          {errorRecorte}
        </div>
      )}

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
    // mismo de siempre: navega a escanear. Task 2-b (crítica VLM #2):
    // el CTA se calma VISUALMENTE (glow/padding/texto menores) — la
    // píldora de score ÓPTIMA pasa a ser lo primero que se lee; sigue
    // siendo la acción primaria funcional (mismo handler/primacía).
    return (
      <button
        type="button"
        onClick={() => navegar("escanear")}
        className="w-full bg-brand-green hover:bg-emerald-400 text-black font-extrabold text-[13px] py-3.5 px-6 rounded-2xl shadow-[0_2px_12px_rgba(0,230,118,0.25)] flex items-center justify-center gap-2 tap-action transition-all select-none"
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
