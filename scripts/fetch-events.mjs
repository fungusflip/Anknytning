// Samlar event runt Stockholm–Bro från flera källor och skriver dem till events.json.
// Körs av GitHub Actions en gång i veckan (måndagar), eller för hand via "Run workflow".
//
// Källor:
//  1. egna-event.json  – lokala event du lägger in för hand
//  2. Ticketmaster     – kräver repo-secret TICKETMASTER_KEY (gratis: developer.ticketmaster.com)
// Fler källor (t.ex. kommunernas evenemangskalendrar) läggs till som nya funktioner i SOURCES.
import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const today = new Date().toISOString().slice(0, 10);

async function egnaEvent() {
  const list = JSON.parse(await readFile(new URL("egna-event.json", ROOT), "utf8"));
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

const SOURCES = { "Egna event": egnaEvent, Ticketmaster: ticketmaster };

const events = [], used = [];
for (const [name, fn] of Object.entries(SOURCES)) {
  try {
    const list = (await fn()).filter(e => e.datum && e.datum >= today && Number.isFinite(e.lat));
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

events.sort((a, b) => (a.datum + (a.tid ?? "")).localeCompare(b.datum + (b.tid ?? "")));
const out = { uppdaterad: new Date().toISOString(), kalla: used.join(" + "), exempel: false, events };
await writeFile(new URL("events.json", ROOT), JSON.stringify(out, null, 2) + "\n");
console.log(`Sparade ${events.length} event.`);
