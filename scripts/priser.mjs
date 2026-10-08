// Letar upp priset på varje events egen sida, eftersom källorna sällan skickar med det.
// Följer robots.txt (inklusive Crawl-delay), hämtar en sida åt gången per webbplats,
// och sparar fynden i priser.json så att samma sida inte hämtas varje vecka.
import { readFile, writeFile } from "node:fs/promises";

const UA = "AnknytningBot/0.1 (+https://github.com/fungusflip/Anknytning)";
const BOT = "anknytningbot";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TIDSGRANS = Date.now() + 25 * 60 * 1000; // hela prisletningen får ta max 25 min
const OKAND_IGEN_DAGAR = 6; // sidor utan pris kollas igen nästa vecka

// --- robots.txt ---
const robotsCache = new Map();
async function robots(origin) {
  if (!robotsCache.has(origin)) robotsCache.set(origin, (async () => {
    try {
      const res = await fetch(origin + "/robots.txt", { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10000) });
      if (res.status >= 400 && res.status < 500) return { regler: [], delay: 1 }; // ingen robots.txt = allt tillåtet
      if (!res.ok) return null; // serverfel: hämta inget därifrån
      return tolkaRobots(await res.text());
    } catch { return null; }
  })());
  return robotsCache.get(origin);
}
function tolkaRobots(txt) {
  const grupper = []; let g = null, sistaVarAgent = false;
  for (const rad of txt.split(/\r?\n/)) {
    const m = rad.replace(/#.*/, "").match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    const [, k, v] = m, key = k.toLowerCase();
    if (key === "user-agent") {
      if (!sistaVarAgent) grupper.push(g = { agenter: [], regler: [], delay: null });
      g.agenter.push(v.toLowerCase()); sistaVarAgent = true; continue;
    }
    sistaVarAgent = false;
    if (!g) continue;
    if (key === "allow" || key === "disallow") { if (v) g.regler.push({ tillat: key === "allow", monster: v }); }
    else if (key === "crawl-delay") g.delay = parseFloat(v);
  }
  const val = grupper.find(x => x.agenter.some(a => a !== "*" && BOT.includes(a))) ?? grupper.find(x => x.agenter.includes("*"));
  return { regler: val?.regler ?? [], delay: Math.max(1, Math.min(val?.delay ?? 1, 15)) };
}
function tillats(r, path) {
  let bast = null;
  for (const regel of r.regler) {
    const re = new RegExp("^" + regel.monster.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\\\$$/, "$").replace(/\*/g, ".*"));
    if (re.test(path) && (!bast || regel.monster.length > bast.monster.length || (regel.monster.length === bast.monster.length && regel.tillat))) bast = regel;
  }
  return !bast || bast.tillat;
}

// --- hitta priset i en sida ---
const GRATIS = /(?<![\wåäöé])(gratis|fri entré|fritt inträde|kostnadsfri|ingen entré|free entry|free admission)(?![\wåäöé])/i;
function hittaPris(html) {
  // 1. Strukturerad data (schema.org), som många biljettsidor har
  const fynd = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { gaIgenom(JSON.parse(m[1].trim()), fynd); } catch {}
  }
  for (const m of html.matchAll(/itemprop=["'](?:price|lowPrice)["'][^>]*content=["']([\d.,]+)/gi)) fynd.push(tal(m[1]));
  const ld = fynd.filter(n => Number.isFinite(n) && n >= 0 && n <= 10000);
  if (ld.length) return Math.min(...ld);
  // 2. Text nära ord som pris/biljett/entré
  const text = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const priser = [];
  for (const m of text.matchAll(/(pris|biljett|entré|inträde|kostnad|avgift|ticket|price)[^.!?]{0,80}/gi)) {
    if (GRATIS.test(m[0])) priser.push(0);
    for (const k of m[0].matchAll(/(?:fr(?:\.|ån)?\s*)?(\d{2,5})(?:[,.]\d{2})?\s*(?::-|kr\b|sek\b|kronor)/gi)) priser.push(+k[1]);
  }
  if (!priser.length && GRATIS.test(text.slice(0, 20000))) priser.push(0);
  const ok = priser.filter(n => n === 0 || (n >= 20 && n <= 5000));
  return ok.length ? Math.min(...ok) : null;
}
function tal(v) { return typeof v === "number" ? v : parseFloat(String(v).replace(/\s/g, "").replace(",", ".")); }
function gaIgenom(o, fynd) {
  if (Array.isArray(o)) return o.forEach(x => gaIgenom(x, fynd));
  if (!o || typeof o !== "object") return;
  if (o.isAccessibleForFree === true || o.isAccessibleForFree === "true") fynd.push(0);
  const offers = o.offers ? [].concat(o.offers) : [];
  for (const of of offers) {
    if (!of || typeof of !== "object") continue;
    if (of.priceCurrency && !/SEK/i.test(of.priceCurrency)) continue;
    for (const k of ["price", "lowPrice"]) if (of[k] != null && of[k] !== "") fynd.push(tal(of[k]));
  }
  for (const v of Object.values(o)) if (v && typeof v === "object") gaIgenom(v, fynd);
}

// --- huvudfunktion ---
export async function fyllPriser(events, cacheFil) {
  let cache = {};
  try { cache = JSON.parse(await readFile(cacheFil, "utf8")); } catch {}
  const idag = Date.now();
  const kvar = new Map(); // origin -> [event]
  for (const e of events) {
    if (e.pris != null || !e.url) continue;
    const c = cache[e.url];
    if (c?.pris != null) { e.pris = c.pris; continue; }
    if (c && idag - Date.parse(c.kollad) < OKAND_IGEN_DAGAR * 864e5) continue;
    let u; try { u = new URL(e.url); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    if (!kvar.has(u.origin)) kvar.set(u.origin, []);
    kvar.get(u.origin).push(e);
  }
  const stat = {};
  // Flera webbplatser parallellt, men bara en sida i taget per webbplats
  const origins = [...kvar.keys()];
  async function arbetare() {
    while (origins.length && Date.now() < TIDSGRANS) {
      const origin = origins.shift(), lista = kvar.get(origin), host = new URL(origin).hostname;
      const s = stat[host] = { sidor: lista.length, hamtade: 0, pris: 0, nekad: 0, fel: 0 };
      const r = await robots(origin);
      if (!r) { s.fel = lista.length; continue; }
      const sett = new Map(); // samma sida för flera datum hämtas en gång
      for (const e of lista) {
        if (Date.now() > TIDSGRANS) break;
        const u = new URL(e.url);
        if (!tillats(r, u.pathname + u.search)) { s.nekad++; continue; }
        if (!sett.has(e.url)) {
          let pris = null;
          try {
            const res = await fetch(e.url, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
            if (res.ok && /html/i.test(res.headers.get("content-type") ?? "")) pris = hittaPris(await res.text());
            else if (!res.ok) s.fel++;
            if (res.status === 403 || res.status === 429) { s.fel += lista.length; break; } // blockerade, sluta fråga
            s.hamtade++;
          } catch { s.fel++; }
          sett.set(e.url, pris);
          cache[e.url] = { pris, kollad: new Date().toISOString() };
          await sleep(r.delay * 1000);
        }
        e.pris = sett.get(e.url);
        if (e.pris != null) s.pris++;
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, arbetare));
  // Rensa gamla cache-rader för sidor som inte längre finns bland eventen
  const urls = new Set(events.map(e => e.url));
  for (const k of Object.keys(cache)) if (!urls.has(k)) delete cache[k];
  await writeFile(cacheFil, JSON.stringify(cache, null, 1) + "\n");
  const topp = Object.entries(stat).sort((a, b) => b[1].sidor - a[1].sidor).slice(0, 25);
  for (const [h, s] of topp) console.log(`  pris ${h}: ${s.pris}/${s.sidor} (hämtade ${s.hamtade}, nekade av robots ${s.nekad}, fel ${s.fel})`);
  console.log(`Priser: ${events.filter(e => e.pris != null).length} av ${events.length} event har pris.`);
}

export { hittaPris, tolkaRobots, tillats };
