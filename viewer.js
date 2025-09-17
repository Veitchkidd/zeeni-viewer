/**
 * Zeeni Flipbook Viewer – adaptive ratio, progressive high-res, corner drag
 * Query:
 *   pdf=URL or /api/proxy?url=ENCODED   (required)
 *   bg=solid:#0f0f13 | gradient:linear,#7A2CF0,#00C7B7 | image:https%3A%2F%2F...
 *   wm=Made%20with%20Zeeni              (optional watermark)
 *   mode=auto|single|double             (default auto)
 *   res=auto|high|retina                (default auto)
 */

(function () {
  const qs = new URLSearchParams(location.search);
  const pdfUrl = qs.get("pdf");
  const bgParam = qs.get("bg") || "solid:#0f0f13";
  const wm = qs.get("wm");
  const forcedMode = (qs.get("mode") || "auto").toLowerCase();
  const quality = (qs.get("res") || "auto").toLowerCase();

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
  const btnOpen = byId("btn-open");
  const btnDl = byId("btn-dl");

  const scrub = byId("scrub");
  const curEl = byId("cur");
  const totEl = byId("tot");
  const btnZoomIn = byId("zoom-in");
  const btnZoomOut = byId("zoom-out");
  const renderProg = byId("renderProg");
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

    // original vs proxy URLs (for buttons)
    const rawParam = qs.get("pdf");
    const originalPdfUrl = decodeURIComponent((rawParam || "").replace(/^\/api\/proxy\?url=/, ""));
    const proxyPdfUrl = rawParam.startsWith("/api/proxy")
      ? rawParam
      : `/api/proxy?url=${encodeURIComponent(rawParam)}`;

    btnOpen.href = originalPdfUrl || proxyPdfUrl;
    btnDl.href = `${proxyPdfUrl}${proxyPdfUrl.includes("?") ? "&" : "?"}dl=1`;
    btnDl.setAttribute("download", "");

    // First page → defines aspect + layout + initial CSS size
    const firstLow = await renderPageBitmap(pdf, 1, { tier: "preview" });
    if (!firstLow) throw new Error("First page failed to render.");
    const { width: srcW, height: srcH } = await imgDims(firstLow);
    const isLandscape = srcW >= srcH * 1.05;
    const isDesktop = window.innerWidth >= 1024;
    const usePortrait = forcedMode === "single" ? true :
                        forcedMode === "double" ? false :
                        isLandscape || !isDesktop;

    // Fit book to viewport preserving aspect
    sizeBookToViewport(srcW, srcH);

    // Initial quick pages (2–4), then init viewer immediately
    const INITIAL = Math.min(totalPages, isDesktop ? 4 : 2);
    const pages = [];
    for (let i = 1; i <= INITIAL; i++) {
      renderProg.textContent = `Rendering… ${i}/${totalPages}`;
      pages.push(i === 1 ? firstLow : (await renderPageBitmap(pdf, i, { tier: "preview" })));
      await delay(1);
    }
    // placeholders for the rest so we can boot the viewer
    const placeholders = Array.from({ length: totalPages - INITIAL }, () => pages[pages.length - 1]);
    const allForLoad = pages.concat(placeholders);

    // Init StPageFlip (corner drag + touch swipe)
    pageFlip = new St.PageFlip(bookEl, {
      width: srcW,
      height: srcH,
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

    pageFlip.loadFromImages(allForLoad);
    buildThumbs(allForLoad);
    curEl.textContent = "1";
    loadingEl.classList.add("hidden");

    // Controls
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
    window.addEventListener("resize", () => sizeBookToViewport(srcW, srcH));

    // Background render remaining pages (preview tier), then upgrade to hi-res progressively
    for (let i = INITIAL + 1; i <= totalPages; i++) {
      renderProg.textContent = `Rendering… ${i}/${totalPages}`;
      const lowUrl = await renderPageBitmap(pdf, i, { tier: "preview" });
      upgradePage(i, lowUrl);
      await delay(6);
    }
    renderProg.textContent = "";

    // Now progressively upgrade all pages to high/retina based on CSS size
    const cssPageWidth = getCssSinglePageWidth(bookEl, usePortrait);
    for (let i = 1; i <= totalPages; i++) {
      const hiUrl = await renderPageBitmap(pdf, i, {
        tier: quality === "retina" ? "retina" : (quality === "high" ? "high" : "auto"),
        targetCSSWidth: cssPageWidth
      });
      if (hiUrl) upgradePage(i, hiUrl);
      await delay(4);
    }

    function upgradePage(n, imgUrl) {
      if (!imgUrl) return;
      const el = new Image();
      el.src = imgUrl;
      el.onload = () => {
        // zero-based index in PageFlip
        pageFlip.updatePage(n - 1, el);
        // update thumbnail
        const t = thumbsPanel.querySelectorAll('.thumb img')[n - 1];
        if (t) t.src = imgUrl;
      };
    }
  }

  /* ---------------- Rendering helpers ---------------- */

  // Progressive bitmap renderer with tiers: preview / auto / high / retina
  async function renderPageBitmap(pdf, pageNumber, { tier = "auto", targetCSSWidth } = {}) {
    try {
      const page = await pdf.getPage(pageNumber);
      const vp1 = page.getViewport({ scale: 1 });

      // decide target pixel width
      const dpr = Math.min(3, window.devicePixelRatio || 1); // clamp to keep memory sane
      let base;

      if (targetCSSWidth) {
        // scale from actual CSS page width
        base = targetCSSWidth;
      } else {
        // fallback base when CSS width not known yet
        base = window.innerWidth >= 1280 ? 900 : 700;
      }

      let multiplier;
      switch (tier) {
        case "preview": multiplier = 1.0; break;                      // quick
        case "high":    multiplier = Math.max(1.6, dpr); break;       // sharper
        case "retina":  multiplier = Math.max(2.0, dpr * 1.5); break; // max sharp
        case "auto":
        default:
          multiplier = (dpr >= 2 ? 1.5 : 1.2);
      }

      const target = Math.floor(base * multiplier);
      const scale = target / vp1.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { alpha: false });

      // Limit giant bitmaps to avoid Safari memory crashes
      const MAX_SIDE = 4000;
      canvas.width  = Math.min(MAX_SIDE, Math.floor(viewport.width));
      canvas.height = Math.min(MAX_SIDE, Math.floor(viewport.height));

      await page.render({ canvasContext: ctx, viewport }).promise;
      const url = canvas.toDataURL("image/jpeg", 0.92);
      canvas.width = canvas.height = 1; // free
      return url;
    } catch (e) {
      console.warn("Render failed", pageNumber, e);
      return null;
    }
  }

  function getCssSinglePageWidth(bookEl, usePortrait) {
    // If double spread, the visible book width ~= two pages; single spread = one page
    const bookW = bookEl.clientWidth || Math.min(window.innerWidth * 0.96, 1400);
    return usePortrait ? bookW : Math.max(320, Math.floor(bookW / 2));
  }

  function sizeBookToViewport(srcW, srcH) {
    const maxW = Math.min(window.innerWidth * 0.96, 1400);
    const maxH = Math.min(window.innerHeight - 180, window.innerHeight * 0.9);
    const scale = Math.min(maxW / srcW, maxH / srcH);
    bookEl.style.width = `${Math.floor(srcW * scale)}px`;
    bookEl.style.height = `${Math.floor(srcH * scale)}px`;
  }

  /* ---------------- UI helpers ---------------- */
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
          <a class="btn" id="btn-open" aria-label="Open original PDF" target="_blank" rel="noopener">Open PDF</a>
          <a class="btn" id="btn-dl" aria-label="Download PDF">Download</a>
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
          <div id="renderProg"></div>
        </div>

        <div id="thumbs" class="thumbs hide"></div>

        <div id="loading">Loading…</div>
        <div id="watermark" class="hidden"></div>
      </div>
    `;
  }
})();
