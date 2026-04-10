/** POST /api/subscribe — collect email subscribers. Stores in Vercel KV if available, otherwise returns success (emails logged in Vercel function logs). */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const origin = req.headers.origin || "";
  const allowed = ["https://thealtai.com", "https://altai-bay.vercel.app", "http://localhost:3000"];
  if (!allowed.some((a) => origin.startsWith(a))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  res.setHeader("Access-Control-Allow-Origin", origin);

  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email" });
  }

  const ts = new Date().toISOString();
  // Log to Vercel function logs (always available, searchable in dashboard)
  console.log(`[subscribe] ${ts} ${email}`);

  // If Vercel KV is configured, persist there too
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { createClient } = await import("@vercel/kv");
      const kv = createClient({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
      });
      await kv.sadd("subscribers", JSON.stringify({ email, ts }));
    } catch (e) {
      console.error("[subscribe] KV error:", e.message);
    }
  }

  return res.status(200).json({ ok: true });
}
