/**
 * Zeeni Flipbook Viewer – Issuu-style
 * Query params:
 *   pdf=URL or /api/proxy?url=ENCODED     (required)
 *   bg=solid:#0f0f13 | gradient:linear,#7A2CF0,#00C7B7 | image:https%3A%2F%2F...
 *   wm=Made%20with%20Zeeni                (optional watermark text)
 *   mode=auto|single|double               (default auto)
 */

(function () {
  // ---------- Query / Config ----------
  const qs = new URLSearchParams(location.search);
  const pdfUrl = qs.get("pdf");
  const bgParam = qs.get("bg") || "solid:#0f0f13";
  const wm = qs.get("wm");
  const mode = (qs.get("mode") || "auto").toLowerCase();

  if (!pdfUrl) {
    document.body.innerHTML =
      '<div style="display:grid;place-items:center;height:100vh;color:#fff">Missing ?pdf= URL</div>';
    return;
  }

  // ---------- Ensure DOM skeleton (works even if index.html is minimal) ----------
  ensureDOM();

  const app = document.getElementById("app");
  const bg = document.getElementById("bg");
  const bookEl = document.getElementById("book");
  const loadingEl = document.getElementById("loading");
  const watermarkEl = document.getElementById("watermark");

  // Top toolbar controls
  const btnPrev = byId("btn-prev");
  const btnNext = byId("btn-next");
  const btnThumbs = byId("btn-thumbs");
  const btnFS = byId("btn-fs");

  // Bottom chrome controls
  const scrub = byId("scrub");
  const curEl = byId("cur");
  const totEl = byId("tot");
  const btnZoomIn = byId("zoom-in");
  const btnZoomOut = byId("zoom-out");

  // Thumbs panel
  const thumbsPanel = byId("thumbs");

  // Background + Watermark
  applyBackground(bgParam, bg);
  if (wm) {
    watermarkEl.textContent = decodeURIComponent(wm);
    watermarkEl.classList.remove("hidden");
  }

  // ---------- State ----------
  let pageFlip = null;
  let totalPages = 0;
  let curPage = 1;
  let zoom = 1; // CSS scale on the book container (1 → 2)
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 2;
  const ZOOM_STEP = 0.15;

  // ---------- Main ----------
  init().catch((e) => {
    console.error(e);
    loadingEl.textContent =
      "Failed to load PDF. If it’s on another domain, try /api/proxy?url=...";
  });

  async function init() {
    // Load PDF
    const loadingTask = pdfjsLib.getDocument({ url: pdfUrl });
    const pdf = await loadingTask.promise;
    totalPages = pdf.numPages;
    totEl.textContent = totalPages;
    scrub.max = String(totalPages);

    // Render first page to size the viewer
    const first = await renderPageToDataUrl(pdf, 1, 1600);
    const { width, height } = await imgDims(first);

    // Size book element to fit viewport while keeping aspect
    sizeBook(width, height);

    // Render all pages (simple v1). For very large PDFs, swap to lazy-load later.
    const imgs = [first];
    for (let i = 2; i <= totalPages; i++) {
      const img = await renderPageToDataUrl(pdf, i, 1600);
      imgs.push(img);
      // Optional: update loading text
      if (i % 5 === 0) loadingEl.textContent = `Rendering pages… ${i}/${totalPages}`;
    }

    // Init StPageFlip with “real” book feel
    const isDesktop = window.innerWidth >= 1024;
    pageFlip = new St.PageFlip(bookEl, {
      width,
      height,
      showCover: true,
      usePortrait: mode === "single" ? true : mode === "double" ? false : !isDesktop,
      size: "stretch",
      maxShadowOpacity: 0.45,
      flippingTime: 700,
      drawShadow: true,
      autoSize: true,
      mobileScrollSupport: true,
      clickEventForward: true,
      showPageCorners: true,
    });

    pageFlip.loadFromImages(imgs);

    // Build thumbnails
    buildThumbs(imgs);

    // Events
    pageFlip.on("flip", (e) => {
      curPage = e.data + 1; // zero-based → human
      curEl.textContent = curPage;
      scrub.value = String(curPage);
      highlightThumb(curPage);
    });

    // Controls
    btnPrev.onclick = () => pageFlip.flipPrev();
    btnNext.onclick = () => pageFlip.flipNext();

    btnThumbs.onclick = () => thumbsPanel.classList.toggle("hide");

    btnFS.onclick = toggleFullscreen;

    scrub.oninput = (e) => {
      const n = Number(e.target.value || "1");
      pageFlip.turnToPage(n - 1);
    };

    btnZoomIn.onclick = () => setZoom(Math.min(ZOOM_MAX, zoom + ZOOM_STEP));
    btnZoomOut.onclick = () => setZoom(Math.max(ZOOM_MIN, zoom - ZOOM_STEP));

    window.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowLeft") pageFlip.flipPrev();
      if (ev.key === "ArrowRight") pageFlip.flipNext();
      if (ev.key === "+") setZoom(Math.min(ZOOM_MAX, zoom + ZOOM_STEP));
      if (ev.key === "-") setZoom(Math.max(ZOOM_MIN, zoom - ZOOM_STEP));
    });

    window.addEventListener("resize", () => sizeBook(width, height));

    // Start
    curEl.textContent = "1";
    loadingEl.classList.add("hidden");
  }

  // ---------- Helpers ----------
  function byId(id) {
    return document.getElementById(id);
  }

  function sizeBook(srcW, srcH) {
    // Width cap like CSS (92vw, 1280px)
    const contW = Math.min(window.innerWidth * 0.92, 1280);
    const idealH = contW * (srcH / srcW);
    const maxH = Math.min(window.innerHeight - 180, idealH);
    bookEl.style.width = `${contW}px`;
    bookEl.style.height = `${maxH}px`;
  }

  async function renderPageToDataUrl(pdf, pageNumber, targetWidth = 1600) {
    const page = await pdf.getPage(pageNumber);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = targetWidth / vp1.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const url = canvas.toDataURL("image/jpeg", 0.9);
    // free memory
    canvas.width = canvas.height = 1;
    return url;
  }

  function imgDims(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = rej;
      img.src = src;
    });
  }

  function setZoom(z) {
    zoom = Number(z.toFixed(2));
    bookEl.style.transformOrigin = "center center";
    bookEl.style.transform = `scale(${zoom})`;
  }

  function toggleFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement) el.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  function buildThumbs(imgs) {
    thumbsPanel.innerHTML = "";
    imgs.forEach((src, i) => {
      const div = document.createElement("div");
      div.className = "thumb";
      div.innerHTML = `<img src="${src}" alt="Page ${i + 1}">`;
      div.onclick = () => pageFlip?.turnToPage(i);
      thumbsPanel.appendChild(div);
    });
    highlightThumb(1);
  }

  function highlightThumb(n) {
    const list = [...thumbsPanel.querySelectorAll(".thumb")];
    list.forEach((el, i) => el.classList.toggle("active", i === n - 1));
  }

  function applyBackground(spec, el) {
    try {
      const [type, rest] = spec.split(":", 2);
      if (type === "solid") el.style.background = rest || "#0f0f13";
      else if (type === "gradient") {
        const parts = (rest || "").split(",");
        const kind = parts.shift() || "linear";
        const [c1, c2] = parts.length >= 2 ? parts : ["#14151d", "#0f0f13"];
        el.style.background =
          kind === "radial" ? `radial-gradient(${c1}, ${c2})` : `linear-gradient(135deg, ${c1}, ${c2})`;
      } else if (type === "image") {
        const url = decodeURIComponent(rest);
        el.style.background = `url("${url}") center/cover no-repeat fixed`;
      } else el.style.background = "#0f0f13";
    } catch {
      el.style.background = "#0f0f13";
    }
  }

  function ensureDOM() {
    if (!document.getElementById("app")) {
      document.body.innerHTML = `
        <div id="app">
          <div id="bg"></div>

          <div class="toolbar">
            <button class="btn" id="btn-prev" aria-label="Previous">⟵</button>
            <button class="btn" id="btn-next" aria-label="Next">⟶</button>
            <div class="split"></div>
            <button class="btn" id="btn-thumbs" aria-label="Toggle thumbnails">☰</button>
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
  }
})();
