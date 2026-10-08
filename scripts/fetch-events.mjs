// Samlar event runt Stockholm–Bro från flera källor och skriver dem till events.json.
// Körs av GitHub Actions en gång i veckan (måndagar), eller för hand via "Run workflow".
//
// Källor:
//  1. egna-event.json  – lokala event du lägger in för hand
//  2. Ticketmaster     – kräver repo-secret TICKETMASTER_KEY (gratis: developer.ticketmaster.com)
//  3. Visit Stockholm  – öppet API
//  4. Nacka kommun     – "På gång i Nacka"
// Fler källor (t.ex. kommunernas evenemangskalendrar) läggs till som nya funktioner i SOURCES.
import { readFile, writeFile } from "node:fs/promises";
import { fyllPriser } from "./priser.mjs";

const UA = "AnknytningBot/0.1 (+https://github.com/fungusflip/Anknytning)";
const ROOT = new URL("../", import.meta.url);
const today = new Date().toISOString().slice(0, 10);
// Mittpunkt mellan Stockholm och Bro. Event längre bort än MAX_KM tas bort
// (vissa källor har fel koordinater, t.ex. event som egentligen ligger i Halmstad).
const CENTER = { lat: 59.45, lon: 17.85 }, MAX_KM = 55;
function km(a, b) {
  const r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

async function egnaEvent() {
  const list = JSON.parse(await readFile(new URL("egna-event.json", ROOT), "utf8"));
  for (const e of list) if (!e.url) console.warn(`Egna event: "${e.t}" saknar url till eventets egen sida.`);
  return list.map((e, i) => ({ id: `egen-${i}`, e: "📌", img: null, url: null, tags: [], ...e }));
}

const TM_EMOJI = { Music: "🎵", Sports: "⚽", "Arts & Theatre": "🎭", Film: "🎬", Family: "🎈" };

async function ticketmaster() {
  const key = process.env.TICKETMASTER_KEY;
  if (!key) { console.log("Ticketmaster: ingen nyckel, hoppar över."); return []; }
  const out = [];
  for (let page = 0; page < 5; page++) {
    const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
    url.search = new URLSearchParams({
      apikey: key, latlong: "59.45,17.85", radius: "50", unit: "km",
      countryCode: "SE", sort: "date,asc", size: "100", page: String(page), locale: "*",
    });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Ticketmaster svarade ${res.status}`);
    const data = await res.json();
    for (const e of data._embedded?.events ?? []) {
      const v = e._embedded?.venues?.[0];
      const lat = parseFloat(v?.location?.latitude), lon = parseFloat(v?.location?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const c = e.classifications?.[0] ?? {};
      const pr = e.priceRanges?.[0];
      const img = (e.images ?? []).filter(i => i.ratio === "16_9" && i.width >= 600).sort((a, b) => a.width - b.width)[0];
      out.push({
        id: `tm-${e.id}`,
        t: e.name,
        e: TM_EMOJI[c.segment?.name] ?? "✨",
        img: img?.url ?? null,
        datum: e.dates?.start?.localDate ?? null,
        tid: e.dates?.start?.localTime?.slice(0, 5) ?? null,
        plats: [v?.name, v?.city?.name].filter(Boolean).join(", "),
        lat, lon,
        pris: pr ? Math.round(pr.min) : null,
        tags: [c.segment?.name, c.genre?.name, c.subGenre?.name]
          .filter(t => t && !["Undefined", "Other"].includes(t)).map(t => t.toLowerCase()),
        url: e.url,
      });
    }
    if (page + 1 >= (data.page?.totalPages ?? 0)) break;
  }
  return out;
}

// Visit Stockholm: öppet API (robots.txt tillåter det). Ca 50 sidor à 16 event,
// hämtas långsamt med paus mellan anropen för att inte belasta deras server.
const VS = "https://www.visitstockholm.se";
const VS_EMOJI = { exhibitions: "🖼️", "stage-film": "🎭", music: "🎵", "food-drink": "🍽️", sports: "⚽", family: "🎈", "networking-community": "🤝", nightlife: "🪩", shopping: "🛍️", outdoors: "🌲" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FREE = /gratis|fri entré|fritt inträde|free admission|free entry/i;
// Pris står ibland i beskrivningen, t.ex. "Biljett 150 kr" eller "Pris: 95 SEK". Ta det lägsta.
function vsPris(html = "") {
  const txt = html.replace(/<[^>]+>/g, " ");
  if (FREE.test(txt)) return 0;
  const tal = [...txt.matchAll(/(\d{2,4})(?:[:,]-)?\s?(?:kr|sek)\b/gi)].map(m => +m[1]).filter(n => n >= 20 && n <= 5000);
  return tal.length ? Math.min(...tal) : null;
}

async function visitStockholm() {
  const out = [];
  for (let page = 1; page <= 80; page++) {
    const res = await fetch(`${VS}/api/v1/singulareventdates/?page=${page}`, {
      headers: { "user-agent": "AnknytningBot/0.1 (+https://github.com/fungusflip/Anknytning)", accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Visit Stockholm svarade ${res.status} på sida ${page}`);
    const data = await res.json();
    for (const e of data.results ?? []) {
      const lat = e.location?.latitude, lon = e.location?.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const pågår = e.start_date < today && e.end_date >= today;
      const img = e.image?.renditions?.small?.src ?? e.image?.url;
      out.push({
        id: `vs-${e.id}`,
        t: e.title,
        e: VS_EMOJI[e.category?.slug] ?? "✨",
        img: img ? new URL(img, VS).href : null,
        datum: pågår ? today : e.start_date,
        slut: e.end_date && e.end_date !== e.start_date ? e.end_date : null,
        tid: null,
        plats: [e.venue_name, e.city].filter(Boolean).join(", ") || e.address,
        lat, lon,
        pris: vsPris(e.description),
        tags: [...new Set([...(e.categories ?? []), e.subcategory?.title].filter(Boolean).map(t => t.toLowerCase()))],
        url: e.external_website_url || e.href,
      });
    }
    if (!data.next) break;
    await sleep(700);
  }
  return out;
}

// Nacka kommun: "På gång i Nacka" (robots.txt tillåter). Kartvyn innehåller alla event
// som JSON med koordinater, så en enda sidhämtning räcker.
const ENT = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", nbsp: " " };
const unent = s => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, c) =>
  c[0] === "#" ? String.fromCodePoint(c[1] === "x" || c[1] === "X" ? parseInt(c.slice(2), 16) : +c.slice(1)) : ENT[c] ?? m);
const strip = s => unent(unent(s.replace(/<[^>]+>/g, " "))).replace(/\s+/g, " ").trim();
const sthlm = (iso, opt) => new Date(iso).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", ...opt });
// Riktar sig till unga vuxna, så event bara för seniorer eller små barn hoppas över
const INTE_FOR_UNGA = /(?<![\wåäö])(senior\w*|65\+|55\+|pension\w*|spf|bebis|baby\w*|babyrytmik|barnrytmik|sagostund|högläsning\w*|läxhjälp|småbarn|förskola|knytte|(?:[0-9]|1[0-2])\s?[-–]\s?(?:[0-9]|1[0-2])\s?år)(?![\wåäö])/i;

async function nacka() {
  const base = "https://www.nacka.se";
  const res = await fetch(`${base}/pa-gang-i-nacka/?panel=map`, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`Nacka svarade ${res.status}`);
  const html = await res.text();
  const start = html.indexOf("{&quot;markers&quot;");
  if (start < 0) throw new Error("hittade ingen kartdata hos Nacka");
  const { markers } = JSON.parse(unent(html.slice(start, html.indexOf("<", start))));
  const out = [];
  for (const m of markers ?? []) {
    const c = m.content ?? "";
    const a = c.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const times = [...c.matchAll(/datetime="([^"]+)"/g)].map(x => x[1]);
    if (!a || !times.length || !Number.isFinite(m.position?.lat)) continue;
    const meta = [...c.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(x => strip(x[1]));
    const tags = [...c.matchAll(/\?type=([^"&]+)/g)].map(x => decodeURIComponent(x[1]).toLowerCase());
    const text = strip(c);
    if (INTE_FOR_UNGA.test(text) || tags.some(t => INTE_FOR_UNGA.test(t))) continue;
    const startDag = sthlm(times[0], { year: "numeric", month: "2-digit", day: "2-digit" });
    const slut = times[1] ? sthlm(times[1], { year: "numeric", month: "2-digit", day: "2-digit" }) : null;
    const tid = meta.find(x => /^Tid:/.test(x))?.match(/\d{1,2}[:.]\d{2}/)?.[0]?.replace(".", ":") ?? null;
    const plats = meta.find(x => /^Plats:/.test(x))?.replace(/^Plats:\s*/, "");
    const img = c.match(/<img[^>]*src="([^"]+)"/)?.[1];
    const url = new URL(unent(a[1]), base).href;
    out.push({
      id: `nacka-${new URL(url).pathname.split("/").filter(Boolean).at(-1)}-${startDag}`,
      t: strip(a[2]),
      e: tags.some(t => /musik|konsert/.test(t)) ? "🎵" : tags.some(t => /teater/.test(t)) ? "🎭" : tags.some(t => /konst|utst/.test(t)) ? "🖼️" : "📍",
      img: img ? new URL(unent(img), base).href : null,
      datum: slut && startDag < today && slut >= today ? today : startDag,
      slut: slut && slut !== startDag ? slut : null,
      tid,
      plats: plats ? `${plats}, Nacka` : "Nacka",
      lat: m.position.lat, lon: m.position.lng,
      pris: /gratis|fri entré|fritt inträde|kostnadsfri/i.test(text) ? 0 : null,
      tags: [...new Set(["nacka", ...tags])],
      url,
    });
  }
  return out;
}

// Kommuner med en vanlig evenemangslista (robots.txt tillåter). Listan ger länk och datum,
// varje events egen sida ger titel, bild och beskrivning. Platsen sätts till kommunens mitt
// eftersom sidorna inte har koordinater.
const KOMMUNER = [
  { namn: "Haninge", lista: "https://www.haninge.se/evenemang-och-aktiviteter/", sidor: 3,
    lank: /href="(\/evenemang-och-aktiviteter\/(?!lagg-in)[^"\/?]+\/)\?d=(\d{4}-\d{2}-\d{2})"/g, lat: 59.1684, lon: 18.1440 },
  { namn: "Lidingö", lista: "https://lidingo.se/kultur-fritid/evenemangskalendern/", sidor: 3,
    lank: /href="(https:\/\/lidingo\.se\/kultur-fritid\/evenemangskalendern\/(?!om-)[^"\/?]+\/)\?startDate=(\d{4}-\d{2}-\d{2})_(\d{2}:\d{2})"/g, lat: 59.3663, lon: 18.1500 },
];
const meta = (html, prop) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)`, "i"))?.[1]
  ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i"))?.[1];

async function kommunKalender(k) {
  const traffar = new Map(); // sida -> första datum
  for (let sida = 1; sida <= k.sidor; sida++) {
    const url = sida === 1 ? k.lista : `${k.lista}?paged=${sida}&page=${sida}`;
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (!res.ok) { if (sida === 1) throw new Error(`${k.namn} svarade ${res.status}`); break; }
    const html = await res.text(); let nya = 0;
    for (const m of html.matchAll(k.lank)) {
      const sidUrl = new URL(m[1], k.lista).href, nyckel = sidUrl + m[2];
      if (!traffar.has(nyckel)) { traffar.set(nyckel, { sidUrl, datum: m[2], tid: m[3] ?? null, lankUrl: new URL(m[0].slice(6, -1).replace(/&amp;/g, "&"), k.lista).href }); nya++; }
    }
    if (!nya) break;
    await sleep(1000);
  }
  const out = [], sidinfo = new Map();
  for (const t of [...traffar.values()].slice(0, 150)) {
    if (!sidinfo.has(t.sidUrl)) {
      try {
        const res = await fetch(t.sidUrl, { headers: { "user-agent": UA } });
        const html = res.ok ? await res.text() : "";
        sidinfo.set(t.sidUrl, { titel: unent(meta(html, "og:title") ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, "") ?? "").replace(/\s*[|–-]\s*(Haninge|Lidingö)[^|]*$/i, "").trim(),
          bild: /logo/i.test(meta(html, "og:image") ?? "") ? null : meta(html, "og:image"), text: strip(meta(html, "og:description") ?? "") + " " + strip(html.match(/<main[\s\S]*?<\/main>/i)?.[0]?.slice(0, 20000) ?? ""),
          tid: html.match(/(?:kl\.?|klockan|tid:?)\s*(\d{1,2})[.:](\d{2})/i) });
      } catch { sidinfo.set(t.sidUrl, null); }
      await sleep(1000);
    }
    const info = sidinfo.get(t.sidUrl);
    if (!info?.titel || INTE_FOR_UNGA.test(info.titel + " " + info.text.slice(0, 600))) continue;
    out.push({
      id: `${k.namn.toLowerCase()}-${new URL(t.sidUrl).pathname.split("/").filter(Boolean).at(-1)}-${t.datum}`,
      t: info.titel, e: "📍",
      img: info.bild ? new URL(unent(info.bild), t.sidUrl).href : null,
      datum: t.datum,
      tid: t.tid ?? (info.tid ? `${info.tid[1].padStart(2, "0")}:${info.tid[2]}` : null),
      plats: k.namn, lat: k.lat, lon: k.lon,
      pris: null, // hittas av prisläsaren på eventets egen sida
      tags: [k.namn.toLowerCase()],
      url: t.lankUrl,
    });
  }
  return out;
}

const SOURCES = { "Egna event": egnaEvent, Ticketmaster: ticketmaster, "Visit Stockholm": visitStockholm, Nacka: nacka,
  ...Object.fromEntries(KOMMUNER.map(k => [k.namn, () => kommunKalender(k)])) };

const events = [], used = [];
for (const [name, fn] of Object.entries(SOURCES)) {
  try {
    const list = (await fn()).filter(e => e.datum && e.datum >= today && Number.isFinite(e.lat) && km(CENTER, e) <= MAX_KM);
    console.log(`${name}: ${list.length} event`);
    if (list.length) used.push(name);
    for (const e of list) if (!events.some(x => x.t === e.t && x.datum === e.datum)) events.push(e);
  } catch (err) {
    console.error(`${name} misslyckades: ${err.message}`);
  }
}

if (!events.length) {
  console.log("Inga riktiga event hittades, behåller nuvarande events.json.");
  process.exit(0);
}

await fyllPriser(events, new URL("priser.json", ROOT));

events.sort((a, b) => (a.datum + (a.tid ?? "")).localeCompare(b.datum + (b.tid ?? "")));
const out = { uppdaterad: new Date().toISOString(), kalla: used.join(" + "), exempel: false, events };
await writeFile(new URL("events.json", ROOT), JSON.stringify(out, null, 2) + "\n");
console.log(`Sparade ${events.length} event.`);
