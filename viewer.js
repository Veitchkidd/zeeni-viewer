/**
 * Zeeni Flipbook Viewer – adaptive & robust
 * Query:
 *   pdf=URL or /api/proxy?url=ENCODED   (required)
 *   bg=solid:#0f0f13 | gradient:linear,#7A2CF0,#00C7B7 | image:https%3A%2F%2F...
 *   wm=Made%20with%20Zeeni              (optional watermark)
 *   mode=auto|single|double             (default auto)
 */

(function () {
  const qs = new URLSearchParams(location.search);
  const pdfUrl = qs.get("pdf");
  const bgParam = qs.get("bg") || "solid:#0f0f13";
  const wm = qs.get("wm");
  const forcedMode = (qs.get("mode") || "auto").toLowerCase();

  if (!pdfUrl) {
    document.body.innerHTML = `<div style="display:grid;place-items:center;height:100vh;color:#fff">
      Missing ?pdf= URL
    </div>`;
    return;
  }

  ensureDOM();
  const bgEl = byId("bg");
  const bookEl = byId("book");
  const loadingEl = byId("loading");
  const wmEl = byId("watermark");
  const btnPrev = byId("btn-prev");
  const btnNext = byId("btn-next");
  const btnThumbs = byId("btn-thumbs");
  const btnFS = byId("btn-fs");
  const scrub = byId("scrub");
  const curEl = byId("cur");
  const totEl = byId("tot");
  const btnZoomIn = byId("zoom-in");
  const btnZoomOut = byId("zoom-out");
  const thumbsPanel = byId("thumbs");

  applyBackground(bgParam, bgEl);
  if (wm) { wmEl.textContent = decodeURIComponent(wm); wmEl.classList.remove("hidden"); }

  let pageFlip = null;
  let totalPages = 0;
  let curPage = 1;
  let zoom = 1;
  const ZOOM_MIN = 1, ZOOM_MAX = 2, ZOOM_STEP = 0.15;

  init().catch(err => {
    console.error(err);
    loadingEl.textContent = "Failed to load PDF (try /api/proxy?url=...).";
  });

  async function init() {
    const loadingTask = pdfjsLib.getDocument({ url: pdfUrl });
    const pdf = await loadingTask.promise;
    totalPages = pdf.numPages;
    totEl.textContent = totalPages;
    scrub.max = String(totalPages);

    // First page → defines aspect + layout
    const firstImg = await safeRender(pdf, 1);
    if (!firstImg) throw new Error("First page failed to render.");
    const { width: pW, height: pH } = await imgDims(firstImg);
    const isLandscape = pW >= pH * 1.05;
    const isDesktop = window.innerWidth >= 1024;

    const usePortrait = forcedMode === "single" ? true :
                        forcedMode === "double" ? false :
                        isLandscape || !isDesktop;

    sizeBookToViewport(pW, pH);

    // Render remaining pages (robust + yields)
    const imgs = [firstImg];
    for (let i = 2; i <= totalPages; i++) {
      loadingEl.textContent = `Rendering pages… ${i}/${totalPages}`;
      const img = await safeRender(pdf, i);
      imgs.push(img || firstImg);
      await delay(8);
    }

    // Init PageFlip
    pageFlip = new St.PageFlip(bookEl, {
      width: pW,
      height: pH,
      showCover: !isLandscape,
      usePortrait,
      size: "stretch",
      maxShadowOpacity: 0.45,
      flippingTime: 700,
      drawShadow: true,
      autoSize: true,
      mobileScrollSupport: true,
      clickEventForward: true,
      showPageCorners: true
    });

    pageFlip.loadFromImages(imgs);

    buildThumbs(imgs);

    pageFlip.on("flip", (e) => {
      curPage = e.data + 1;
      curEl.textContent = curPage;
      scrub.value = String(curPage);
      highlightThumb(curPage);
    });

    btnPrev.onclick = () => pageFlip.flipPrev();
    btnNext.onclick = () => pageFlip.flipNext();
    btnThumbs.onclick = () => thumbsPanel.classList.toggle("hide");
    btnFS.onclick = toggleFullscreen;

    scrub.oninput = (e) => pageFlip.turnToPage(Number(e.target.value) - 1);

    btnZoomIn.onclick = () => setZoom(Math.min(ZOOM_MAX, zoom + ZOOM_STEP));
    btnZoomOut.onclick = () => setZoom(Math.max(ZOOM_MIN, zoom - ZOOM_STEP));

    window.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowLeft") pageFlip.flipPrev();
      if (ev.key === "ArrowRight") pageFlip.flipNext();
      if (ev.key === "+") setZoom(Math.min(ZOOM_MAX, zoom + ZOOM_STEP));
      if (ev.key === "-") setZoom(Math.max(ZOOM_MIN, zoom - ZOOM_STEP));
    });
    window.addEventListener("resize", () => sizeBookToViewport(pW, pH));

    curEl.textContent = "1";
    loadingEl.classList.add("hidden");
  }

  // ---------- Helpers ----------
  async function safeRender(pdf, pageNumber) {
    try {
      const page = await pdf.getPage(pageNumber);
      const baseTarget = window.innerWidth >= 1280 ? 1600 : 1200;
      const target =
        pdf.numPages > 48 ? Math.floor(baseTarget * 0.75) :
        pdf.numPages > 24 ? Math.floor(baseTarget * 0.85) :
        baseTarget;

      const vp1 = page.getViewport({ scale: 1 });
      const scale = target / vp1.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { alpha: false });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      await delay(1);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const url = canvas.toDataURL("image/jpeg", 0.9);
      canvas.width = canvas.height = 1; // free memory
      return url;
    } catch (e) {
      console.warn("Render failed on page", pageNumber, e);
      return null;
    }
  }

  function sizeBookToViewport(srcW, srcH) {
    const maxW = Math.min(window.innerWidth * 0.96, 1400);
    const maxH = Math.min(window.innerHeight - 180, window.innerHeight * 0.9);
    const scale = Math.min(maxW / srcW, maxH / srcH);
    bookEl.style.width = `${Math.floor(srcW * scale)}px`;
    bookEl.style.height = `${Math.floor(srcH * scale)}px`;
  }

  function byId(id){ return document.getElementById(id); }
  function delay(ms){ return new Promise(r => setTimeout(r, ms)); }
  function imgDims(src){
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res({ width: i.naturalWidth, height: i.naturalHeight });
      i.onerror = rej; i.src = src;
    });
  }
  function setZoom(z){
    zoom = Number(z.toFixed(2));
    bookEl.style.transformOrigin = "center center";
    bookEl.style.transform = `scale(${zoom})`;
  }
  function toggleFullscreen(){
    const el = document.documentElement;
    if (!document.fullscreenElement) el.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
  function buildThumbs(imgs){
    const panel = byId("thumbs");
    panel.innerHTML = "";
    imgs.forEach((src, i) => {
      const div = document.createElement("div");
      div.className = "thumb";
      div.innerHTML = `<img src="${src}" alt="Page ${i+1}">`;
      div.onclick = () => pageFlip?.turnToPage(i);
      panel.appendChild(div);
    });
    highlightThumb(1);
  }
  function highlightThumb(n){
    [...byId("thumbs").querySelectorAll(".thumb")]
      .forEach((el, i) => el.classList.toggle("active", i === n - 1));
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
        const url = decodeURIComponent(rest);
        el.style.background = `url("${url}") center/cover no-repeat fixed`;
      } else el.style.background = "#0f0f13";
    } catch { el.style.background = "#0f0f13"; }
  }

  // Inject UI if index.html is minimal
  function ensureDOM(){
    if (document.getElementById("app")) return;
    document.body.innerHTML = `
      <div id="app">
        <div id="bg"></div>

        <div class="toolbar">
          <button class="btn" id="btn-prev" aria-label="Previous">⟵</button>
          <button class="btn" id="btn-next" aria-label="Next">⟶</button>
          <div class="split"></div>
          <button class="btn" id="btn-thumbs" aria-label="Thumbnails">☰</button>
          <div class="split"></div>
          <button class="btn" id="btn-fs" aria-label="Fullscreen">⤢</button>
        </div>

        <div class="viewer-wrap">
          <div id="book"></div>
        </div>

        <div class="chrome">
          <div class="scrub">
            <input id="scrub" type="range" min="1" max="1" step="1" value="1" />
          </div>
          <div class="counter"><b id="cur">1</b>/<span id="tot">?</span></div>
          <div class="zoom">
            <button class="btn" id="zoom-out">−</button>
            <button class="btn" id="zoom-in">+</button>
          </div>
        </div>

        <div id="thumbs" class="thumbs hide"></div>

        <div id="loading">Loading…</div>
        <div id="watermark" class="hidden"></div>
      </div>
    `;
  }
})();
