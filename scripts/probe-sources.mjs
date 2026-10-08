// Engångsverktyg: kollar vilka eventsidor som går att läsa och hur (JSON-LD, iCal, RSS, JSON).
const URLS = process.argv.slice(2);
const UA = "AnknytningBot/0.1 (+https://github.com/fungusflip/Anknytning)";
for (const url of URLS) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/json,text/calendar,*/*" }, redirect: "follow" });
    const text = await res.text();
    const ld = [...text.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
    const ldEvents = ld.filter(s => /"@type"\s*:\s*"[A-Za-z]*Event"/.test(s)).length;
    const feeds = [...new Set([...text.matchAll(/(?:href|src)="([^"]*(?:\.ics|ical|rss|feed|\/api\/)[^"]*)"/gi)].map(m => m[1]))].slice(0, 6);
    const robots = await fetch(new URL("/robots.txt", url), { headers: { "user-agent": UA } }).then(r => r.ok ? r.text() : "").catch(() => "");
    const disallow = robots.split("\n").filter(l => /^disallow:/i.test(l.trim())).map(l => l.trim().slice(9).trim()).filter(Boolean);
    const path = new URL(res.url).pathname;
    const blocked = disallow.some(d => d !== "" && path.startsWith(d.replace(/\*.*$/, "")));
    console.log(JSON.stringify({ url, final: res.url, status: res.status, type: res.headers.get("content-type"), bytes: text.length, ldBlocks: ld.length, ldEvents, feeds, robotsBlocks: blocked, sample: text.replace(/\s+/g, " ").slice(0, 160) }));
  } catch (e) {
    console.log(JSON.stringify({ url, error: e.message }));
  }
}
