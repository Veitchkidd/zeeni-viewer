/**
 * Zeeni Viewer (Image-only, Manifest-driven)
 * Query:
 *   manifest=PUBLIC_URL_TO_JSON   (preferred)
 *   or images=url1,url2,...
 *   bg=solid:#0f0f13 | gradient:linear,#7A2CF0,#00C7B7 | image:https%3A%2F%2F...
 *   mode=auto|single|double
 *   wm=... (optional)
 */
(function () {
  const qs = new URLSearchParams(location.search);
  const manifestUrl = qs.get("manifest");
  const imagesParam = qs.get("images");
  const bgParam     = qs.get("bg") || "solid:#0f0f13";
  const wm          = qs.get("wm");
  const forcedMode  = (qs.get("mode") || "auto").toLowerCase();

  ensureDOM();

  const bgEl       = byId("bg");
  const wmEl       = byId("watermark");
  const bookEl     = byId("book");
  const loadingEl  = byId("loading");
  const thumbs     = byId("thumbs");
  const scrub      = byId("scrub");
  const curEl      = byId("cur");
  const totEl      = byId("tot");
  const btnPrev    = byId("btn-prev");
  const btnNext    = byId("btn-next");
  const btnThumbs  = byId("btn-thumbs");
  const btnFS      = byId("btn-fs");
  const btnOpen    = byId("btn-open");
  const btnDl      = byId("btn-dl");
  const btnZoomIn  = byId("zoom-in");
  const btnZoomOut = byId("zoom-out");

  applyBackground(bgParam, bgEl);
  if (wm) { wmEl.textContent = decodeURIComponent(wm); wmEl.style.pointerEvents = "none"; }

  init().catch(err => {
    console.error(err);
    loadingEl.textContent = `Viewer error: ${err.message || err}`;
  });

  async function init(){
    let title = "Flipbook", originalPdfUrl = "", images = [];

    if (manifestUrl) {
      const res = await fetch(manifestUrl, { credentials: "omit" });
      if (!res.ok) throw new Error(`Manifest ${res.status}`);
      const m = await res.json();
      title = m.title || title;
      originalPdfUrl = m.originalPdfUrl || originalPdfUrl;
      images = Array.isArray(m.images) ? m.images : [];
    } else if (imagesParam) {
      images = imagesParam.split(",").map(s => decodeURIComponent(s.trim())).filter(Boolean);
    } else {
      throw new Error("Missing ?manifest= or ?images= param");
    }
    if (!images.length) throw new Error("No images found");

    if (originalPdfUrl) {
      btnOpen.href = originalPdfUrl;
      btnDl.href   = originalPdfUrl;
      btnDl.setAttribute("download", "");
    } else {
      btnOpen.style.display = "none";
      btnDl.style.display = "none";
    }

    const first = await loadImage(images[0]);
    const srcW = first.naturalWidth, srcH = first.naturalHeight;
    const isLandscape = srcW >= srcH * 1.05;
    const isDesktop   = window.innerWidth >= 1024;
    const usePortrait = forcedMode === "single" ? true :
                        forcedMode === "double" ? false :
                        isLandscape || !isDesktop;

    sizeBookToViewport(srcW, srcH);

    const INIT = Math.min(images.length, isDesktop ? 4 : 2);
    const initial = images.slice(0, INIT);
    const placeholders = Array.from({length: images.length - INIT}, () => images[0]);
    const all = initial.concat(placeholders);

    const pf = new St.PageFlip(bookEl, {
      width: srcW, height: srcH, showCover: !isLandscape, usePortrait,
      size: "stretch", maxShadowOpacity: 0.45, flippingTime: 700,
      drawShadow: true, autoSize: true,
      mobileScrollSupport: true, clickEventForward: true, showPageCorners: true
    });
    window.pageFlip = pf;
    pf.loadFromImages(all);

    buildThumbs(all);
    curEl.textContent = "1";
    totEl.textContent = String(images.length);
    scrub.max = String(images.length);
    loadingEl.style.display = "none";
    document.title = title;

    pf.on("flip", e => {
      const n = e.data + 1;
      curEl.textContent = n;
      scrub.value = String(n);
      highlightThumb(n);
    });
    btnPrev.onclick = () => pf.flipPrev();
    btnNext.onclick = () => pf.flipNext();
    btnThumbs.onclick = () => thumbs.classList.toggle("hide");
    btnFS.onclick = toggleFullscreen;
    scrub.oninput = e => pf.turnToPage(Number(e.target.value) - 1);
    btnZoomIn.onclick  = () => zoomTo(0.15);
    btnZoomOut.onclick = () => zoomTo(-0.15);
    window.addEventListener("keydown",(ev)=>{ if(ev.key==="ArrowLeft")pf.flipPrev(); if(ev.key==="ArrowRight")pf.flipNext(); });
    window.addEventListener("resize", ()=> sizeBookToViewport(srcW, srcH));

    for (let i = INIT; i < images.length; i++) {
      const im = await loadImage(images[i]);
      pf.updatePage(i, im);
      const t = thumbs.querySelectorAll(".thumb img")[i];
      if (t) t.src = images[i];
      await delay(4);
    }
  }

  function ensureDOM(){
    if (document.getElementById("app")) return;
    document.body.innerHTML = `
      <div id="app">
        <div id="bg"></div>
        <div class="toolbar">
          <button class="btn" id="btn-prev">⟵</button>
          <button class="btn" id="btn-next">⟶</button>
          <div class="split"></div>
          <button class="btn" id="btn-thumbs">☰</button>
          <div class="split"></div>
          <a class="btn" id="btn-open" target="_blank" rel="noopener">Open PDF</a>
          <a class="btn" id="btn-dl">Download</a>
          <div class="split"></div>
          <button class="btn" id="btn-fs">⤢</button>
        </div>
        <div class="viewer-wrap"><div id="book"></div></div>
        <div class="chrome">
          <div class="scrub"><input id="scrub" type="range" min="1" max="1" step="1" value="1" /></div>
          <div class="counter"><b id="cur">1</b>/<span id="tot">?</span></div>
          <div class="zoom">
            <button class="btn" id="zoom-out">−</button>
            <button class="btn" id="zoom-in">+</button>
          </div>
          <div id="renderProg"></div>
        </div>
        <div id="thumbs" class="thumbs hide"></div>
        <div id="loading">Loading…</div>
        <div id="watermark" class="hidden"></div>
      </div>`;
  }
  function byId(id){ return document.getElementById(id); }
  function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
  function loadImage(url){ return new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=url; }); }
  function sizeBookToViewport(srcW, srcH){
    const maxW = Math.min(window.innerWidth*0.96, 1400);
    const maxH = Math.min(window.innerHeight-180, window.innerHeight*0.9);
    const s = Math.min(maxW/srcW, maxH/srcH);
    const el = byId("book");
    el.style.width  = `${Math.floor(srcW*s)}px`;
    el.style.height = `${Math.floor(srcH*s)}px`;
  }
  function zoomTo(delta){
    const el = byId("book");
    const cur = Number((el.dataset.zoom||"1"));
    const next = Math.min(2, Math.max(1, cur + delta));
    el.dataset.zoom = String(next);
    el.style.transformOrigin = "center center";
    el.style.transform = `scale(${next})`;
  }
  function buildThumbs(imgs){
    const panel = byId("thumbs"); panel.innerHTML="";
    imgs.forEach((src,i)=>{ const d=document.createElement("div"); d.className="thumb"; d.innerHTML=`<img src="${src}" alt="Page ${i+1}">`; d.onclick=()=>window.pageFlip?.turnToPage(i); panel.appendChild(d); });
    highlightThumb(1);
  }
  function highlightThumb(n){
    [...byId("thumbs").querySelectorAll(".thumb")].forEach((el,i)=>el.classList.toggle("active", i===n-1));
  }
  function applyBackground(spec, el){
    try{
      const [type, rest] = spec.split(":", 2);
      if (type === "solid") el.style.background = rest || "#0f0f13";
      else if (type === "gradient"){
        const parts = (rest || "").split(",");
        const kind = parts.shift() || "linear";
        const [c1, c2] = parts.length >= 2 ? parts : ["#14151d", "#0f0f13"];
        el.style.background = kind === "radial"
          ? `radial-gradient(${c1}, ${c2})`
          : `linear-gradient(135deg, ${c1}, ${c2})`;
      } else if (type === "image"){
        const url = decodeURIComponent(rest || "");
        el.style.background = url ? `url("${url}") center/cover no-repeat fixed` : "#0f0f13";
      } else el.style.background = "#0f0f13";
    } catch { el.style.background = "#0f0f13"; }
  }
})();
