// Engångsverktyg: kollar hur eventsidor publicerar sin data (inbäddad JSON, API-anrop, <time>-taggar)
// och om robots.txt tillåter att sidan läses.
const URLS = process.argv.slice(2);
const UA = "AnknytningBot/0.1 (+https://github.com/fungusflip/Anknytning)";

function robotsAllows(txt, path) {
  // Läser bara gruppen för User-agent: *
  let active = false, rules = [];
  for (const raw of txt.split("\n")) {
    const line = raw.split("#")[0].trim();
    const [k, ...v] = line.split(":"); const val = v.join(":").trim();
    if (/^user-agent$/i.test(k)) active = val === "*";
    else if (active && /^(dis)?allow$/i.test(k) && val) rules.push([k.toLowerCase(), val]);
  }
  let best = ["allow", ""];
  for (const r of rules) { const pre = r[1].replace(/\*.*$/, "").replace(/\$$/, ""); if (path.startsWith(pre) && pre.length >= best[1].length) best = [r[0], pre]; }
  return { allowed: best[0] === "allow", rule: best[1] || null };
}

for (const url of URLS) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    const html = await res.text();
    const robots = await fetch(new URL("/robots.txt", url), { headers: { "user-agent": UA } }).then(r => r.ok ? r.text() : "").catch(() => "");
    const info = {
      url, status: res.status, bytes: html.length,
      robots: robotsAllows(robots, new URL(res.url).pathname),
      nextData: html.includes("__NEXT_DATA__"),
      sitevisionState: (html.match(/registerInitialState/g) || []).length,
      timeTags: (html.match(/<time[^>]*datetime=/g) || []).length,
      jsonLd: (html.match(/application\/ld\+json/g) || []).length,
      apiUrls: [...new Set([...html.matchAll(/["'](https?:\/\/[^"'\s]*(?:api|graphql|json|ical|\.ics|rss)[^"'\s]*|\/[^"'\s]*(?:\/api\/|graphql|\.json|\.ics|rss)[^"'\s]*)["']/gi)].map(m => m[1]))].slice(0, 8),
    };
    console.log("PROBE " + JSON.stringify(info));
    // Visa ett utdrag runt första förekomsten av ett datum i inbäddad data
    const m = html.match(/registerInitialState\([^,]+,\s*(\{[\s\S]{0,1500})/) || html.match(/__NEXT_DATA__[^>]*>([\s\S]{0,1500})/) || html.match(/(<time[\s\S]{0,600})/);
    if (m) console.log("SNIP " + JSON.stringify({ url, snip: m[1].replace(/\s+/g, " ").slice(0, 1200) }));
  } catch (e) {
    console.log("PROBE " + JSON.stringify({ url, error: e.message }));
  }
}
