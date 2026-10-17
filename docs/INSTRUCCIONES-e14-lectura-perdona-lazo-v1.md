# KIT e14-lectura-perdona-lazo-v1 — «la lectura perdona al fiducial»

> Delegación para el agente. Base: **main @ `f38a6aa`** (cadena #10 → #12 → #14 → #13 mergeada).
> Prioridad: **ALTA** — es la corrección que sube la tasa de auto-envío medida en campo.
> Filosofía ya aprobada por el dueño: «la lectura manda» (kit e14-score-lectura-v1), ahora
> aplicada al gate. Cero cambios en el core npm, en los chips SIM o en el score de disparo.

---

## 0. Decisión del dueño (literal)

- El dueño (2026-10-17, tras analizar los 2 ZIPs de diagnóstico de campo): **«genera los 3 kits
  completos para delegarlos al agente»** — esta es la **T-A**, propuesta textual:
  > «**T-A · Regla "la lectura perdona al fiducial"** (convierte el zip1 en auto-envío): si el
  > lazo reporta un lado faltante PERO la lectura demuestra que ese lado está dentro
  > (fondo: `KIT` o `SUMA TOTAL` leídos; tope: cabecera/código leídos) → NO aplicar el cap
  > `recortada` (falso positivo: margen corto/sombra). Si falta la esquina Y no hay lectura del
  > lado → cap se queda (zip2 sigue siendo rechazo correcto). Es la filosofía "la lectura manda"
  > que ya aprobamos, aplicada al gate.»
- Contexto maestro del proyecto (orden permanente del dueño): «la idea es que la mayor parte de
  las imagenes se envien automaticamente».
- FUERA DE ALCANCE (orden explícita del dueño, vigente desde score-lectura): el score de
  disparo en vivo (0→100% del chip de escaneo) NO se toca.

---

## 1. Evidencia de campo (ZIPs de diagnóstico 2026-10-17 11:56/11:58, CONSULADO 88 · EGIPTO)

### Caso que motiva el kit — `e14-diag-mesa-001-115643-i1.zip` (intento 1, escaneo)

| Hecho medido | Valor | Fuente |
|---|---|---|
| Desenlace | ADVERTENCIA 7.9 (visual 8.3) | diagnostico.json |
| Techos | `recortada:7.9` — ÚNICO cap aplicado | diagnostico.json |
| Lazo | `recortada: true (inf-izq)` — esquina fiducial bl no vista | diagnostico.json |
| Completitud geométrica | `completa: true` (el guard geométrico NO condenó) | diagnostico.json |
| Calidad | sharpness 100 · level excellent · brightness 64 · contrast 67 | diagnostico.json |
| OCR | 621 chars: lee REGISTRADURÍA, CONSULADO, PAÍS, ZONA 05 PUESTO 02 MESA 001, **SUMA TOTAL**, **KIT 399**, código 15d `710003993010102` | ocr.txt |
| Imágenes | El acta está COMPLETA de arriba abajo (verificado visualmente: original y final muestran hasta el pie KIT 399) | original.jpg / final.jpg |

**Diagnóstico:** el crop mordió el margen inferior y la marca fiducial `bl` quedó parcialmente
fuera/borrosa → `marcasEsquina` la reporta faltante → `recortada = … || ladoEsquina !== null`
→ cap 7.9 → ADVERTENCIA → revisión manual. **Un acta con el 100% de los datos legibles se quedó
sin auto-enviar SOLO por una marca de esquina en el margen.** El OCR ya demostraba que el fondo
del papel estaba dentro: una acta realmente cortada no puede leer su pie (`KIT 399`) ni su última
fila de datos (`SUMA TOTAL`).

### Caso de control (NO debe cambiar) — `e14-diag-mesa-002-115822-i2.zip`

- OCR cortado en «TOTAL VOTOS INCINERADOS»: SIN `SUMA TOTAL`, SIN `KIT` →
  `faltaSeccionInferior(P1) === true` → el perdón **NO** aplica → `recortada` se queda.
- Además `completa: false` (guard geométrico) → RECHAZADA INCOMPLETA 6.4. Desenlace correcto
  (foto demasiado cerca; el copy «ALÉJATE UN POCO» fue el correcto). Este kit NO lo altera.

### Tasa de la sesión (comportamiento.txt del segundo ZIP)

- Auto-envío 25% (1 de 4). Causas no-auto: lazo inf-izq (falso positivo, ESTE kit) · sin señal
  (captura mala, correcto) · tinta cortada al filo (correcto). Con este kit, la sesión de campo
  habría quedado **50%** (el zip1 era auto-enviable: visual 8.3 + piso de lectura FUERTE 8.5
  sin cap → OPTIMA).

---

## 2. Alcance

### CAMBIA (y solo esto)

1. `src/lib/e14/senal-lectura.ts`: NUEVO helper puro `lazoPerdonadoPorLectura(...)` (§4-A).
2. `src/lib/e14/scanner-core-bridge.ts`: la definición de `recortada` en AMBOS pipelines
   (escaneo ~L1030, recorte ~L1481) deja de condenar por el lazo cuando la lectura perdona;
   traza del log con token `lazo=perdonado` (§4-B).
3. `scripts/qa-lectura-perdona.ts`: NUEVO — QA headless de la regla (§6).

### NO CAMBIA (invariantes duros)

- `faltaSeccionInferior` (clasificador.ts L1019) — la señal de secciones es lectura pura y
  **NUNCA se perdona** (es tinta ausente, no una marca).
- `verificarCompletitud` / completitud.ts / el guard INCOMPLETA (veto `!completa` → RECHAZADA)
  — intactos. El perdón vive SOLO en la variable `recortada` y su cap.
- El cap en sí: `if (recortada) score = Math.min(score, TECHO_ESCUDO_FONDO)` — MISMA línea,
  mismo valor 7.9. Lo que cambia es cuándo `recortada` es true.
- Los caps posteriores y su orden (SIM → escudo-fondo → recortada → gate): intactos. El perdón
  no sube ningún score: solo deja de aplicar un cap.
- Chips SIM 8.2/7.0/4.3: **demostración de no-op en SIM** — en escaneo, `esquinas =
  opciones.simular ? ESQUINAS_OK : …` (bridge ~L955) ⇒ en SIM `faltan = []` ⇒
  `lazoPerdonadoPorLectura` devuelve `false` ⇒ `recortada` queda idéntica a hoy.
- `ladoEsquinaFaltante` / `marcasEsquina` / integridad.ts: intactos (la medición sigue igual;
  solo cambia su interpretación cuando la lectura da fe del lado).
- Score de disparo en vivo: fuera de alcance (§0).
- El copy/display del aviso «ACTA RECORTADA · sup-izq»: sigue existiendo para el caso no
  perdonado. Caso perdonado = no hay aviso (no hay condena).

---

## 3. Definición de la regla (spec exacta)

**Nombre:** `lazoPerdonadoPorLectura`.

**Entradas:**
- `esquinas: { tl: boolean; tr: boolean; bl: boolean; br: boolean } | null` — lo que hoy
  alimenta `ladoEsquinaFaltante` (medido sobre `fotoProcesada`; `null` = no medible).
- `texto: string` — el OCR **POST-banda** (el mismo texto que ya consume `senalDeLectura`;
  consenso-frankfurt FASE 4: `ocrBanda` ya sumó su resultado al texto antes del score).
- `faltaSeccion: boolean` — el resultado YA calculado de
  `faltaSeccionInferior(texto, clasificacion.pagina)` (P1: falta `SUMA TOTAL`; P≥2: falta
  `FIRMA`; página desconocida → false). Se recibe como parámetro para mantener el helper 100%
  puro y sin imports (el bridge ya lo computa — cero costo extra).

**Regla (por cada esquina faltante se exige evidencia de lectura de SU lado):**

| Esquina(s) faltante(s) | Evidencia exigida al texto |
|---|---|
| tope — `tl` o `tr` | `/E\s*-\s*14/i` (cabecera) **o** `/\b\d{15}\b/` (código 1D) |
| fondo — `bl` o `br` | `faltaSeccion === false` **Y** `/KIT[::\s.]*\d+/i` (el pie del impreso) |

- Perdón = **TODAS** las esquinas faltantes tienen su evidencia.
- `esquinas === null` o 4/4 → `false` (nada que perdonar; n/d jamás condena ni rescata).
- Una sola esquina sin evidencia → `false` (el cap se queda — conservador).
- La señal de secciones (`faltaSeccion === true`) es INCOMPATIBLE con el perdón de fondo por
  definición (la evidencia la incluye), y NO se perdona jamás por sí misma.

**Por qué es seguro:**
- Una acta realmente cortada por abajo NO puede leer `SUMA TOTAL` (última fila de datos P1)
  ni `FIRMA` (P≥2) — el OCR de secciones ya la condena ANTES y el perdón exige que esa señal
  esté limpia.
- Una acta realmente cortada por arriba no tiene cabecera E-14 ni código 1D legibles.
- El caso dudoso (corte por el MEDIO del margen inferior: `SUMA TOTAL` legible, `KIT`
  ilegible) → sin evidencia de pie → SIN perdón → cap 7.9 ADVERTENCIA (degradación
  conservadora: revisión manual, nunca RECHAZADA ni auto-envío riesgoso).

---

## 4. Spec por archivo (main @ f38a6aa — anchors de línea exactos)

### 4-A `src/lib/e14/senal-lectura.ts` — añadir al final del módulo

```ts
/** KIT e14-lectura-perdona-lazo-v1 — ¿es el lazo (esquinas fiduciales) un falso
 *  positivo según la LECTURA? «La lectura manda» (kit e14-score-lectura-v1)
 *  aplicada al gate: un fiducial faltante cuyo LADO está demostrado dentro del
 *  recorte por el OCR es falso positivo (margen corto del warp / sombra al
 *  filo). Evidencia de campo (ZIP mesa-001, 2026-10-17): acta COMPLETA —KIT 399
 *  y SUMA TOTAL leídos, sharpness 100— bloqueada SOLO por lazo inf-izq → cap
 *  7.9 → ADVERTENCIA. El pie leído ES la prueba de que el fondo está dentro.
 *
 *  Regla (§3 del kit): por CADA esquina faltante, evidencia de SU lado —
 *  tope (tl/tr): /E\s*-\s*14/i o /\b\d{15}\b/ · fondo (bl/br): !faltaSeccion
 *  (P1: SUMA TOTAL; P≥2: FIRMA) Y /KIT[::\s.]*\d+/i. Perdón = TODAS la tienen.
 *  faltaSeccionInferior (tinta ausente) NUNCA se perdona — eso no es un lazo.
 *
 *  PURO (sin DOM, sin imports) — testeable headless con bun (§6 del kit). */
export function lazoPerdonadoPorLectura(
  esquinas: { tl: boolean; tr: boolean; bl: boolean; br: boolean } | null,
  texto: string,
  faltaSeccion: boolean,
): boolean {
  if (!esquinas) return false;
  const faltan = (["tl", "tr", "bl", "br"] as const).filter((k) => !esquinas[k]);
  if (faltan.length === 0) return false;
  const topeDentro = /E\s*-\s*14/i.test(texto) || /\b\d{15}\b/.test(texto);
  const pieDentro = !faltaSeccion && /KIT[::\s.]*\d+/i.test(texto);
  return faltan.every((k) => (k === "tl" || k === "tr" ? topeDentro : pieDentro));
}
```

(La forma estructural de `esquinas` va inline a propósito: el módulo sigue siendo
dependencia-cero — el mismo contrato «PURO» del kit score-lectura.)

### 4-B `src/lib/e14/scanner-core-bridge.ts` — DOS sitios, MISMO patrón

**Import** (bloque del kit score-lectura, ~L84-86): añadir `lazoPerdonadoPorLectura` a la
importación existente desde `./senal-lectura`.

**Sitio 1 — ESCANEO** (anchors: `esquinas` ~L955, `recortada` L1030-1031, cap L1104-1106,
traza L1174):

Hoy:
```ts
const recortada =
  faltaSeccionInferior(texto, clasificacion.pagina) || ladoEsquina !== null;
```
Cambia a (con comentario de kit):
```ts
// KIT e14-lectura-perdona-lazo-v1 (§4-B): la LECTURA perdona al lazo — un
// fiducial faltante cuyo lado está demostrado dentro por el OCR es falso
// positivo (margen corto/sombra). La señal de secciones NUNCA se perdona.
// En SIM esquinas=ESQUINAS_OK (L955) → helper false → recortada idéntica a
// hoy (chips 8.2/7.0/4.3 intactos — §2 del kit).
const faltaSeccion = faltaSeccionInferior(texto, clasificacion.pagina);
const lazoPerdonado = lazoPerdonadoPorLectura(esquinas, texto, faltaSeccion);
const recortada = faltaSeccion || (ladoEsquina !== null && !lazoPerdonado);
```
El cap L1104-1106 (`if (recortada) score = Math.min(score, TECHO_ESCUDO_FONDO);`) **no se
toca** — ni su posición ni su valor.

Traza del log (~L1174): donde hoy va `${recortada ? " recortada=1" : ""}${ladoEsquina ? `
 lado=${ladoEsquina}` : ""} esquinas=${trazaEsq}`, añadir el token del perdón:
```ts
${lazoPerdonado ? " lazo=perdonado" : ""}
```
(debe quedar `… recortada=1 lado=inf-izq lazo=perdonado esquinas=FALTA_bl …` cuando aplique —
el log de auditoría es la evidencia de campo del perdón).

**Sitio 2 — RECORTE** (anchors: `esquinas` L1462-1463, `recortada` L1481-1482, cap L1516-1518,
traza L1566): MISMO patrón exacto — `faltaSeccion` + `lazoPerdonado` + `recortada`, y el MISMO
token ` lazo=perdonado` en su traza. El comentario cita el kit y el pitfall §9.9 (mismo
criterio en ambos pipelines — helper único).

### 4-C `scripts/qa-lectura-perdona.ts` — NUEVO (§6)

Ver §6. Convención del repo: `scripts/qa-*.ts` corridos con `bun` (como `qa-consenso.ts`).

---

## 5. Casos borde (todos cubiertos por el helper — QA §6)

1. **zip1 real (el caso objetivo):** `esquinas` con solo `bl=false`, texto con `SUMA TOTAL` +
   `KIT 399`, `faltaSeccion=false` → `true` → sin cap → score 8.3 → piso lectura FUERTE 8.5 →
   **OPTIMA → auto-envío**.
2. **zip2 real (control):** texto SIN `SUMA TOTAL` (cortado en INCINERADOS) →
   `faltaSeccion=true` → `pieDentro=false` → `false` → cap se queda + guard INCOMPLETA →
   RECHAZADA (sin cambio).
3. **4/4 esquinas** → `false` (nada que perdonar; hoy ya no condena por lazo — idéntico).
4. **`esquinas === null`** (no medible / <80×120) → `false` — la política «sin señal honesta no
   se condena» no se usa para RESCATAR, solo para no condenar.
5. **Tope:** `tl` faltante + `E-14` leído → `true`; `tl` faltante + texto sin cabecera ni
   código → `false`.
6. **Doble falta (tl+bl)** con evidencia de ambos lados → `true`; con UNA evidencia faltante →
   `false` (exigencia es por TODAS las faltantes — `every`).
7. **SUMA TOTAL legible pero KIT ilegible** (corte por el medio del margen) → `false` → cap
   7.9 ADVERTENCIA (degradación conservadora, §3).
8. **Página 2:** `faltaSeccion` = falta `FIRMA` → fondo no perdonado sin FIRMA; con FIRMA
   leída y KIT leído (el pie P2 trae KIT) → perdonado. Página desconocida →
   `faltaSeccion=false` → se evalúa por KIT/cabecera (conservador igual).
9. **SIM:** `esquinas = ESQUINAS_OK` (L955) → `faltan=[]` → `false` → `recortada` idéntica →
   chips 8.2/7.0/4.3 intactos (demostrado, no esperado).
10. **`ocrBanda`:** el texto llega POST-banda (el sello ya sumó) — el perdón usa el mismo
    texto que `senalDeLectura` (pitfall §9.8 del kit score-lectura, heredado).

---

## 6. Validación (gate §6 — todo verde antes de pushear)

1. **QA headless:** `scripts/qa-lectura-perdona.ts` con EXACTAMENTE estos casos (los textos de
   los casos 1-2 se copian de los `ocr.txt` de los ZIPs de campo — están en
   `download/fixture-*/` y en los ZIPs originales; mínimo: los 10 casos del §5 — recortar el
   texto real a su primera/última línea cuando aplique):
   - 1 → true (con `SUMA TOTAL`+`KIT 399` reales del zip1)
   - 2 → false (texto real del zip2 cortado en INCINERADOS)
   - 3..10 → según §5
   Salida: contador `N/N` y exit 1 si alguna falla. `bun scripts/qa-lectura-perdona.ts`.
2. **Lint + tipos:** `bun run lint` y `bunx tsc --noEmit` sin errores nuevos.
3. **Chips SIM:** captura con `simular` → los 3 desenlaces 8.2/7.0/4.3 y statuses idénticos
   (OPTIMA/ADVERTENCIA/RECHAZADA). La traza SIM dice `esquinas=sim`.
4. **Reproducción de campo con los fixtures** (necesita los ZIPs del dueño):
   - `original.jpg` del **zip1** por la vía de archivo (fuente archivo) → desenlace **OPTIMA /
     auto-envío** (score ≥8.3), traza con `lazo=perdonado` (si `bl` vuelve a fallar en el
     crop del fixture) o sin `recortada=1` en cualquier caso. CRITERIO: el desenlace ya NO es
     ADVERTENCIA por lazo.
   - `original.jpg` del **zip2** por la vía de archivo → **RECHAZADA INCOMPLETA** (sin cambio).
   - Nota honesta: la vía de archivo re-corre el pipeline completo sobre el JPEG del ZIP — el
     quad puede diferir levemente del campo; lo que se valida es la REGLA (con lazo bl + texto
     con KIT/SUMA → sin cap), no la reproducción bit a bit del quad.
5. **CI del PR:** checks + parity ×2 + Vercel en verde.

---

## 7. QA del dueño (en el puesto, 5 min)

1. Capturar la MISMA acta del zip1 (Frankfurt KIT 399, mesa 001) como en campo → debe
   **auto-enviarse** (el desenlace ADVERTENCIA del 11:56 se vuelve OPTIMA).
2. Capturar demasiado cerca (como el zip2) → RECHAZADA «ALÉJATE UN POCO» sigue igual.
3. SIM de la demo → chips 8.2 / 7.0 / 4.3 intactos.
4. (Si hay acta con esquina real recortada a propósito — la esquina física fuera del encuadre —
   debe seguir a ADVERTENCIA/RECHAZADA: el perdón exige lectura del lado.)

## 8. Rama base y orden de merges

- Rama: **`fix/lectura-perdona-lazo`** desde **main @ `f38a6aa`** (o el main del momento).
- ORDEN: este kit se mergea **DESPUÉS** del kit T-B (`e14-diag-campos-aditivos-v1`, update del
  PR #15). Motivo: ambos editan la línea de traza del bridge (`diag=1` de T-B y
  `lazo=perdonado` de este kit) — mergeado T-B primero, el rebase de este kit resuelve la
  línea del log manteniendo TODOS los tokens: `… lectura=… anclas=… piso=… diag=1
  lazo=perdonado …` (mismo espíritu «mantener ambos» del §8 del kit score-lectura).
- Si T-A sale primero por necesidad de campo: igualmente es correcto, y T-B rebaseará encima.

## 9. Pitfalls (10 — los que la historia del repo ya cobró)

1. **NO condonar `faltaSeccionInferior`:** el perdón es SOLO para el lazo (esquinas). La señal
   de secciones es lectura pura de tinta — si falta, el cap se queda (zip2).
2. **NO tocar el cap ni su orden:** la línea `if (recortada) score = Math.min(score,
   TECHO_ESCUDO_FONDO)` queda EXACTA. Cambiar la condición de `recortada`, no el cap.
3. **NO «rescatar» con `esquinas === null`:** n/d no condena (política vigente) pero tampoco
   perdona. Solo evidencia positiva de lectura perdona.
4. **Evidencia por TODAS las faltantes (`every`):** con doble falta y una sola evidencia, NO
   hay perdón. Un `some` aquí convertiría un doble corte en auto-envío.
5. **Texto POST-banda:** el helper se llama con el mismo `texto` de `senalDeLectura` (después
   de `ocrBanda`) — llamarlo con un texto previo rompe la evidencia del sello/pie.
6. **Mismo criterio en AMBOS pipelines** (escaneo ~L1030 y recorte ~L1481 — pitfall §9.9 del
   kit score-lectura): un solo sitio corregido deja el rescate manual con reglas distintas.
7. **SIM:** no añadir guards nuevos «por si acaso» — el no-op ya está demostrado
   (`ESQUINAS_OK`, §5.9). Un guard extra ensucia la traza y el diff sin efecto.
8. **NO cambiar el copy del aviso 118 ni los rechazos:** el perdón solo silencia el aviso
   cuando no hay condena; el display de «ACTA RECORTADA · lado» sigue para el caso no
   perdonado.
9. **Trazas: token atómico ` lazo=perdonado`** — sin espacios raros ni comas; el log de
   auditoría es parseado a ojo por el dueño y por los reportes (y T-B/T-A comparten la línea:
   mantener TODOS los tokens al resolver conflictos).
10. **Sin re-encodear ni re-medir:** el helper consume `esquinas`/`texto`/`faltaSeccion` YA
    calculados (costo 0). Recalcular `marcasEsquina` o `faltaSeccionInferior` dentro del
    helper duplica medición y puede desincronizar la traza.

---

### Contrato de entrega del agente

- PR `fix/lectura-perdona-lazo` → main, CI 100% verde (checks + parity ×2 + Vercel).
- `scripts/qa-lectura-perdona.ts` con salida `N/N` (mínimo los 10 casos del §5, casos 1-2 con
  los textos OCR REALES de los ZIPs).
- `docs/REPORTE-lectura-perdona-lazo-v1.md`: evidencia de la reproducción de campo (§6.4) con
  los desenlaces antes/después de los 2 fixtures + worklog + entrada AGENTS.md.
- Si algo del §6.4 no es reproducible (p. ej. el fixture no dispara el lazo bl en dev), NO
  disimular: documentarlo en el reporte y dejar el caso 1-2 del QA headless como gate.
