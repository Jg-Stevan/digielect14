# lab/fixtures — fotos de campo del rig quad-repro (KIT e14-quad-repro-v1 §4-A)

**ESTADO: COMPLETADO — los 2 ZIPs de campo llegaron (2026-10-17 18:2x) y los `original.jpg` están
aquí como BYTES EXACTOS** (ZIP empaquetado STORE sin re-encode, kit PROD-3 §3 — verificado md5
abajo). El kit §4-A/contrato: el rig NO se ejecuta con fixtures inventados — estos son los bytes
que el pipeline vio en campo.

| Archivo | md5 | Rol | quad de campo (diagnostico.json) | repro rig/app |
|---|---|---|---|---|
| `mesa-001-original.jpg` (1569176 B) | `e285b04120550370a6133aeb8ef06df3` | CONTROL (detección sana) | trapecio con tilt `[0.383,0.262 0.633,0.280 0.610,0.863 0.357,0.868]`, crop 887×2586 (ratio 2.92 ✓) | **IDÉNTICO byte a byte** (rig fidelidad app y app en dev) |
| `mesa-002-original.jpg` (1677067 B) | `125af1246c6eb159512ca643efd57d6a` | OBJETIVO (el fallo reproducido) | rect perfecto `[0.362,0.333 0.694,0.333 0.694,0.601 0.362,0.601]` (y_bottom≈0.601), crop 1062×1144 (ratio 1.08 ≪ 2.9) | **IDÉNTICO byte a byte** — y la CAUSA RAÍZ es el fallback Sobel del core (lab/README §Quad-repro → hallazgo) |

## Procedencia (kit §4-A — verbatim)

CONSULADO 88 · EGIPTO · ZONA 05 PUESTO 02 · mesas 001/002 · **Frankfurt KIT 399** · 2026-10-17.
Fotos reales de campo (Galaxy A56 5G del dueño). `mesa-002` muestra el papel visible hasta el
borde inferior del frame (y≈0.97): los candidatos, VOTOS EN BLANCO/NULOS/NO MARCADOS y SUMA TOTAL
están EN el encuadre pero FUERA del quad — solo el pie (KIT) quedó fuera del frame.

## Cuidados (kit §9.9)

Actas de campo reales — mismos cuidados del repo: NO re-distribuir fuera del repo privado,
procedencia anotada (este README). Los JPGs NO traen EXIF de cámara (verificable) — el repro
no desincroniza por rotación.

## Cómo correr (ya corrido — resultados en `lab/resultados/`)

```bash
bash lab/setup_env.sh   # NO es necesario para el rig quad-repro (es JS del worker, no Python)
python3 -m http.server 8123   # o bunx serve . — raíz del repo → http://localhost:8123/lab/quad-repro.html
# → selector de archivo → lab/fixtures/mesa-001-original.jpg (control SANO)
# → lab/fixtures/mesa-002-original.jpg (el objetivo — reproducir el rect corto)
```

Nota de fidelidad (hallazgo del rig): el toggle **«bitmap CRUDO»** apagado (default) replica la
cadena de ENTRADA completa del app (re-encode jpeg q0.92 + downscale 300×400 «low» del core —
ver lab/README §Quad-repro); encendido queda para documentar la diferencia crudo-vs-app.
