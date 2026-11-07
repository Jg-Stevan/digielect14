/** Ítem 3.6 (costura ③): shim + condiciones de salud de ESTA app. */
import { configurarObsBase } from "@jg-stevan/scanner-core/obs-base/config";
import { leerModoDev, leerPolitica } from "./politica";
import { leerFlags } from "../flags";

configurarObsBase({
  condicionesSalud: () => {
    try {
      return leerModoDev() && leerPolitica().saludEnVivo && leerFlags().telemetriaSalud;
    } catch {
      return false;
    }
  },
});

export * from "@jg-stevan/scanner-core/obs-base/dispositivo";
