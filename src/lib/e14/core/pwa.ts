/**
 * F-PWA — instalación de la app (PWA) en el móvil.
 *
 * La instalación va por el canal OFICIAL del navegador: el aviso/banner de
 * instalación de Chrome (install prompt). ANTES este módulo interceptaba
 * `beforeinstallprompt` con `preventDefault()` para disparar un botón propio
 * («Instalar app»); desde KIT e14-instalacion-oficial-v1 esa interceptación y
 * la píldora personalizada se retiraron: Chrome muestra SU banner y la app no
 * lo suprime. En iOS Safari no existe prompt nativo — el usuario instala con
 * Compartir → Añadir a pantalla de inicio.
 *
 * Único trabajo restante: registrar el Service Worker (offline + banner de
 * nueva versión E-04).
 */

/** Registra el Service Worker (producción: https/distinto de localhost). */
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (window.location.protocol !== "https:") return; // el deploy (Cloudflare Pages) es https; localhost dev se salta
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const register = () => {
    navigator.serviceWorker.register(`${base}/sw.js`).catch(() => {
      /* sin SW la app funciona igual (solo pierde el offline) */
    });
  };
  // B15: el listener "load" vive dentro de un efecto — si la hidratación
  // llega DESPUÉS del evento load (gama baja / red lenta), nunca dispara y
  // la app se queda sin offline. Si ya cargó, registrar inmediatamente.
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
