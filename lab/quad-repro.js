/**
 * KIT e14-quad-repro-v1 (§4-B) — harness de detección aislado (vanilla, sin build).
 * Habla el protocolo REAL del worker (§3): ready → {type:"detect", bitmap, ts} [transfer]
 * → result {corners normalizado 0-1} / busy / error; y {type:"warp"} para el contra-evidencial.
 * Dibuja el quad + esquinas TL-TR-BR-BL, imprime el crop estimado con el MISMO cálculo
 * bbox→px de `calidadDeActa` (bridge L344-365: margen +3% del propio bbox por lado,
 * clamp [0,1]; lado <8px → fallback frame completo; cap lado ≤2000 sin upscalar) y el
 * ratio h/w contra la referencia 2.9 del E-14 P1.
 *
 * Protocolo del kit: el bitmap se TRANSFIERE ([bitmap]) — re-crear por cada intento.
 * `busy` es una respuesta normal (single-flight A-04/A-05) → el botón se deshabilita
 * hasta la respuesta. Nada aquí corre en producción.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const cv = $("cv"), ctx = cv.getContext("2d");
  const estado = $("estado"), datos = $("datos"), warpOut = $("warpOut"), trazas = $("trazas");
  const REF_RATIO_HW = 2.9; // E-14 P1 completo ≈ 2.9 (kit §1 — referencia, NO ley: pitfall §9.7)
  const MARGEN_BBOX_PCT = 0.03, BBOX_MIN_PX = 8, CROP_LADO_MAX = 2000;

  /** corners del worker = array PLANO de 8 fracciones [x0,y0,x1,y1,…] (toFractions)
   *  → normalizar a 4 puntos {x,y} orden TL TR BR BL. */
  function corners8aPuntos(c) {
    if (!c || c.length === undefined || c.length < 8) return null;
    return [0, 2, 4, 6].map((i) => ({ x: c[i], y: c[i + 1] }));
  }

  let worker = null, ready = false, ocupado = false;
  let bitmapBase = null;   // bitmap fuente (se re-crea por intento — el detect TRANSFIERE)
  let imgEl = null;        // para re-decodificar sin EXIF issues (los fixtures no traen EXIF — pitfall §9.6)
  let lastCorners = null;  // quad normalizado devuelto
  let lastFrame = null;    // {w, h}

  const log = (t) => {
    if (trazas.querySelector(".warn")) trazas.textContent = "";
    const d = document.createElement("div");
    d.textContent = t;
    trazas.prepend(d);
  };
  const ponEstado = (t, cls) => { estado.textContent = t; estado.className = cls ? "kv " + cls : "kv"; };

  // ---------- worker ----------
  function abrirWorker() {
    ready = false; ocupado = false;
    ponEstado("worker: cargando opencv…");
    worker = new Worker("./worker-copy/detection-worker.js?v=7");
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === "ready") { ready = true; $("detectBtn").disabled = !bitmapBase; ponEstado("worker: READY (probe " + JSON.stringify(m.probe) + ")", "ok"); return; }
      if (m.type === "busy") { ocupado = false; $("detectBtn").disabled = false; ponEstado("worker: busy — reintenta", "warn"); return; }
      if (m.type === "error") { ocupado = false; $("detectBtn").disabled = false; ponEstado("worker: ERROR — " + m.message, "warn"); return; }
      if (m.type === "result") { ocupado = false; $("detectBtn").disabled = false; ponResultado(m); return; }
      if (m.type === "quad-repro") { log("[" + m.traza.fn + "] " + JSON.stringify(m.traza)); return; }
      if (m.type === "warped") { dibujaWarp(m); return; }
    };
    worker.onerror = (e) => ponEstado("worker: onerror — " + (e.message || "?"), "warn");
  }

  // ---------- fixture ----------
  async function cargarArchivo(file) {
    imgEl = new Image();
    imgEl.decoding = "sync";
    const url = URL.createObjectURL(file);
    await new Promise((res, rej) => { imgEl.onload = res; imgEl.onerror = rej; imgEl.src = url; });
    bitmapBase = await createImageBitmap(imgEl);
    $("detectBtn").disabled = !ready;
    $("warpBtn").disabled = true;
    lastCorners = null;
    // dibujo base
    cv.width = bitmapBase.width; cv.height = bitmapBase.height;
    ajustaCanvas();
    ctx.drawImage(imgEl, 0, 0, cv.width, cv.height);
    datos.textContent = `fixture ${file.name} — ${bitmapBase.width}×${bitmapBase.height}px`;
    warpOut.textContent = "";
    lastFrame = { w: bitmapBase.width, h: bitmapBase.height };
  }
  function ajustaCanvas() { cv.style.width = "100%"; cv.style.height = "auto"; }

  // ---------- detect ----------
  function detectar() {
    if (!ready || !bitmapBase) return;
    if (ocupado) return; // single-flight — busy es normal (A-04/A-05)
    ocupado = true;
    $("detectBtn").disabled = true;
    const bmp = new ImageData(1, 1); // placeholder — el bitmap REAL va por transfer
    createImageBitmap(imgEl).then((b) => {
      lastFrame = { w: b.width, h: b.height };
      worker.postMessage({ type: "detect", bitmap: b, ts: Date.now() }, [b]); // TRANSFER — pitfall §9.3
      ponEstado("worker: detectando…");
    });
  }

  // crop estimado: MISMO cálculo bbox→px de calidadDeActa (bridge L344-365)
  function cropEstimado(corners, frameW, frameH) {
    const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const mx = (x1 - x0) * MARGEN_BBOX_PCT, my = (y1 - y0) * MARGEN_BBOX_PCT;
    const rx0 = Math.max(0, x0 - mx), rx1 = Math.min(1, x1 + mx);
    const ry0 = Math.max(0, y0 - my), ry1 = Math.min(1, y1 + my);
    const w = (rx1 - rx0) * frameW, h = (ry1 - ry0) * frameH;
    const fallback = w < BBOX_MIN_PX || h < BBOX_MIN_PX;
    if (fallback) return { w: frameW, h: frameH, fallback: true };
    // cap lado ≤2000 — NUNCA upscalar
    const lado = Math.max(w, h);
    const esc = lado > CROP_LADO_MAX ? CROP_LADO_MAX / lado : 1;
    return { w: Math.round(w * esc), h: Math.round(h * esc), fallback: false };
  }

  function ponResultado(m) {
    const pts = corners8aPuntos(m.corners);
    lastCorners = pts;
    const f = lastFrame;
    // redibujo la foto y el quad (corners plano 0-1 → puntos px del canvas)
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(imgEl, 0, 0, cv.width, cv.height);
    $("warpBtn").disabled = !pts;
    if (!pts) {
      datos.innerHTML = `<span class="warn">SIN QUAD — detección no encontró acta (mira H3 en trazas: contourCount=${m.qualityInput && m.qualityInput.diag ? m.qualityInput.diag.contourCount : "?"}).</span>`;
      return;
    }
    const c = pts.map((p) => ({ x: p.x * cv.width, y: p.y * cv.height }));
    ctx.lineWidth = Math.max(2, cv.width / 400);
    ctx.strokeStyle = "#7aa2ff";
    ctx.beginPath();
    c.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    const nombres = ["TL", "TR", "BR", "BL"];
    c.forEach((p, i) => {
      ctx.fillStyle = "#ffb86b";
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(4, cv.width / 120), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#101014";
      ctx.font = `bold ${Math.max(9, cv.width / 55)}px ui-monospace, monospace`;
      ctx.fillText(nombres[i], p.x - 10, p.y - 10);
    });
    const crop = cropEstimado(pts, f.w, f.h);
    const ratioHW = crop.h / Math.max(1, crop.w);
    const refTxt = ratioHW < 2.2
      ? `<span class="warn">⚠ ratio ${ratioHW.toFixed(2)} ≪ 2.9 — crop corta el papel (el zip2 dio 1.08)</span>`
      : `<span class="ok">ratio ${ratioHW.toFixed(2)} — rango del E-14 (≈2.9; P2/ doblez miden distinto — pitfall §9.7)</span>`;
    datos.innerHTML =
      `quad (normalizado 0-1): [${pts.map((p) => `${(+p.x).toFixed(3)},${(+p.y).toFixed(3)}`).join("  ")}]\n` +
      `crop estimado (bbox +3% — bridge L344): ${crop.w}×${crop.h}${crop.fallback ? " <span class='warn'>(fallback frame completo)</span>" : ""}\n` +
      `ratio h/w: ${ratioHW.toFixed(2)} — ${refTxt}\n` +
      `contornos: ${m.qualityInput && m.qualityInput.diag ? m.qualityInput.diag.contourCount : "?"} · frame: ${f.w}×${f.h}`;
  }

  // ---------- warp (§4-B.4 + Fase 3) ----------
  function warp() {
    if (!ready || !bitmapBase || !lastCorners) return;
    if (ocupado) return;
    ocupado = true;
    const manual = $("quadIdeal").checked;
    let corners = lastCorners;
    if (manual) {
      // quad «ideal» editable: el papel visible del zip2 (kit Fase 3) — se
      // edita a mano en el prompt (4 puntos x,y 0-1 separados por espacios).
      const t = prompt("quad ideal (x0,y0 x1,y1 x2,y2 x3,y3 — 0-1, orden TL TR BR BL):", lastCorners.map((p) => `${(+p.x).toFixed(3)},${(+p.y).toFixed(3)}`).join(" "));
      if (!t) { ocupado = false; return; }
      corners = t.trim().split(/\s+/).map((par) => { const [x, y] = par.split(",").map(Number); return { x, y }; });
    }
    const outW = 1062, outH = Math.round(1062 * 2.9 / 2); // canvas de destino — ratio del E-14
    const quad8 = []; // el worker exige 8 fracciones planas (isFractions8) — NO objetos
    corners.forEach((p) => { quad8.push(p.x, p.y); });
    createImageBitmap(imgEl).then((b) => {
      worker.postMessage({ type: "warp", bitmap: b, quad: quad8, ts: Date.now(), manual }, [b]);
      warpOut.textContent = "warpeando…";
    });
  }
  function dibujaWarp(m) {
    ocupado = false;
    const bmp = m.bitmap; // ImageBitmap del reply
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    c.getContext("2d").drawImage(bmp, 0, 0);
    warpOut.textContent = `warp → ${bmp.width}×${bmp.height}px (miniatura arriba en «Warp» — click para abrir)`;
    c.style.maxWidth = "100%"; c.style.borderRadius = "6px"; c.style.marginTop = "6px";
    warpOut.appendChild(document.createElement("br"));
    warpOut.appendChild(c);
    try { bmp.close(); } catch {}
  }

  // ---------- wiring ----------
  $("file").addEventListener("change", (e) => e.target.files[0] && cargarArchivo(e.target.files[0]));
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; f && cargarArchivo(f); });
  $("detectBtn").addEventListener("click", detectar);
  $("warpBtn").addEventListener("click", warp);

  // intercepta las trazas [quad-repro] — la COPIA las emite AMBAS vías:
  // console.info (devtools, formato parseable del kit §4-C) y post({type:"quad-repro"})
  // (panel en vivo de este harness — SOLO la copia del lab lo hace; el original no).
  log("TIP: las trazas [quad-repro] completas (selectQuad/refineQuadFromLines/detect) salen en la consola del WORKER — devtools → Application/Worker → Console.");
  abrirWorker();
})();
