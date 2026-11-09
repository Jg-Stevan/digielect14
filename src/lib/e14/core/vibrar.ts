/**
 * KIT e14-remediacion-movil-v1 (D5 — #19): vibración SEGURA sin ensuciar la
 * consola.
 *
 * PROBLEMA (#19): `navigator.vibrate()` llamada SIN gesto de usuario vigente
 * es bloqueada por Chrome/WebView y registra un error en consola
 * (NotAllowedError / «user gesture required»), ensuciando el registro de
 * campo. Los call-sites históricos podían caer en ese caso: el destello de
 * captura corre tras `await`s (el gesto puede haber expirado) y la vibración
 * de comparación del visor la dispara un `setTimeout` de 350 ms — jamás hay
 * gesto en ese timer.
 *
 * POLÍTICA del helper:
 *  · Guard ANTES de llamar: la API debe existir (`'vibrate' in navigator` —
 *    no existe en iOS Safari) Y el documento debe tener activación de
 *    usuario (`navigator.userActivation.hasBeenActive === true`), la misma
 *    condición que Chrome exige para no bloquear la llamada.
 *  · Sin API o sin gesto ⇒ no-op SILENCIOSO (ni warning ni log).
 *  · try/catch TOTAL: la vibración es cosmética y JAMÁS rompe al llamador
 *    (misma regla §2.4 del módulo obs).
 */

/** Vibración best-effort de `ms` ms. Sin gesto o sin API ⇒ no-op silencioso. */
export function vibrarSeguro(ms: number): void {
  try {
    if (typeof navigator === "undefined") return; // SSR/tests node
    if (!("vibrate" in navigator)) return; // iOS Safari: no-op (sin ensuciar)
    // Guard de gesto (#19): `hasBeenActive` es true si la página recibió ALGÚN
    // gesto desde la carga — la condición real que Chrome valida para permitir
    // `vibrate`. Consultarlo ANTES evita el error bloqueado en consola.
    if (navigator.userActivation?.hasBeenActive !== true) return;
    navigator.vibrate(ms);
  } catch {
    /* no-op: jamás rompe al llamador */
  }
}
