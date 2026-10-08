// Engångsverktyg: hittar listor med datum i en sidas inbäddade data (__NEXT_DATA__) eller i ett JSON-svar.
const UA = "AnknytningBot/0.1 (+https://github.com/fungusflip/Anknytning)";
const DATE = /date|start|time|datum|when/i;

function findLists(node, path, out) {
  if (Array.isArray(node)) {
    const objs = node.filter(x => x && typeof x === "object" && !Array.isArray(x));
    if (objs.length >= 2 && objs.some(o => Object.keys(o).some(k => DATE.test(k)))) out.push({ path, n: node.length, keys: Object.keys(objs[0]).slice(0, 25), first: JSON.stringify(objs[0]).slice(0, 700) });
    node.slice(0, 3).forEach((x, i) => findLists(x, `${path}[${i}]`, out));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) if (k !== "_nextI18Next") findLists(v, `${path}.${k}`, out);
  }
  return out;
}

for (const url of process.argv.slice(2)) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json,text/html" } });
    const text = await res.text();
    let data = null;
    const m = text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    try { data = m ? JSON.parse(m[1]) : JSON.parse(text); } catch {}
    const lists = data ? findLists(data, "$", []).slice(0, 4) : [];
    console.log("PROBE " + JSON.stringify({ url, status: res.status, type: res.headers.get("content-type"), json: !!data, buildId: data?.buildId, page: data?.page, lists }));
    if (!lists.length) console.log("TEXT " + JSON.stringify({ url, text: text.replace(/\s+/g, " ").slice(0, 600) }));
  } catch (e) { console.log("PROBE " + JSON.stringify({ url, error: e.message })); }
}
