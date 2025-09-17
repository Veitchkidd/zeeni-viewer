(function () {
  const qs   = new URLSearchParams(location.search);
  const pdfQ = qs.get("pdf");
  if (!pdfQ) {
    document.getElementById("loading").textContent = "Missing ?pdf= URL";
    return;
  }

  const pdfUrl = pdfQ.startsWith("/api/proxy") ? pdfQ : `/api/proxy?url=${encodeURIComponent(pdfQ)}`;

  // Toolbar links (also expose original URL if provided)
  const rawOriginal = decodeURIComponent(pdfQ.replace(/^\/api\/proxy\?url=/, ""));
  const openHref = rawOriginal || pdfUrl;
  document.getElementById("btn-open").href = openHref;
  const dl = document.getElementById("btn-dl");
  dl.href = `${pdfUrl}${pdfUrl.includes("?") ? "&" : "?"}dl=1`;
  dl.setAttribute("download", "");

  const bookEl   = $("#book");
  const loading  = document.getElementById("loading");
  const errorBox = document.getElementById("error");
  const rangeEl  = document.getElementById("range");
  const curEl    = document.getElementById("cur");
  const totEl    = document.getElementById("tot");
  const fitSel   = document.getElementById("fit");

  let pdfDoc = null;
  let pageCount = 0;
  let zoom = 1;

  // Sizing helpers
  function sizeBook(){
    const fit = fitSel.value;
    const canvas = document.getElementById("canvas");
    const W = canvas.clientWidth, H = canvas.clientHeight;
    // Turn.js uses a fixed size; we’ll base it on the first page’s aspect
    const baseW = W, baseH = H;
    bookEl.width(baseW).height(baseH);
    if (bookEl.data("turn")) bookEl.turn("size", baseW, baseH);
  }

  fitSel.addEventListener("change", () => { sizeBook(); });
  window.addEventListener("resize", sizeBook);

  // Controls
  $("#btn-prev").on("click", () => bookEl.turn("previous"));
  $("#btn-next").on("click", () => bookEl.turn("next"));
  document.getElementById("zoom-in").onclick  = () => setZoom( Math.min(2, zoom + 0.15) );
  document.getElementById("zoom-out").onclick = () => setZoom( Math.max(1, zoom - 0.15) );
  document.getElementById("btn-fs").onclick   = () => toggleFullscreen();
  rangeEl.addEventListener("input", (e) => bookEl.turn("page", Number(e.target.value)));

  function setZoom(z){
    zoom = Number(z.toFixed(2));
    const canvas = document.getElementById("canvas");
    canvas.style.transformOrigin = "center center";
    canvas.style.transform = `scale(${zoom})`;
  }
  function toggleFullscreen(){
    const el = document.documentElement;
    if (!document.fullscreenElement) el.requestFullscreen?.(); else document.exitFullscreen?.();
  }

  // Render a page to dataURL (progressive; scale chosen to fill half or full depending on spread)
  async function renderPageToUrl(pdf, n, targetCssWidth){
    try {
      const page = await pdf.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      // Render around 1600px wide for a single page for good sharpness
      const cssW = Math.max(900, Math.min(1600, targetCssWidth || 1200));
      const scale = cssW / vp1.width;
      const viewport = page.getViewport({ scale });

      const c = document.createElement("canvas");
      const ctx = c.getContext("2d", { alpha:false });
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const url = c.toDataURL("image/jpeg", 0.92);
      c.width = c.height = 1;
      return url;
    } catch (e) {
      console.warn("Render fail page", n, e);
      return null;
    }
  }

  async function boot() {
    try {
      // Fetch PDF as binary to avoid CORS mysteries
      const ab = await fetch(pdfUrl, { credentials:"omit" }).then(r => {
        if (!r.ok) throw new Error(`PDF fetch ${r.status}`);
        return r.arrayBuffer();
      });
      pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
      pageCount = pdfDoc.numPages;
      rangeEl.max = String(pageCount);
      totEl.textContent = String(pageCount);

      // Initialize turn.js with placeholders
      sizeBook();
      bookEl.html(""); // clean
      if (bookEl.data("turn")) bookEl.turn("destroy");
      bookEl.turn({
        width: $("#canvas").width(),
        height: $("#canvas").height(),
        autoCenter: true,
        elevation: 50,
        gradients: true,
        display: "double" // spreads like Issuu; it will center on smaller screens automatically
      });

      // Update page counter on flip
      bookEl.bind("turned", function(e, page){
        curEl.textContent = String(page);
        rangeEl.value = String(page);
      });

      // Create empty pages first (for quick UI)
      for (let i=1;i<=pageCount;i++){
        const d = document.createElement("div");
        d.className = "page";
        d.style.background = "#fff";
        d.innerHTML = `<div style="display:grid;place-items:center;height:100%;color:#98a2b3;font:14px Inter">Rendering ${i}…</div>`;
        bookEl.turn("addPage", $(d), i);
      }

      loading.classList.add("hide");

      // Progressive render & replace
      // Estimate target width for a single page (half the book width)
      const singleCss = Math.floor(document.getElementById("canvas").clientWidth / 2);
      for (let i=1;i<=pageCount;i++){
        const url = await renderPageToUrl(pdfDoc, i, singleCss);
        const pageDiv = bookEl.turn("view", i) ? bookEl.turn("pageElement", i) : null;
        if (pageDiv && url){
          pageDiv.innerHTML = `<img src="${url}" alt="Page ${i}" style="width:100%;height:100%;object-fit:cover;display:block">`;
        }
        // Small yield to keep UI responsive
        await new Promise(r => setTimeout(r, 6));
      }
    } catch (e) {
      console.error(e);
      errorBox.textContent = `Viewer error: ${e.message || e}`;
      errorBox.classList.remove("hide");
      loading.classList.add("hide");
    }
  }

  boot();
})();
