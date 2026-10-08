// Engångsverktyg: letar efter API-adresser i en Next.js-sidas JavaScript och skriver ut ett helt exempel-event.
const UA = "AnknytningBot/0.1 (+https://github.com/fungusflip/Anknytning)";
const url = process.argv[2];
const base = new URL(url).origin;
const html = await (await fetch(url, { headers: { "user-agent": UA } })).text();
const nd = JSON.parse(html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]);
const blocks = nd.props.pageProps.componentProps?.contentBlocks ?? [];
console.log("BLOCKS " + JSON.stringify(blocks.map(b => ({ type: b.type, keys: Object.keys(b.value ?? {}), n: b.value?.items?.length }))));
const item = blocks.flatMap(b => b.value?.items ?? []).find(i => i.startDate);
if (item) { const c = { ...item, description: "…" }; console.log("ITEM " + JSON.stringify(c).slice(0, 2500)); }
const chunks = [...new Set([...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map(m => m[1]))];
const found = new Set();
for (const c of chunks) {
  const js = await (await fetch(base + c, { headers: { "user-agent": UA } })).text();
  for (const m of js.matchAll(/["'`](\/api\/[^"'`\s]{2,80}|https?:\/\/[a-z0-9.-]*visitstockholm[^"'`\s]{0,80}api[^"'`\s]{0,60})["'`]/gi)) found.add(m[1]);
}
console.log("APIS " + JSON.stringify([...found].slice(0, 40)));
const robots = await (await fetch(base + "/robots.txt", { headers: { "user-agent": UA } })).text();
console.log("ROBOTS " + JSON.stringify(robots.slice(0, 800)));
