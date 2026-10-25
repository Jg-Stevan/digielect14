/**
 * QA headless — KIT ux-masiva-fixes-v1 (§G, T7): contrato de los fixes UX
 * (UX-1..UX-13 prescritos — UX-5/UX-7/UX-9b/UX-9a quedan FUERA, §0.3).
 * Sin red, sin DOM, determinista — source-scan estático (patrón lección
 * 3A.1, mismo esqueleto de los qa-*.ts: readFile + ok() + remate OK).
 * ANCLA POR PATRÓN, jamás por número de línea (los números del kit son del
 * snapshot 9b0fe8d; esta rama va apilada sobre aa-quickwins 04e5cba).
 *
 *   bun scripts/qa-ux-masiva-fixes.ts
 *
 * Checks (kit §G):
 *   1. UX-1: archivos.ts con motivoDeErrorLectura + console.warn("[e14-pdf]"
 *      + "NO_SE_PUDO_LEER" AL FINAL del union D57 (indexOf > LIMITE_PAGINAS);
 *      console.warn SOLO en el catch de getDocument (red line 4); catches
 *      zip/rar con motivo fijo INTACTOS (kit §A.3 — no se tocan).
 *   2. UX-3: TopBar con condicional masivaOrigen; ReviewView con el CTA
 *      condicional (VOLVER A MASIVA) — residual «VOLVER AL ESCÁNER» de
 *      RECHAZADA intocado (fuera de alcance, comportamiento correcto).
 *   3. UX-8: MasivaView sin la ventana de 3000 y CON 6000 (solo VACIAR).
 *   4. UX-4: porcentajeProcesoActa EXPORTADA con 4.º parámetro ultimosFrac
 *      (Map) + ref useEffect en MasivaView.
 *   5. UX-6: COLA {terminadas}/{filas.length} presente; PROCESANDO
 *      {terminadas} ausente.
 *   6. UX-13: chip con sondeadas > 0 && pendientes > 0.
 *   7. Anclas QA previas INTACTAS: YA ENVIADA chip · YA ENVIADAS contador ·
 *      f.qrEstado (leido / sin-payload+LISTA) · REINTENTAR D59 con original
 *      (void reintentar) · condición SIN_ARCHIVO_ORIGINAL.
 *   8. UX-10: ResumenView con caption "de tu puesto asignado (".
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

let pasadas = 0;
let fallos = 0;
function ok(cond: boolean, etiqueta: string): void {
  console.log(`${cond ? "OK" : "FAIL"} · ${etiqueta}`);
  pasadas++;
  if (!cond) fallos++;
}

async function leer(ruta: string): Promise<string | null> {
  try {
    return await readFile(join(process.cwd(), ruta), "utf8");
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const archivos = await leer("src/lib/e14/masiva/archivos.ts");
  const topBar = await leer("src/components/e14/TopBar.tsx");
  const review = await leer("src/components/e14/screens/ReviewView.tsx");
  const masiva = await leer("src/components/e14/screens/MasivaView.tsx");
  const resumen = await leer("src/components/e14/screens/ResumenView.tsx");

  ok(archivos != null, "archivos.ts legible");
  ok(topBar != null, "TopBar.tsx legible");
  ok(review != null, "ReviewView.tsx legible");
  ok(masiva != null, "MasivaView.tsx legible");
  ok(resumen != null, "ResumenView.tsx legible");
  if (!archivos || !topBar || !review || !masiva || !resumen) {
    console.log(`REMERATE — ${fallos} fallo(s)`);
    process.exit(1);
  }

  // ── Check 1 · UX-1: motivo real del fallo de lectura ─────────────────
  ok(archivos.includes("export function motivoDeErrorLectura"), "1.1 clasificador puro exportado (motivoDeErrorLectura)");
  ok(archivos.includes('console.warn("[e14-pdf] getDocument falló:", err);'), '1.2 console.warn("[e14-pdf]" en el catch de getDocument');
  ok(archivos.includes('"NO_SE_PUDO_LEER"'), '1.3 motivo nuevo NO_SE_PUDO_LEER presente');
  const iNuevo = archivos.indexOf('"NO_SE_PUDO_LEER"');
  const iLimite = archivos.indexOf('"LIMITE_PAGINAS_PDF"');
  ok(iNuevo > -1 && iLimite > -1 && iNuevo > iLimite, "1.4 motivo nuevo AL FINAL del union D57 (indexOf NO_SE_PUDO_LEER > LIMITE_PAGINAS_PDF)");
  ok(archivos.includes("return nombre === \"NotReadableError\" ? \"NO_SE_PUDO_LEER\" : \"PROTEGIDO_O_CORRUPTO\";"), "1.5 clasificador: NotReadableError → propio, resto → PROTEGIDO_O_CORRUPTO");
  const warns = [...archivos.matchAll(/console\.warn/g)].length;
  ok(warns === 1, `1.6 red line 4 — console.warn SOLO en getDocument (hallados ${warns}, esperado 1)`);
  const motivoFijo = [...archivos.matchAll(/throw new Error\("PROTEGIDO_O_CORRUPTO"\)/g)].length;
  ok(motivoFijo === 3, `1.7 catches zip/rar + guard sin contenido con motivo fijo INTACTOS (hallados ${motivoFijo}, esperado 3 — §A.3)`);

  // ── Check 2 · UX-3: volver al origen ──────────────────────────────────
  ok(topBar.includes('masivaOrigen ? "masiva" : "escanear"'), "2.1 TopBar: navegar condicional por masivaOrigen");
  ok(topBar.includes('masivaOrigen ? "Volver a la bandeja masiva" : "Volver al menú de escaneo"'), "2.2 TopBar: aria-label dinámico");
  ok(review.includes('navegar(masivaOrigen ? "masiva" : "escanear")'), "2.3 ReviewView: CTA ENVIADA con destino condicional");
  ok(review.includes('{masivaOrigen ? "VOLVER A MASIVA" : "SEGUIR ESCANEANDO"}'), "2.4 ReviewView: label condicional VOLVER A MASIVA");
  ok(review.includes('onClick={() => navegar("escanear")}'), "2.5 residual pactado INTACTO: «VOLVER AL ESCÁNER» de RECHAZADA (fuera de alcance §B)");

  // ── Check 3 · UX-8: ventana VACIAR 6000 ───────────────────────────────
  ok(!masiva.includes("setTimeout(() => setVaciarArmado(false), 3000)"), "3.1 MasivaView SIN ventana de 3000 ms");
  ok(masiva.includes("setTimeout(() => setVaciarArmado(false), 6000)"), "3.2 MasivaView CON ventana de 6000 ms (solo VACIAR)");

  // ── Check 4 · UX-4: % sin retroceso visual ────────────────────────────
  ok(masiva.includes("export function porcentajeProcesoActa("), "4.1 porcentajeProcesoActa EXPORTADA");
  ok(masiva.includes("ultimosFrac: Map<string, number>,"), "4.2 4.º parámetro ultimosFrac (Map)");
  ok(masiva.includes("return Math.round((ultimosFrac.get(f.id) ?? 0.2) * 100);"), "4.3 no-activa → último real o 20 zombi");
  ok(masiva.includes("const ultimosFrac = useRef(new Map<string, number>());"), "4.4 ref ultimosFrac en el componente");
  ok(masiva.includes("porcentajeProcesoActa(f, Boolean(esActiva), progreso, ultimosFrac.current)"), "4.5 call-site pasa el mapa actual");

  // ── Check 5 · UX-6: copy neutro ───────────────────────────────────────
  ok(masiva.includes("COLA {terminadas}/{filas.length}"), "5.1 COLA {terminadas}/{filas.length} presente");
  ok(!masiva.includes("PROCESANDO {terminadas}"), "5.2 PROCESANDO {terminadas} ausente");
  ok(masiva.includes("{yaEnviadas > 0 && <> · YA ENVIADAS {yaEnviadas}</>}"), "5.3 ancla qa-dedup INTACTA: contador YA ENVIADAS byte a byte");

  // ── Check 6 · UX-13: chip desaparece al COMPLETADA ────────────────────
  ok(masiva.includes("{sondeadas > 0 && pendientes > 0 && ("), "6.1 chip SONDEO QR con sondeadas > 0 && pendientes > 0");

  // ── Check 7 · anclas QA previas INTACTAS ──────────────────────────────
  ok(masiva.includes('label: "YA ENVIADA", clases: "border-emerald-500/60 text-emerald-300 bg-emerald-500/10"'), "7.1 chip YA ENVIADA (pildoraDe) intacto");
  ok(masiva.includes('f.qrEstado === "leido"') && masiva.includes('f.qrEstado === "sin-payload" && f.estado === "LISTA"'), "7.2 condiciones f.qrEstado (leido · sin-payload+LISTA) intactas");
  ok(masiva.includes('onClick={() => void reintentar(f.id)}'), "7.3 REINTENTAR D59 intacto para filas con original");
  ok(masiva.includes('f.estado === "ERROR" && f.error !== "SIN_ARCHIVO_ORIGINAL"'), "7.4 REINTENTAR oculto SOLO para SIN_ARCHIVO_ORIGINAL");
  ok(masiva.includes("const enVuelo = filas.filter((f) => f.estado === \"PROCESANDO\").length;"), "7.5 UX-11: enVuelo computado sobre filas");
  ok(masiva.includes("{enVuelo > 1 && <> +{enVuelo - 1} MÁS EN VUELO</>}"), "7.6 UX-11: header +N MÁS EN VUELO (condicional)");

  // ── Check 8 · UX-10: caption del puesto asignado ──────────────────────
  ok(resumen.includes("de tu puesto asignado ("), "8.1 ResumenView: caption 'de tu puesto asignado (N páginas)'");

  console.log(`\nQA ux-masiva-fixes — ${pasadas - fallos}/${pasadas} OK`);
  if (fallos > 0) process.exit(1);
}

void main();
