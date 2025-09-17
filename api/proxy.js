// Simple CORS proxy for PDFs loaded from other domains
export default async function handler(req, res) {
  const url = req.query.url;
  if (!url) return res.status(400).send("Missing ?url=");

  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return res.status(400).send("Invalid protocol");

    const upstream = await fetch(u.toString(), { redirect: "follow" });
    if (!upstream.ok) return res.status(upstream.status).send(`Upstream ${upstream.status}`);

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/pdf");
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).send("Proxy error");
  }
}
