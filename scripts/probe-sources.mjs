// Engångsverktyg: skriver ut en förkortad version av svaret från några adresser.
const UA = "AnknytningBot/0.1 (+https://github.com/fungusflip/Anknytning)";
const MAX = +(process.env.PROBE_MAX ?? 2500);
for (const arg of process.argv.slice(2)) {
  // "adress#@text" skriver ut från första förekomsten av text
  const [url, fran] = arg.split("#@");
  let res;
  try { res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json, text/html, text/plain, */*" } }); }
  catch (e) { console.log("PROBE " + JSON.stringify({ url, error: String(e.cause?.code ?? e) })); continue; }
  let text = await res.text(), out;
  try {
    const j = JSON.parse(text);
    if (typeof j === "string") text = j; // vissa API:er skickar HTML inuti JSON
    else if (j.namespaces) out = JSON.stringify({ namespaces: j.namespaces, routes: Object.keys(j.routes ?? {}).filter(r => /event|kurs|aktiv|arrang|kalend/i.test(r)) });
    else { const list = j.results ?? j.items ?? j.data ?? j; out = JSON.stringify({ keys: Object.keys(j), count: j.count ?? j.total, next: j.next, n: Array.isArray(list) ? list.length : null, first: Array.isArray(list) ? list[0] : null }); }
  } catch {}
  if (!out && fran) { const i = text.indexOf(decodeURIComponent(fran)); if (i > 0) text = text.slice(i); }
  else if (!out) { const i = text.search(/<main[\s>]/i); if (i > 0) text = text.slice(i); }
  if (!out) out = text
    .replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/\s(srcset|sizes|class|style|data-[\w-]+)="[^"]*"/gi, "")
    .replace(/<\/?(div|span|picture|figure|source)[^>]*>/gi, "")
    .replace(/\s+/g, " ");
  console.log("PROBE " + JSON.stringify({ url, status: res.status, type: res.headers.get("content-type"), len: text.length, out: out.slice(0, MAX) }));
}
