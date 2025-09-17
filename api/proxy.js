// CORS-friendly PDF proxy + ?dl=1 to force download
export default async function handler(req, res) {
  const url = req.query.url;
  const dl  = req.query.dl;
  if (!url) return res.status(400).send("Missing ?url=");

  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return res.status(400).send("Invalid protocol");

    const upstream = await fetch(u.toString(), { redirect: "follow" });
    if (!upstream.ok) return res.status(upstream.status).send(`Upstream ${upstream.status}`);

    const buf = Buffer.from(await upstream.arrayBuffer());
    const fileName = (u.pathname.split("/").pop() || "document.pdf").split("?")[0];

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/pdf");
    if (dl) res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).send("Proxy error");
  }
}
