/**
 * Zeeni Viewer – stable build
 * - Correct StPageFlip usage (stpageflip CDN, St.PageFlip namespace)
 * - Immediate boot (first pages), background render rest (swap in)
 * - Corner drag + touch swipe
 * - Optional sharper pages: &res=high | &res=retina
 */
(function () {
  const qs = new URLSearchParams(location.search);
  const pdfParam = qs.get("pdf");
  const bgParam = qs.get("bg") || "solid:#0f0f13";
  const wm = qs.get("wm");
  const forcedMode = (qs.get("mode") || "auto").toLowerCase();
  const quality = (qs.get("res") || "auto").toLowerCase();

  if (!pdfParam) {
    document.body.innerHTML = `<div style="display:grid;place-items:center;height:100vh;color:#fff">Missing ?pdf= URL</div>`;
    return;
  }

  // Build basic DOM if not present
  ensureDOM();

  const bookEl = byId("book");
  const loadingEl = byId("loading");
  const bgEl = byId("bg");
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
  if (wm) { wmEl.textContent = decodeURIComponent(wm); wmEl.style.pointerEvents = "none"; }

  let pageFlip = null;
  let totalPages = 0;
  let curPage = 1;
  let zoom = 1;

  // expose error messages in the UI if anything goes wrong
  function fail(msg) {
    loadingEl.textContent = msg;
    loadingEl.style.display = "grid";
  }

  (async function init() {
    try {
      // Buttons: open/download original/proxy
      const raw = qs.get("pdf");
      const originalPdfUrl = decodeURIComponent((raw || "").replace(/^\/api\/proxy\?url=/, ""));
      const proxyPdfUrl = raw.startsWith("/api/proxy")
        ? raw
        : `/api/proxy?url=${encodeURIComponent(raw)}`;
      byId("btn-open").href = originalPdfUrl || proxyPdfUrl;
      byId("btn-dl").href = `${proxyPdfUrl}${proxyPdfUrl.includes("?") ? "&" : "?"}dl=1`;
      byId("btn-dl").setAttribute("download", "");

      // Load PDF
      const loadingTask = pdfjsLib.getDocument({ url: pdfParam });
      const pdf = await loadingTask.promise;
      totalPages = pdf.numPages;
      totEl.textContent = totalPages;
      scrub.max = String(totalPages);

      // First page defines aspect + sizing
      const firstImgLow = await renderPage(pdf, 1, "preview");
      if (!firstImgLow) return fail("Couldn't render first page");
      const { width: srcW, height: srcH } = await imgDims(firstImgLow);

      const isLandscape = srcW >= srcH * 1.05;
      const isDesktop = window.innerWidth >= 1024;
      const usePortrait = forcedMode === "single" ? true :
                          forcedMode === "double" ? false :
                          isLandscape || !isDesktop;

      sizeBookToViewport(srcW, srcH);

      // Quick boot: first 2–4 pages
      const INITIAL = Math.min(totalPages, isDesktop ? 4 : 2);
      const initial = [firstImgLow];
      for (let i = 2; i <= INITIAL; i++) {
        renderProg.textContent = `Rendering… ${i}/${totalPages}`;
        initial.push(await renderPage(pdf, i, "preview"));
        await delay(1);
      }
      const placeholders = Array.from({ length: totalPages - INITIAL }, () => initial[initial.length - 1]);
      const all = initial.concat(placeholders);

      // ✅ Correct init of StPageFlip
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

      pageFlip.loadFromImages(all);
      buildThumbs(all);
      curEl.textContent = "1";
      loadingEl.style.display = "none";

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
      btnZoomIn.onclick = () => setZoom(Math.min(2, zoom + 0.15));
      btnZoomOut.onclick = () => setZoom(Math.max(1, zoom - 0.15));
      window.addEventListener("keydown", (ev) => {
        if (ev.key === "ArrowLeft") pageFlip.flipPrev();
        if (ev.key === "ArrowRight") pageFlip.flipNext();
      });
      window.addEventListener("resize", () => sizeBookToViewport(srcW, srcH));

      // Background render remaining PREVIEW pages (replace placeholders)
      for (let i = INITIAL + 1; i <= totalPages; i++) {
        renderProg.textContent = `Rendering… ${i}/${totalPages}`;
        const low = await renderPage(pdf, i, "preview");
        replacePage(i, low);
        await delay(6);
      }
      renderProg.textContent = "";

      // Progressive upgrade to high/retina
      const cssW = getCssSinglePageWidth(bookEl, usePortrait);
      const tier = quality === "retina" ? "retina" : (quality === "high" ? "high" : "auto");
      for (let i = 1; i <= totalPages; i++) {
        const hi = await renderPage(pdf, i, tier, cssW);
        replacePage(i, hi);
        await delay(4);
      }

      function replacePage(n, imgUrl) {
        if (!imgUrl) return;
        const el = new Image();
        el.src = imgUrl;
        el.onload = () => {
          pageFlip.updatePage(n - 1, el);
          const t = thumbsPanel.querySelectorAll(".thumb img")[n - 1];
          if (t) t.src = imgUrl;
        };
      }
    } catch (e) {
      console.error(e);
      fail("Viewer error. Try reloading or using the proxy URL for the PDF.");
    }
  })();

  /* ---------- Rendering ---------- */
  async function renderPage(pdf, pageNumber, tier = "auto", targetCssWidth) {
    try {
      const page = await pdf.getPage(pageNumber);
      const vp1 = page.getViewport({ scale: 1 });

      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const base = targetCssWidth || (window.innerWidth >= 1280 ? 900 : 700);

      let mult = 1.2; // auto
      if (tier === "preview") mult = 1.0;
      else if (tier === "high") mult = Math.max(1.6, dpr);
      else if (tier === "retina") mult = Math.max(2.0, dpr * 1.5);

      const target = Math.floor(base * mult);
      const scale = target / vp1.width;
      const viewport = page.getViewport({ scale });

      const MAX_SIDE = 4000; // prevent Safari crashes
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { alpha: false });
      canvas.width = Math.min(MAX_SIDE, Math.floor(viewport.width));
      canvas.height = Math.min(MAX_SIDE, Math.floor(viewport.height));

      await page.render({ canvasContext: ctx, viewport }).promise;
      const url = canvas.toDataURL("image/jpeg", 0.92);
      canvas.width = canvas.height = 1;
      return url;
    } catch (e) {
      console.warn("Render failed p", pageNumber, e);
      return null;
    }
  }

  function getCssSinglePageWidth(bookEl, usePortrait) {
    const bookW = bookEl.clientWidth || Math.min(window.innerWidth * 0.96, 1400);
    return usePortrait ? bookW : Math.max(320, Math.floor(bookW / 2));
  }

  /* ---------- UI helpers ---------- */
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
          <a class="btn" id="btn-open" target="_blank" rel="noopener">Open PDF</a>
          <a class="btn" id="btn-dl">Download</a>
          <div class="split"></div>
          <button class="btn" id="btn-fs" aria-label="Fullscreen">⤢</button>
        </div>

        <div class="viewer-wrap">
          <div id="book"></div>
        </div>

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
      </div>
    `;
  }

  function byId(id){ return document.getElementById(id); }
  function delay(ms){ return new Promise(r => setTimeout(r, ms)); }
  function sizeBookToViewport(srcW, srcH){
    const maxW = Math.min(window.innerWidth * 0.96, 1400);
    const maxH = Math.min(window.innerHeight - 180, window.innerHeight * 0.9);
    const scale = Math.min(maxW / srcW, maxH / srcH);
    const w = Math.floor(srcW * scale), h = Math.floor(srcH * scale);
    const el = byId("book");
    el.style.width = `${w}px`; el.style.height = `${h}px`;
  }
  function imgDims(src){
    return new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res({width:i.naturalWidth,height:i.naturalHeight});
      i.onerror = rej; i.src = src;
    });
  }
  function setZoom(z){
    zoom = Number(z.toFixed(2));
    byId("book").style.transformOrigin = "center center";
    byId("book").style.transform = `scale(${zoom})`;
  }
  function toggleFullscreen(){
    const el = document.documentElement;
    if (!document.fullscreenElement) el.requestFullscreen?.(); else document.exitFullscreen?.();
  }
  function buildThumbs(imgs){
    const panel = byId("thumbs"); panel.innerHTML = "";
    imgs.forEach((src, i) => {
      const div = document.createElement("div"); div.className = "thumb";
      div.innerHTML = `<img src="${src}" alt="Page ${i+1}">`;
      div.onclick = () => window.__pf?.turnToPage(i);
      panel.appendChild(div);
    });
  }
  function highlightThumb(n){
    [...byId("thumbs").querySelectorAll(".thumb")].forEach((el,i)=>el.classList.toggle("active", i===n-1));
  }
})();
