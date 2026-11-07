# core/ — módulos D-only del digitalizador

> **Mapa de migración v2.3 (FASE 0):** los 6 módulos compartidos con
> `supervision-e14` (types, codec, image-modes, image-processor,
> detector-client, ocr) viven ahora en el **paquete**
> `packages/scanner-core` (`@jg-stevan/scanner-core`) — los archivos de
> ese nombre en esta carpeta son SHIMS de re-export. Aquí quedan SOLO los
> módulos sin contraparte en S (frame-loop, motion-stabilizer, pdf-export,
> pwa, quality, sensor-profiler), cubiertos por `CONTRATO.json`.
>
> Procedencia del motor: `web-scanner` · `feba267` · v0.4.1 (vendorizado
> original — ver LICENSE-scanner-core.md y el CHANGELOG del paquete).
> El ritual «editar en los dos repos en el mismo commit» MURIÓ: el motor
> se edita EN EL PAQUETE y ambas apps lo consumen por workspace.
