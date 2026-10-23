/**
 * useSaludVivo — snapshot de salud del dispositivo para el PanelDev (KIT
 * e14-observabilidad-v1, agente 2 · C6).
 *
 * Reglas del kit:
 *  · Snapshot inicial + refresco cada 30 s SOLO mientras el panel está
 *    abierto (`activo`) — el timer se limpia al desmontar/apagar;
 *    NUNCA un timer global de UI.
 *  · Con modo dev OFF el panel no existe → CERO timers/listeners de salud
 *    (criterio de aceptación 1 del agente 2).
 *
 * FASE 0: `obtenerDispositivo()` del puente responde `null` honesto (el
 * núcleo obs/ no existe aún); FASE 1 delega en obs/dispositivo.ts sin
 * cambiar a los consumidores.
 */
import { useCallback, useEffect, useState } from "react";
import { obtenerDispositivo, type SnapshotDispositivo } from "./puente";

/** Intervalo de refresco del snapshot EN VIVO (solo con panel abierto). */
const INTERVALO_SALUD_MS = 30_000; // interno (knip: sin export sin consumidor)

export function useSaludVivo({ activo }: { activo: boolean }): {
  snapshot: SnapshotDispositivo | null;
  refrescar: () => Promise<void>;
} {
  const [snapshot, setSnapshot] = useState<SnapshotDispositivo | null>(null);

  const refrescar = useCallback(async () => {
    try {
      setSnapshot(await obtenerDispositivo());
    } catch {
      setSnapshot(null); // el rastreo jamás rompe la app (regla de oro 4)
    }
  }, []);

  useEffect(() => {
    if (!activo) return;
    void refrescar();
    const t = window.setInterval(() => void refrescar(), INTERVALO_SALUD_MS);
    return () => window.clearInterval(t);
  }, [activo, refrescar]);

  return { snapshot, refrescar };
}
