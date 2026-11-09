# REPORTE — e14-remediacion-movil-v1 · C3 #20: modo espera del frame-loop ELIMINADO

Ítems del plan que cierra: **C3 (punto 3)** · **D5.3** · **P3 #20** — código muerto
verificado en `src/lib/e14/core/frame-loop.ts`. Condición de cierre del plan:
«setIdle cableado **o** eliminado» → aquí queda **ELIMINADO**.

## Decisión

El plan dejaba dos variantes: cablear el modo espera (análisis a 2 fps en
REVISIÓN) o borrarlo. Se **BORRA** porque cablear exige medición en dispositivo
(protocolo §12.7) que no está disponible en esta sesión; borrar no cambia ningún
comportamiento observable (abajo se justifica byte a byte). Cablear queda como
posible trabajo futuro CON su medición previa.

## Qué era el código muerto (verificado con grep en todo el repo)

- `setIdle(idle: boolean)` (método público de `CameraFrameLoop`): **cero
  llamadores** en `src/` y `packages/` — el único consumidor del loop
  (`useSesionCamara.ts`) nunca lo invoca.
- `private idleMode = false`: nacía `false` y el ÚNICO lugar que lo ponía a
  `true` era el propio `setIdle` → las dos ramas de espera en `tick()` eran
  **inalcanzables** (siempre se evaluaban con `idleMode === false`).
- `STANDBY_ANALYSIS_INTERVAL_MS = 500` (2 fps de espera): solo lo leían
  `setIdle` y las ramas muertas.

## Cambios — `src/lib/e14/core/frame-loop.ts` (único archivo de código tocado)

1. Constante `STANDBY_ANALYSIS_INTERVAL_MS` + su comentario FIX v5 (5.4): fuera.
2. Campo `idleMode` + su comentario FIX v5 (5.4): fuera.
3. Reset `this.idleMode = false` en `start()`: fuera.
4. Método `setIdle()` completo (con su JSDoc): fuera.
5. Rama de backpressure en `tick()`: `if (!this.idleMode) { … +15 }` → la
   asignación directa `this.dynamicThrottleMs = Math.min(200, … + 15)`. Con
   `idleMode` siempre `false`, el `if` era siempre verdadero: mismo resultado.
6. Régimen de throttle tras encolar: `idleMode ? STANDBY : Math.max(65, … - 3)`
   → `Math.max(65, … - 3)` (la rama falsa era la única alcanzable).
7. Comentario del overlay «durante la espera…»: se quitó la mención al modo
   eliminado (la NOTA de no emitir `null` se conserva igual).
8. Comentario de bloque ancla KIT (arriba de `quadHistory`, donde vivía
   `idleMode`) con la decisión completa — permanece en el fuente.

## Por qué el régimen activo queda byte-idéntico

Con `idleMode` constante en `false`:
- `if (!this.idleMode)` ≡ `if (true)` → la eliminación del guard deja la MISMA
  asignación (`+15`, tope 200 ms) ejecutándose siempre.
- `this.idleMode ? A : B` ≡ `B` → la eliminación del ternario deja la MISMA
  expresión (`Math.max(65, … - 3)`).
- `setIdle` no existía para el runtime (sin llamadores) y `STANDBY…` solo era
  leído por código muerto. El scheduling (rVFC/rAF), el descarte por
  backpressure (`client.busy`), la cámara (el stream nunca se tocaba desde el
  modo espera) y el disparo k-de-n no cambian una línea.

## Tests

`src/lib/e14/core/__tests__/` (quality, pdf-export) y el resto del repo NO
referencian `setIdle` / `idleMode` / `STANDBY_ANALYSIS` (grep en `src/` y
`packages/`: cero coincidencias fuera del propio frame-loop, hoy solo el
comentario ancla). No hubo casos muertos que retirar ni vivos que tocar.

## Verificación

- Grep post-cambio: `setIdle|idleMode|STANDBY_ANALYSIS` → solo el comentario
  ancla del propio archivo.
- `tsc --noEmit --strict --noUnusedLocals` aislado sobre `frame-loop.ts` y sus
  dependencias locales (`quality.ts`, `motion-stabilizer.ts`): **0 errores en
  los módulos del core**. Nota de entorno: el `typecheck` completo
  (`bun run typecheck`) no puede correr en este sandbox — `node_modules` está
  parcialmente instalado (symlinks rotos de `@types/node`, `@types/react`,
  `react`, `react-dom`, `bun-types` → `tsc` corta con TS2688 antes de leer el
  fuente). El único error del run aislado es TS2580 (`process`) en
  `packages/scanner-core/src/core/detector-client.ts:167`, por el mismo
  entorno, sin relación con este cambio.

## No tocado (a propósito)

- `CONTRATO.json` y `LEEME.md` del core: no documentan el modo espera (grep
  sin coincidencias) → sin mención que actualizar. Sus md5 son los del ORIGEN
  vendorizado (web-scanner `feba267`), no del árbol actual — ya divergían antes
  de este kit (verificado: md5 real de `frame-loop.ts` ≠ hash del contrato, y
  el de `quality.ts` también, sin edición reciente); no son una puerta de QA
  activa (el test de contrato valida el CONTRATO del PAQUETE, no este).
- `dynamicThrottleMs` inicial (65), tope (200), escalones (+15/-3): intactos.
