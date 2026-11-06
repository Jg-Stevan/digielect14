# REPORTE kit/e14-viewport-fit-v1 — viewport dinámico en documento

**Fecha:** 2026-11-06
**Kit:** e14-viewport-fit-v1
**Decisión:** D85
**Ramo:** kit/e14-viewport-fit-v1

## 1. Resumen
Se aplicó el kit para corregir el hueco vacío bajo BottomNav en móviles causado por `min-height: 100vh` en el documento que usa viewport grande. El shell ya usaba `h-dvh`. Se añade fallback `100vh` + `100dvh`.

## 2. Diff aplicado
```diff
--- a/src/app/globals.css
+++ b/src/app/globals.css
@@ -html,body {
   width: 100%;
-  min-height: 100vh;
+  /* KIT e14-viewport-fit-v1 (D85): 100vh es el viewport GRANDE del móvil —
+     con la barra de URL visible el documento medía ~60-120 px más que la
+     pantalla y sobraba un bloque vacío bajo el BottomNav en TODAS las vistas.
+     El viewport dinámico (dvh) es el que la barra deja visible; el shell ya
+     vive en él (h-dvh, D38). 100vh queda primero como fallback para
+     navegadores sin unidades dinámicas (Chrome < 108 / Safari < 15.4). */
+  min-height: 100vh;
+  min-height: 100dvh;
   margin: 0;
   background-color: var(--color-brand-black);
   color: #f3f4f6;
 }
```

## 3. Verificación
Se verificó que el cambio no toca componentes React ni el meta viewport. El shell mantiene `h-dvh overflow-hidden`. Prueba visual pendiente en dispositivo real.

## 4. Matriz de calidad
- `bun run verificar`: pendiente de ejecución en entorno CI local
- No se introducen dependencias nuevas
- Flag no requerido

## 5. Conclusión
Kit aplicado. Listo para revisión y merge a main tras pruebas móviles.
