/**
 * KIT e14-quad-streaming-v1 (P5) — SEMÁFORO del TURNO de clasificación
 * (el pase del pre-scan QR en «PROCESAR COLA», kit e107).
 *
 * Qué protege: con `masivaStreaming` ON el runner arranca TEMPRANO (con el
 * 1.er pre-scan-OK) y consumiría filas PENDIENTE mientras la clasificación
 * AVANZA — podría reservar una gemela que el pre-scan está por marcar
 * (pagaría OCR: el peligro §3-P5 del plan maestro). El filtro de
 * `siguientePendiente` (runner.ts) solo consume filas YA decididas
 * (`prescanOk`) mientras el turno está ABIERTO.
 *
 * Dos señales (las que el filtro necesita, nada más):
 *  · `turnoClasificacionEnCurso()` — el pre-scan está iterando: el filtro
 *    MANDA. Cerrado el turno el filtro queda INERTE (todo lo PENDIENTE ya
 *    está decidido por el barrido de cierre — jamás retiene filas: sin
 *    hambruna ni filas colgadas).
 *  · `turnoClasificacionInicioMs()` — instante del ARRANQUE del turno: las
 *    filas agregadas DESPUÉS nacen exentas (el objetivo del pre-scan se
 *    congeló ANTES de ellas: nadie las va a clasificar en este turno — no
 *    hay carrera posible; el escape honesto de las filas nuevas, mismo
 *    gesto de hoy: llegan al pool como siempre).
 *
 * Por qué módulo PROPIO y sin imports: store.ts queda INTOCABLE para este
 * kit (brief 2-c — solo mutadores existentes) y runner→prescan-qr sería un
 * import cíclico (prescan-qr→store→runner). Estado de módulo PURO,
 * setters/getters síncronos, cero dependencias — un solo productor (el
 * pre-scan) y un solo consumidor (el filtro del runner), ambos en el main
 * thread: sin carreras de acceso.
 */

/** ¿El turno de clasificación está abierto (el pre-scan iterando)? */
let enCurso = false;

/** Date.now() del ARRANQUE del turno actual (0 = nunca abrió). */
let inicioMs = 0;

/** ABRE el turno (llamado por prescanYIniciar ANTES de estampar filas). */
export function abrirTurnoClasificacion(ms: number): void {
  enCurso = true;
  inicioMs = ms;
}

/** CIERRA el turno (barrido de cierre del pre-scan — el filtro queda inerte). */
export function cerrarTurnoClasificacion(): void {
  enCurso = false;
}

/** El filtro del runner consulta esto ANTES de exigir `prescanOk`. */
export function turnoClasificacionEnCurso(): boolean {
  return enCurso;
}

/** Instante de arranque del turno actual (0 = nunca abrió — todo exento). */
export function turnoClasificacionInicioMs(): number {
  return inicioMs;
}

/** Prueba interna (tests): reset del estado del módulo. */
export function __resetTurnoClasificacionParaTest(): void {
  enCurso = false;
  inicioMs = 0;
}
