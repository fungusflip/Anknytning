// Engångsverktyg: skriver ut svaret från en JSON-adress (förkortat).
const UA = "AnknytningBot/0.1 (+https://github.com/fungusflip/Anknytning)";
for (const url of process.argv.slice(2)) {
  let res;
  try { res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json, text/plain, */*" } }); }
  catch (e) { console.log("JSON " + JSON.stringify({ url, error: String(e.cause?.code ?? e) })); continue; }
  const text = await res.text();
  let out = text.slice(0, 2500);
  try { const j = JSON.parse(text); if (j.namespaces) out = JSON.stringify({ namespaces: j.namespaces, routes: Object.keys(j.routes ?? {}).filter(r => /event|kurs|aktiv|arrang/i.test(r)) }).slice(0, 3500); else { const list = j.results ?? j.items ?? j; out = JSON.stringify({ keys: Object.keys(j), count: j.count, next: j.next, n: Array.isArray(list) ? list.length : null, first: Array.isArray(list) ? list[0] : null }).slice(0, 3500); } } catch {}
  console.log("JSON " + JSON.stringify({ url, status: res.status, out }));
}
