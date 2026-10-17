# KIT e14-diag-campos-aditivos-v1 — des-stub del diagnóstico + update del PR #15

> Delegación para el agente. **Actualiza el PR #15 EXISTENTE** (`feat/diagnostico-autoenvio`)
> — NO se abre rama nueva. Base de destino: **main @ `f38a6aa`** (cadena #10 → #12 → #14 → #13
> mergeada). Prioridad: **ALTA y PRIMERO** en la cola (los otros dos kits de esta tanda se
> mergean después de este).
>
> Contexto: los ZIPs de campo del 2026-10-17 (mesa-001/mesa-002) salieron de una build con el
> PR #15 aplicado y funcionaron de punta a punta — PERO el diagnóstico reportó
> `lectura: { nivel: "—", anclas: 0 }`, `sharpnessHi: null`, `contrastPapel: null` en AMBOS.
> Causa verificada en el código: NO es un bug en runtime — el PR #15 nació ANTES de mergear el
> score v2 (PR #13) y dejó esos campos como stub documentado («null hasta que main la herede,
> §8»). Main ya heredó el score v2 → este kit cumple esa promesa.

---

## 0. Decisión del dueño (literal)

- El dueño (2026-10-17, tras revisar los ZIPs de campo): **«genera los 3 kits completos para
  delegarlos al agente»** — esta es la **T-B**, propuesta textual:
  > «**T-B · Actualizar PR #15 sobre main y des-stubear el diagnóstico:** rebase (ya está dirty
  > por docs), y en `diagnostico.ts` reemplazar los stubs por los valores reales que main ya
  > tiene: `sharpnessHi/contrastPapel` del objeto calidad, `lectura {nivel, anclas}` de la
  > `senal` que ya se calcula en el mismo flujo (L1050/L1503), y capturar los techos aditivos
  > `piso-lectura-FUERTE`/`lectura-DEBIL` en `techosDiag`. Con eso el reporte de comportamiento
  > te muestra el cruce lectura×auto de verdad.»
- Estado verificado del PR #15 (2026-10-17): abierto, CI **4/4 verde en el head**
  (checks + parity ×2 + Vercel), `mergeable: dirty` — conflictos SOLO de docs contra el main
  nuevo. El head de la rama NO tiene el score v2 (su bridge ni importa `senal-lectura`).

---

## 1. Evidencia (por qué los ZIPs dijeron `anclas 0` con un OCR que leyó 9 anclas)

- `e14-diag-mesa-001-115643-i1.zip` → `diagnostico.json`: `"lectura": {"nivel": "—", "anclas":
  0, "chars": 621}` con un `ocr.txt` que contiene REGISTRADURÍA · CONSULADO · PAÍS · ZONA ·
  PUESTO · MESA 001 · KIT 399 · código 15d · E-14 = **9/10 anclas** (solo falla «Ver Pag» —
  «Pag1d2» sin la «e» no matchea esa regex, comportamiento conocido y NO objeto de este kit).
- El módulo `senal-lectura.ts` en main es correcto (auditado) y el bridge de main SÍ lo llama
  en ambos pipelines con la traza `lectura=/anclas=/piso=` — el score v2 corrió en campo
  (consistencia: si la señal hubiera sido DEBIL, el zip1 habría caído a 5.9 RECHAZADA; quedó
  7.9 = piso FUERTE + cap recortada). Solo el REPORTAJO estaba apagado.
- `diagnostico.ts` (rama #15) L90-100 — el stub textual:
  ```ts
  metricas: {
    sharpness: p.metricas.sharpness,
    // v2 score-lectura (PR #13) — null hasta que main la herede (§8).
    sharpnessHi: null,
    brightness: p.metricas.brightness,
    contrast: p.metricas.contrast,
    contrastPapel: null,
    contrasteEfectivo: p.metricas.contrasteEfectivo,
  },
  level: p.level,
  lectura: { nivel: "—", anclas: 0, chars: p.lecturaChars },
  ```
- Consecuencias hoy: el cruce «LECTURA × AUTO-ENVÍO» del comportamiento.txt agrupa todo en
  `—`; `causaPrincipal` no puede disparar sus ramas de lectura (`casi nada leído`,
  `lectura débil frena el piso`); el ZIP no muestra las métricas v2.

---

## 2. Alcance

### CAMBIA

1. **Rebase/update de `feat/diagnostico-autoenvio` sobre main @ `f38a6aa`** (§4-A — guía de
   conflictos incluida).
2. `src/lib/e14/diagnostico.ts`: interfaz del builder + mapeo (§4-B).
3. `src/lib/e14/scanner-core-bridge.ts` (post-rebase): los 2 sitios de adjunción pasan los
   campos reales; `techosDiag` captura los 2 tokens aditivos del score v2 (§4-C).
4. `src/lib/e14/types.ts`: tipo de `lectura.nivel` → `"—" | NivelLectura` (§4-D).

### NO CAMBIA

- La LÓGICA del desenlace: NADA de lo que este kit toca altera status/score/rechazo/auto-envío.
  Es observación pasiva (§9.7 del kit PROD-3): si algo falla, `diag = null` y el pipeline sigue.
- `causaPrincipal` y el formato del ZIP: ya fueron escritos para estos campos (las ramas
  `d.lectura.nivel === "DEBIL"` y `conTecho("lectura-DEBIL")` existen en L28-48) — solo
  empiezan a disparar. CERO cambios ahí.
- Los 2 ZIPs ya descargados por el dueño: histórico, no se regenera.
- El `localStorage e14-diag-v1` cap 500: los registros viejos con `"—"` siguen siendo válidos
  (por eso el tipo conserva `"—"`, §4-D).
- SIM: doble guard intacto — el diagnóstico nunca se adjunta en SIM (§9.2 del kit PROD-3).

---

## 3. Contratos verificados en main (los campos EXISTEN — no inventar nada)

| Campo | Dónde vive en main | Valor esperado |
|---|---|---|
| `calidad.sharpnessHi` | `calidadDeActa()` L524 — corre en AMBOS pipelines (L984 escaneo / L1416 recorte); hace merge `{...calidad, ...extra}` con `senalHiResDeCanvas` (L560-562); fallo → `0/0` (L575) | número (0 en fallback) |
| `calidad.contrastPapel` | mismo objeto/merge | número |
| `senal` (C3) | `senalDeLectura(texto, clasificacion.parciales)` — escaneo L1050 / recorte L1503; `{ nivel: FUERTE\|MEDIA\|DEBIL, chars, anclas }` | en scope en los 2 sitios de adjunción |
| Piso/techo v2 | escaneo L1052-1055 / recorte L1505-1508 (`PISO_LECTURA_FUERTE = 8.5`, `TECHO_LECTURA_DEBIL = 5.9`) | condiciones ya evaluadas |
| `TECHO_ESCUDO_FONDO` | L129 = 7.9 | ya capturado por #15 |

---

## 4. Spec por archivo

### 4-A Rebase/update del PR #15 (hacer PRIMERO, antes de editar nada)

```bash
git checkout feat/diagnostico-autoenvio && git fetch origin
git merge origin/main        # o rebase — el repo usa merges (protocolo actual)
```

**Conflictos esperados (3 archivos, todos con resolución «mantener AMBOS»):**

1. **`AGENTS.md`** — la entrada del kit diagnóstico (HEAD) vs las entradas de la cadena
   (score-lectura/motor/PROD-1 de main): **conservar las dos partes**, orden cronológico del
   archivo.
2. **`docs/worklog.md`** — mismo patrón append-only: conservar AMBOS bloques.
3. **`src/lib/e14/scanner-core-bridge.ts`** — el único conflicto REAL, 2-3 hunks:
   - **Hunk scoreDeCalidad:** #15 añade `const scoreVisual = score;` justo tras
     `scoreDeCalidad`; #13 añadió el bloque C3 (`const senal = senalDeLectura(...)` +
     piso/techo). **Orden final obligatorio:**
     `scoreDeCalidad` → `scoreVisual` (#15) → **bloque C3 de #13** → inyección SIM → caps.
   - **Línea del log de auditoría:** #13 añadió los tokens `lectura=… anclas=… piso=…`; #15
     añade `${diag ? " diag=1" : ""}`. **La línea final debe llevar TODOS los tokens:**
     `… ocrIn=… ocr=… senal=… vacia=… votos=… recortada=… lado=… esquinas=… lectura=… anclas=… piso=… diag=1 …`
     (mismo espíritu «mantener ambos tokens» del §8 del kit score-lectura; los tokens de
     `ocrIn=`/`ocr=`/`motor` ya están en main — no perderlos).
   - **Sitios de adjunción / return:** #13 no tocó el return; si el 3-way marca ruido cerca,
     mantener la adjunción de #15 (`acta.diagnostico = diag`) + el bloque C3 de #13 completos.
4. **NO regenerar `bun.lock`/`package.json`**: #15 añadió `fflate` (+1 línea cada uno) y main
   no tocó dependencias → el merge los combina sin conflicto. Si apareciera conflicto ahí,
   resolver a favor de AMBAS líneas y re-Instalar (`bun install`) para validar el lock.

Post-rebase: `bun install && bun run lint && bunx tsc --noEmit` — DEBE quedar limpio ANTES de
los edits de §4-B (así los errores, si los hay, se atribuyen al merge y no al kit).

### 4-B `src/lib/e14/diagnostico.ts` — des-stub

**Interfaz del builder** (params, ~L60-82): extender

```ts
metricas: {
  sharpness: number;
  // KIT e14-diag-campos-aditivos-v1: métricas v2 de main (calidadDeActa §3).
  sharpnessHi: number;
  brightness: number;
  contrast: number;
  contrastPapel: number;
  contrasteEfectivo: number;
};
level: string;
lecturaChars: number;
// KIT e14-diag-campos-aditivos-v1: la señal de lectura que el bridge ya
// calcula (C3 del score v2) — misma instancia, SIN recálculo (pitfall §9.10).
senalLectura: { nivel: NivelLectura; anclas: number };
```

**Mapeo** (sustituir el stub L90-100):

```ts
metricas: {
  sharpness: p.metricas.sharpness,
  sharpnessHi: p.metricas.sharpnessHi,      // AHORA REAL (fallo → 0, §3)
  brightness: p.metricas.brightness,
  contrast: p.metricas.contrast,
  contrastPapel: p.metricas.contrastPapel,  // AHORA REAL
  contrasteEfectivo: p.metricas.contrasteEfectivo,
},
level: p.level,
// KIT e14-diag-campos-aditivos-v1: REAL — la señal del C3 (L1050/L1503).
lectura: {
  nivel: p.senalLectura.nivel,
  anclas: p.senalLectura.anclas,
  chars: p.lecturaChars,
},
```

Importar `NivelLectura` desde `./senal-lectura` (type-only). El TXT (L233, L256, L259) ya
imprime `sharpnessHi ${d.metricas.sharpnessHi ?? "—"} · …` y
`lectura: ${d.lectura.nivel} (anclas ${d.lectura.anclas}, …)` — **sin cambios**: con el stub
muerto, salen reales solos.

### 4-C `src/lib/e14/scanner-core-bridge.ts` (ya sobre main) — 2 sitios de adjunción

**Sitio ESCANEO** (el bloque `construirDiagnostico({…})` que #15 inserta tras el gate, hoy
~L1010-1080 del PR; tras el rebase vive después del C3 de main):

1. En `metricas:` añadir `sharpnessHi: calidad.sharpnessHi,` y `contrastPapel:
   calidad.contrastPapel,` (mismo objeto `calidad` que ya usa `contrasteEfectivoDe(calidad,
   ocrLegible)` — §3).
2. Añadir el parámetro nuevo: `senalLectura: { nivel: senal.nivel, anclas: senal.anclas },`
   (la `senal` del C3 de main — MISMA instancia; prohíbido recalcular).
3. **`techosDiag` — tokens aditivos §8 del kit score-lectura** (dentro del bloque
   `techosDiag`, junto a los caps existentes, condición espejo del C3):

   ```ts
   // KIT e14-diag-campos-aditivos-v1 (§8 score-lectura): ajustes de LECTURA
   // del score v2 — NO son caps: observabilidad del ajuste (piso sube,
   // techo baja). Condición espejo exacta del C3 (L1050-1055).
   if (senal.nivel === "FUERTE" && calidad.level !== "poor")
     techosDiag.push("piso-lectura-FUERTE:8.5");
   if (senal.nivel === "DEBIL") techosDiag.push("lectura-DEBIL:5.9");
   ```

**Sitio RECORTE** (segundo `construirDiagnostico` de #15, tras el gate del rescate): los
MISMOS 3 cambios (sharpnessHi/contrastPapel + senalLectura + tokens aditivos), usando la
`senal` del sitio recorte (L1503). Mismo criterio en ambos (pitfall §9.9 score-lectura).

### 4-D `src/lib/e14/types.ts` — tipo de `DiagnosticoActa.lectura.nivel`

Hoy (rama #15): `nivel: string`. Cambiar a:

```ts
// KIT e14-diag-campos-aditivos-v1: "—" solo en registros previos al score v2
// (localStorage e14-diag-v1 — los viejos siguen siendo válidos).
nivel: NivelLectura | "—";
```

importando `NivelLectura` desde `./senal-lectura`. Con el des-stub, los registros NUEVOS
siempre traen FUERTE/MEDIA/DEBIL.

---

## 5. Casos borde

1. **Registro viejo en localStorage** (con `"—"`): el reporte de comportamiento lo agrupa en
   el bucket `—` del cruce — válido y honesto (mezcla pre/post score v2 documentada).
2. **`sharpnessHi === 0`** (fallback de `calidadDeActa`): se reporta `0` REAL — el TXT dice
   `sharpnessHi 0` (no `—`). Es honesto: 0 = «no se pudo medir, degradó». NO convertir 0 →
   null para «verse bonito».
3. **Piso que no gana:** FUERTE + `level: poor` → piso NO aplica (condición del C3) → el token
   `piso-lectura-FUERTE` NO se emite (condición espejo exacta — §4-C.3).
4. **DEBIL + caps posteriores altos:** el token `lectura-DEBIL:5.9` aparece AUNQUE un cap
   posterior (recortada 7.9 > 5.9) no haya cambiado el resultado final — correcto: el techo SÍ
   aplicó al score antes del cap; `score.techos` cuenta la historia completa.
5. **SIM:** los sitios de adjunción están dentro del `if (!opciones.simular)` — doble guard
   intacto, cero diagnóstico en SIM.
6. **`anclas` con texto post-banda:** la `senal` del C3 ya consume el texto post-banda — el
   reporte refleja EXACTAMENTE lo que el score usó (misma instancia — pitfall §9.10).
7. **Falló construirDiagnostico** (try/catch de #15): `diag = null` → log sin `diag=1` — el
   desenlace NO se toca (observación pasiva, §9.7 PROD-3).

---

## 6. Validación (gate — todo verde antes de pushear)

1. **Post-rebase, pre-edit:** `bun run lint && bunx tsc --noEmit` limpios (§4-A último punto).
2. **QA headless de la señal (ya existe en main del kit score-lectura):** correr el smoke de
   `senal-lectura.ts` que dejó el kit v1 — debe seguir 5/5 (no se toca el módulo).
3. **Reproducción con los fixtures de campo** (los 2 `original.jpg` de los ZIPs del dueño, vía
   fuente archivo):
   - **zip1 (mesa-001):** `diagnostico.json` del desenlace debe mostrar
     `lectura: { nivel: "FUERTE", anclas: ≥8, chars: ~621 }` y `sharpnessHi > 0`,
     `contrastPapel > 0`; `score.techos` puede incluir `piso-lectura-FUERTE:8.5` (+ el cap
     `recortada:7.9` si el lazo falla en dev — coherente con campo).
   - **zip2 (mesa-002):** `lectura` debe salir DEBIL o MEDIA (texto corto, sin mesa leída por
     OCR — 379 chars, sin MESA en el texto del crop… ver §5.8: el texto zip2 NO contiene
     `MESA:` (el crop corta antes) — la señal sale de anclas parciales: E-14, REGISTRADURÍA,
     CONSULADO, PAÍS, ZONA, PUESTO + código → MEDIA/DEBIL según cuenta; NO forzar el valor
     esperado: aceptar lo que `senalDeLectura` produzca sobre ese texto y documentarlo) y
     `score.techos` con `recortada:7.9, incompleta:6.4` + `lectura-…` si aplicó.
   - **comportamiento.txt:** el cruce «LECTURA × AUTO-ENVÍO» ya NO agrupa todo en `—`.
4. **Simulación:** chips 8.2/7.0/4.3 intactos y SIN `diag=1` en sus trazas (guard SIM).
5. **CI del PR #15 tras el push:** checks + parity ×2 + Vercel en verde y `mergeable` limpio.

## 7. QA del dueño (5 min)

1. Capturar una acta en el puesto → si NO se auto-envía, el ZIP nuevo debe decir la lectura
   real (p. ej. `lectura: FUERTE (anclas 9)` — y `causaPrincipal` puede ahora culpar a la
   lectura cuando sea el caso).
2. El card COMPORTAMIENTO de RESUMEN muestra el cruce lectura×auto con buckets FUERTE/MEDIA/
   DEBIL (ya no todo en `—`).
3. Los ZIPs viejos del 2026-10-17 siguen abriendo bien (tipo `"—"` tolerado).

## 8. Rama base y orden de merges

- **Se mergea PRIMERO** de la tanda (es un update del PR #15 existente — merge directo tras
  CI verde). Después: T-A `fix/lectura-perdona-lazo` (rebaseará sobre el main con este kit —
  resolver la línea del log manteniendo TODOS los tokens: `lectura= anclas= piso= diag=1
  lazo=perdonado`). T-C (lab) cuando sea.
- Al merge: **conservar el merge commit** con el mensaje estándar del repo (protocolo vigente).

## 9. Pitfalls (10)

1. **NO recalcular la señal en el builder:** pasar la MISMA `senal` del C3. Un
   `senalDeLectura(texto, …)` nuevo en el builder puede divergir del score si el texto cambió
   (banda, re-OCR) y el reporte mentiría sobre lo que el score usó.
2. **NO tocar la lógica del desenlace:** este kit no cambia ni un status. Si un edit parece
   «mejorar» el gate/score, está fuera de alcance — proponerlo aparte.
3. **Conflictos del bridge = «mantener AMBOS»:** el hunk scoreDeCalidad necesita el orden
   exacto `scoreDeCalidad → scoreVisual → C3 → SIM → caps` (§4-A.3). Invertir el orden rompe
   el chip SIM o el scoreVisual.
4. **La línea del log lleva TODOS los tokens** (incl. `ocrIn=`/`ocr=` de PROD-1/2): perder
   tokens al resolver el conflicto rompe el parseo a ojo y la auditoría de campo.
5. **`sharpnessHi: 0` es honesto** — no re-mappear a `null` (§5.2). El `?? "—"` del TXT solo
   aplica a registros viejos.
6. **El tipo conserva `"—"`** (§4-D) por el localStorage cap 500 — removerlo rompe el render
   del reporte con datos viejos.
7. **Doble guard SIM intacto** — mover la adjunción fuera del `if (!opciones.simular)` filtraría
   ZIPs en la demo (§9.2 PROD-3).
8. **`fflate` ya está en package.json de #15** — no re-instalar ni actualizar versiones en este
   kit (cero cambios de dependencias; el merge de lock se valida con `bun install`).
9. **Rebase antes de editar:** hacer §4-B/C/D DESPUÉS del merge de main limpio — editar sobre
   la rama sin rebasear duplica trabajo y siembra conflictos falsos.
10. **El cruce «LECTURA × AUTO-ENVÍO» es agrupación, no promesa:** no «arreglar» el bucket
    `—` filtrándolo — los registros viejos con `—` son datos reales del antes.

---

### Contrato de entrega del agente

- PR #15 actualizado (push a `feat/diagnostico-autoenvio`), CI 4/4 verde, mergeable limpio →
  **listo para merge del dueño** (o merge directo si el protocolo de la sesión lo permite).
- `docs/REPORTE-diag-campos-aditivos-v1.md`: la validación §6.3 con los 2 fixtures — incluir
  el `diagnostico.json` ANTES (los ZIPs de campo) y DESPUÉS (fixture) de los mismos actas, y
  el texto de la línea de log final con todos los tokens.
- worklog + AGENTS.md actualizados con el kit.
- Si el rebase revela un conflicto NO documentado en §4-A: resolverlo con el mismo principio
  «mantener ambos» y DOCUMENTARLO en el reporte (no decidir en silencio).
