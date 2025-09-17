(function () {
  const qs   = new URLSearchParams(location.search);
  const pdfQ = qs.get("pdf");
  if (!pdfQ) {
    document.getElementById("loading").textContent = "Missing ?pdf= URL";
    return;
  }
  const pdfUrl = pdfQ.startsWith("/api/proxy") ? pdfQ : `/api/proxy?url=${encodeURIComponent(pdfQ)}`;

  // toolbar links
  const rawOriginal = decodeURIComponent(pdfQ.replace(/^\/api\/proxy\?url=/, ""));
  const openHref = rawOriginal || pdfUrl;
  const openBtn = document.getElementById("btn-open");
  const dlBtn   = document.getElementById("btn-dl");
  openBtn.href  = openHref;
  dlBtn.href    = `${pdfUrl}${pdfUrl.includes("?") ? "&" : "?"}dl=1`;
  dlBtn.setAttribute("download", "");

  const bookHost = document.getElementById("book");
  const loading  = document.getElementById("loading");
  const errBox   = document.getElementById("error");
  const rangeEl  = document.getElementById("range");
  const curEl    = document.getElementById("cur");
  const totEl    = document.getElementById("tot");
  const fitSel   = document.getElementById("fit");

  // controls
  document.getElementById("btn-prev").onclick = () => pageFlip?.flipPrev();
  document.getElementById("btn-next").onclick = () => pageFlip?.flipNext();
  document.getElementById("zoom-in").onclick  = () => setZoom( Math.min(2, zoom + 0.15) );
  document.getElementById("zoom-out").onclick = () => setZoom( Math.max(1, zoom - 0.15) );
  document.getElementById("btn-fs").onclick   = () => toggleFullscreen();
  fitSel.onchange = () => sizeBook();
  window.addEventListener("resize", sizeBook);
  window.addEventListener("keydown",(e)=>{ if(e.key==="ArrowLeft")pageFlip?.flipPrev(); if(e.key==="ArrowRight")pageFlip?.flipNext(); });

  let pdfDoc, pageFlip, zoom=1;

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
  function sizeBook(){
    // StPageFlip autosizes to parent; ensure host has correct size (CSS handles)
    pageFlip?.update();
  }

  async function renderPageToURL(pdf, n, targetCssWidth){
    try {
      const page = await pdf.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
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
      console.warn("Render fail", n, e);
      return null;
    }
  }

  async function boot(){
    try {
      const ab = await fetch(pdfUrl, { credentials: "omit" }).then(r => {
        if (!r.ok) throw new Error(`PDF fetch ${r.status}`);
        return r.arrayBuffer();
      });
      pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;

      const pages = pdfDoc.numPages;
      rangeEl.max = String(pages);
      totEl.textContent = String(pages);

      // prepare initial few pages
      const host = document.createElement("div");
      host.style.width = "100%";
      host.style.height = "100%";
      bookHost.innerHTML = "";
      bookHost.appendChild(host);

      const firstPageImg = await renderPageToURL(pdfDoc, 1, document.getElementById("canvas").clientWidth/2);
      const secondPageImg = pages>=2 ? await renderPageToURL(pdfDoc, 2, document.getElementById("canvas").clientWidth/2) : firstPageImg;

      // init StPageFlip
      pageFlip = new St.PageFlip(host, {
        width: 1100, height: 700,           // base; will stretch
        size: "stretch",
        maxShadowOpacity: 0.5,
        showCover: false,
        usePortrait: false,                 // spreads
        mobileScrollSupport: true,
        clickEventForward: true,
        showPageCorners: true
      });

      // preload first pages (placeholders for others)
      const initial = [];
      initial.push(firstPageImg);
      if (pages>=2) initial.push(secondPageImg);
      const placeholders = Array.from({length: Math.max(0, pages - initial.length)}, () => firstPageImg);
      const all = initial.concat(placeholders);

      pageFlip.loadFromImages(all);

      loading.classList.add("hide");
      curEl.textContent = "1";
      rangeEl.value = "1";

      pageFlip.on("flip", (e) => {
        const n = e.data + 1;
        curEl.textContent = String(n);
        rangeEl.value = String(n);
      });

      rangeEl.oninput = (e) => pageFlip.turnToPage(Number(e.target.value) - 1);

      // progressively replace placeholders with real pages
      for (let i=initial.length+1; i<=pages; i++){
        const img = await renderPageToURL(pdfDoc, i, document.getElementById("canvas").clientWidth/2);
        if (img) pageFlip.updatePage(i-1, img);
        await new Promise(r=>setTimeout(r, 6));
      }
    } catch (e) {
      console.error(e);
      errBox.textContent = `Viewer error: ${e.message || e}`;
      errBox.classList.remove("hide");
      loading.classList.add("hide");
    }
  }

  boot();
})();
