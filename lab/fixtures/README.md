# lab/fixtures — fotos de campo del rig quad-repro (KIT e14-quad-repro-v1 §4-A)

**ESTADO: BLOQUEADO — los ZIPs NO llegaron al sandbox del agente** (2026-10-17: `upload/` solo
trajo los 3 INSTRUCCIONES de la tanda T-A/T-B/T-C; `download/` es la carpeta de generados).
El kit es tajante (§4-A/contrato): **el rig NO se ejecuta con fixtures inventados** — estos JPGs
son los bytes EXACTOS que el pipeline vio en campo (ZIP empaquetado STORE sin re-encode, kit
PROD-3 §3) y la detección debe ser determinista sobre ellos. **Pendiente: re-subida por el dueño.**

## Los 2 archivos esperados (nombres exactos del kit §4-A)

| Archivo | Origen | Rol | quad esperado (del kit §1) |
|---|---|---|---|
| `mesa-001-original.jpg` (~1.5 MB) | `e14-diag-mesa-001-115643-i1.zip` → `original.jpg` | CONTROL (detección sana) | trapecio real con tilt `~[0.383,0.262 0.633,0.280 0.610,0.863 0.357,0.868]`, crop 887×2586 (ratio 2.92 ✓) |
| `mesa-002-original.jpg` (~1.6 MB) | `e14-diag-mesa-002-115822-i2.zip` → `original.jpg` | OBJETIVO (el fallo a reproducir) | rect perfecto `~[0.362,0.333 0.694,0.333 0.694,0.601 0.362,0.601]` (y_bottom≈0.601), crop 1062×1144 (ratio 1.08 ≪ 2.9) |

## Procedencia (kit §4-A — verbatim)

CONSULADO 88 · EGIPTO · ZONA 05 PUESTO 02 · mesas 001/002 · **Frankfurt KIT 399** · 2026-10-17.
Fotos reales de campo (Galaxy A56 5G del dueño). `mesa-002` muestra el papel visible hasta el
borde inferior del frame (y≈0.97): los candidatos, VOTOS EN BLANCO/NULOS/NO MARCADOS y SUMA TOTAL
están EN el encuadre pero FUERA del quad — solo el pie (KIT) quedó fuera del frame.

## Cuidados (kit §9.9)

Actas de campo reales — mismos cuidados del repo: NO re-distribuir fuera del repo privado,
procedencia anotada (este README). Los JPGs NO traen EXIF de cámara (verificable) — el repro
no desincroniza por rotación.

## Cómo correr (cuando lleguen)

```bash
bash lab/setup_env.sh   # NO es necesario para el rig quad-repro (es JS del worker, no Python)
bunx serve .            # raíz del repo → http://localhost:3000/lab/quad-repro.html (puerto 8xxx libre)
# → selector de archivo → lab/fixtures/mesa-001-original.jpg (control SANO)
# → lab/fixtures/mesa-002-original.jpg (el objetivo — reproducir el rect corto)
```
