# INSTRUCCIONES — e14 · identificación-código v1 (Task 120)

Rama: `feat/identificacion-codigo` · PR: nuevo (draft → ready cuando pase gates) · **NO merge sin orden del dueño.**

---

## §0 Contexto (léelo entero antes de tocar nada)

El dueño pidió identificar automáticamente cada acta: **tipo (delegados/transmisión), página,
mesa y si está completa (sin recortar)**. El análisis completo con evidencia está en
`research/PATRON-identificacion-actas-e14.md` (Task 119) — léelo; este kit asume su contenido.

Conclusiones que sustentan este kit:
1. El **código 1D impreso** (los 15 dígitos bajo el código de barras) tiene gramática cerrada
   verificada 12/12 con actas oficiales:
   `7100 | KIT(4) | TIPO(1: 2=DELEGADOS, 3=TRANSMISION) | VER(2) | PAG(2) | TOTAL(2)`.
2. El clasificador (`src/lib/e14/clasificador.ts`) ya lee d9/d12-15 como respaldos sueltos
   (`ANCLA_CODIGO_1D` L131, página L328-348, tipo L357-378, kit pie L349-355), pero NO parsea
   el código completo ni cruza las fuentes entre sí.
3. El KIT mapea a MESA por (país, puesto) — registro con 6 actas oficiales verificadas +
   Frankfurt 745 (OCR del dueño).
4. Las 4 **marcas fiduciales negras** de las esquinas del acta permiten probar «sin recortar»
   (incluye recortes superiores que la señal de contenido del kit 118 no ve).
5. El QR es un blob criptográfico OPACO (32 bytes; 16 compartidos por kit+página) — **NO
   implementar lectura de QR en este kit** (queda documentado para el futuro).

## §1 PRERREQUISITOS (hard gates)

- PR #6 (`feat/visor-accion-score`) MERGEADO en main — toca ReviewView/bridge.
- Kit 118 (`INSTRUCCIONES-e14-actas-vivas-paginas-v1`, Task 118) MERGEADO — su FASE B deja el
  respaldo 1D multi-candidato y su FASE C el canal de integridad (`faltaSeccionInferior`,
  techo 7.9, pill ACTA RECORTADA) sobre los que este kit construye.
- Verifica antes de empezar: `main` contiene `faltaSeccionInferior` (o equivalente del 118)
  y el parser multi-candidato de códigos 15 dígitos. Si no, DETENTE y reporta.

## §2 FASE C — `codigoUnicoE14()` (S, clasificador.ts)

Añade al final de la sección de anclas/utilidades (después de `ANCLA_FORM`, con comentario
`// Fuente:` citando el análisis §1):

```ts
/** Gramática del código 1D impreso (ANALISIS §1 — 12/12 actas oficiales):
 *  7100 | KIT(4) | TIPO(1: 2=DELEGADOS, 3=TRANSMISION) | VER(2) | PAG(2) | TOTAL(2).
 *  Ejemplos reales: «710003992010102» → kit 399, DELEGADOS, ver 01, pág 1 de 2;
 *  «710003993010102» → el mismo kit 399, TRANSMISION (misma mesa, otra copia). */
export interface CodigoUnicoE14 {
  crudo: string;
  kit: number;
  tipoDigito: "2" | "3";
  ver: number;
  pagina: number;
  total: number;
}

export function codigoUnicoE14(crudo: string): CodigoUnicoE14 | null {
  if (!/^\d{15}$/.test(crudo)) return null;
  if (crudo.slice(0, 4) !== "7100") return null;
  const d9 = crudo[8];
  if (d9 !== "2" && d9 !== "3") return null;
  const ver = parseInt(crudo.slice(9, 11), 10);
  const pagina = parseInt(crudo.slice(11, 13), 10);
  const total = parseInt(crudo.slice(13, 15), 10);
  const kit = parseInt(crudo.slice(4, 8), 10);
  if (!Number.isFinite(kit) || kit < 1) return null;
  if (!(ver >= 1 && ver <= 99)) return null;
  if (!(pagina >= 1 && total >= pagina && total <= 9)) return null;
  return { crudo, kit, tipoDigito: d9, ver, pagina, total };
}

export function tipoDeDigito(d: "2" | "3"): TipoCopia {
  return d === "3" ? "TRANSMISION" : "DELEGADOS";
}
```

QA script (crea `scripts/qa-codigo-unico.ts`, SOLO QA, fuera del bundle; corre con `bun
scripts/qa-codigo-unico.ts` y pega la salida en el reporte): los 12 códigos del análisis §1
como fixtures, imprime tabla y exige 12/12 (incluye los 2 negativos: `710003992010103`
(d9=3 con tipo D esperado→ solo comprueba que el PARSEO da T) y `71000982201010X` no
numérico → null; y `810003992010102` prefijo malo → null).

## §3 FASE D — cruces en `clasificarCabecera` (M, clasificador.ts)

Sobre la colección multi-candidato del kit 118 (`codigos1D`):

1. **Consenso**: parsea cada candidato con `codigoUnicoE14`. Si ≥1 y TODOS acuerdan
   (kit, tipoDigito, pagina, total) → `consenso`; si difieren entre sí → `consenso = null`
   + traza `CODIGO_1D_INCONSISTENTE`.
2. Añade a `ClasificacionE14` (opcional, display): `codigoUnico?: CodigoUnicoE14 | null` y
   `avisos?: string[]`.
3. **TIPO**: lógica actual intacta (banda primaria; d9 respaldo conf 0.9 — ahora vía
   `consenso`). NUEVO: banda presente Y consenso presente y `tipoDeDigito(d9) ≠ tipo de la
   banda` → la banda SIGUE ganando (nivel sin cambio), pero `confianzas.tipo = 0.75` +
   `avisos.push("BANDA_CODIGO_DISCREPAN")` + traza.
4. **PÁGINA**: si `mVerPag` Y `consenso` y discrepan → gana el consenso (impreso OCR-B más
   fiable) + `avisos.push("VERPAG_CODIGO_DISCREPAN")` + traza. Si `mVerPag` ausente →
   consenso (reemplaza el slice crudo actual; misma validación, ahora con prefijo+kit).
5. **KIT**: pie primario (L349-355 sin cambio). Si pie ausente y `consenso` → `kit =
   consenso.kit` (esto vacía la mayoría de `SINKIT` en `nombreExportacion`).
6. **MESA**: ancla actual primero (L568-578 sin cambio para AUTO). NUEVO, SOLO si
   `mesaLeida === null` (o `mesa` quedó null): registro kit→mesa (FASE E) con municipio
   resuelto → `mesa = registro.mesa` + `avisos.push("MESA_POR_KIT")` + traza. Nivel: NO
   cambia (mesaValidaLeida sigue exigiendo lectura de cabecera → máx SUGERIDA, como hoy).
   Si `mesaLeida` existe y el registro difiere → NO sobreescribes; `avisos.push("MESA_KIT_DISCREPAN")` + traza.

## §4 FASE E — registro kit→mesa (S, archivo NUEVO `src/lib/e14/kits.ts`)

```ts
/** Registro KIT→mesa (ANALISIS §4.2 — 6 actas oficiales + Frankfurt por OCR del dueño).
 *  Clave = (mun/país, kit). El kit es único por puesto en la evidencia; AMPLIAR solo con
 *  actas oficiales verificadas (visor Registraduría). NUNCA da AUTO ni decide envío. */
export interface RegistroKit { mun: string; zon: string; std: string; kit: number; mesa: number; fuente: string; }
export const REGISTRO_KITS: RegistroKit[] = [
  { mun: "495", zon: "10", std: "02", kit: 982,  mesa: 1,  fuente: "visor: ROMA - CONSULADO" },
  { mun: "335", zon: "05", std: "02", kit: 399,  mesa: 1,  fuente: "visor: EL CAIRO - CONSULADO (2 copias)" },
  { mun: "120", zon: "05", std: "02", kit: 726,  mesa: 8,  fuente: "visor: BERLIN CONSULADO" },
  { mun: "120", zon: "05", std: "02", kit: 727,  mesa: 9,  fuente: "visor: BERLIN CONSULADO" },
  { mun: "120", zon: "15", std: "02", kit: 745,  mesa: 12, fuente: "OCR dueño: FRANKFURT CONSULADO" },
  { mun: "355", zon: "03", std: "08", kit: 1265, mesa: 1,  fuente: "visor: BARCELONA - GIRONA" },
];
export function kitEnRegistro(mun: string | null, kit: number | null): RegistroKit | null {
  if (!mun || kit === null || !Number.isFinite(kit)) return null;
  return REGISTRO_KITS.find((r) => r.mun === mun && r.kit === kit) ?? null;
}
```

Guardas al consumir (FASE D.6): municipio resuelto coincide; si `zona`/`puesto` resueltos y
difieren del registro → NO aplicar (traza `KIT_OTRA_RUTA`); si la ruta completa resuelve,
`registro.mesa` debe cumplir `1 ≤ mesa ≤ p.t` (regla 5) — si se pasa, no aplicar + aviso.

## §5 FASE F — `marcasEsquina()` (S, archivo NUEVO `src/lib/e14/integridad.ts`)

```ts
/** Marcas fiduciales de esquina (ANALISIS §5.1): cuadrado negro relleno cerca de cada
 *  esquina del acta. Presente = núcleo oscuro CON anillo blanco (distingue mesa oscura
 *  / esquina recortada). Canvas = crop YA enderezado (mismo input que calidadDeActa). */
export interface EsquinasActa { tl: boolean; tr: boolean; bl: boolean; br: boolean; }
export function marcasEsquina(canvas: HTMLCanvasElement): EsquinasActa {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || canvas.width < 80 || canvas.height < 120)
    return { tl: false, tr: false, bl: false, br: false };
  const W = canvas.width, H = canvas.height;
  const lum = (x0: number, y0: number, w: number, h: number): number => {
    const d = ctx.getImageData(x0, y0, w, h).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4) / 255;
  };
  const esquina = (cx: 0 | 1, cy: 0 | 1): boolean => {
    const x0 = cx === 0 ? Math.round(W * 0.02) : Math.round(W * 0.91);
    const y0 = cy === 0 ? Math.round(H * 0.015) : Math.round(H * 0.955);
    const w = Math.round(W * 0.07), h = Math.round(H * 0.03);
    const nucleo = lum(x0, y0, w, h);
    const anillo = lum(Math.max(0, x0 - w), Math.max(0, y0 - h), Math.min(W, x0 + 2 * w) - Math.max(0, x0 - w), Math.min(H, y0 + 2 * h) - Math.max(0, y0 - h));
    return nucleo < 0.45 && anillo > 0.75;
  };
  return { tl: esquina(0, 0), tr: esquina(1, 0), bl: esquina(0, 1), br: esquina(1, 1) };
}
```

Integración con el canal del kit 118 (mismo lugar donde `faltaSeccionInferior` impone techo
7.9 + pill): si falta una esquina → pill/pill-texto existente gana; añade el LADO al aviso
(`RECORTADA sup-izq` etc.) y traza `ESQUINA_FALTA_{tl|tr|bl|br}`. Si las 4 presentes → nada
visible nuevo (señal positiva, solo traza `ESQUINAS_OK`). Umbrales ajustables SOLO con
comentario `// Fuente:` y evidencia de captura real.

## §6 Inmutables (como siempre)

- `packages/scanner-core` y `scanner-ui` (npm 0.1.0): CERO diffs.
- Anclas existentes del clasificador (L50, L111-140, umbrales L142-147): NO se relajan;
  solo se AÑADEN cruces/avisos.
- Nivel AUTO: mismas condiciones (L580-600) — el registro y el código NUNCA producen AUTO
  ni deciden envío.
- D6: no tocar archivadas/historial/completadas; SIM (quad identidad) intacto — chips
  8.2/7.0/4.3 no deben cambiar.
- Sin dependencias nuevas (nada de jsQR/zxing en este kit — el QR queda documentado).
- `bun.lock`, `package.json`, `public/`: 0 diffs.

## §7 Gates y QA

- `bunx tsc --noEmit` = 0 · `bun run lint` = 0 · npm diff = 0.
- Script `scripts/qa-codigo-unico.ts` → 12/12 + 3 negativos, salida pegada en
  `docs/REPORTE-identificacion-codigo-v1.md` con el resumen de decisiones (§3-§5) y las
  trazas nuevas.
- QA física del dueño (no bloquea el PR):
  G-A Reprecio del acta Frankfurt p2 → hueco en P2 (118) + chip código «KIT 745 ·
      TRANSMISION · 2/2» visible si el OCR lo lee.
  G-B Foto El Cairo delegados p1 → aviso ausente, export SIN `SINKIT` cuando el pie falle
      pero el código se lea.
  G-C Cabecera tapada (dedo sobre «MESA:») con código legible → chip «MESA POR KIT» y mesa
      sugerida correcta (Berlin 008 con kit 726).
  G-D Recorte simulado de la esquina superior-izquierda → pill/aviso con el LADO, score
      con techo, sin cambiar el resto.

## §8 Protocolo

Rama `feat/identificacion-codigo` desde main POST-merges (#6 y kit 118). Commits
convencionales. PR con: reporte, salida del script 12/12, capturas G-A..G-D cuando el dueño
las corra. worklog.md: entrada `Task ID: 120` al terminar (append, sin sobreescribir).

## §9 Prompt corto para el agente

```
Lee download/INSTRUCCIONES-e14-identificacion-codigo-v1.md y research/
PATRON-identificacion-actas-e14.md. Ejecuta el kit COMPLETO (FASES C-F) en rama
feat/identificacion-codigo. Respeta §1 (prerrequisitos: PR #6 y kit 118 mergeados — si no,
detente), §6 (inmutables) y §7 (gates + script 12/12). Reporte en
docs/REPORTE-identificacion-codigo-v1.md y worklog Task 120. NO mergees.
```
