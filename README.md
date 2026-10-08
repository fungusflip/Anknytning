# Anknytning

En app där unga swipear fram event nära sig (Stockholm–Bro). Man behöver inte logga in och kan söka med intresseord.
Appen kompletterar befintliga tjänster och riktar sig till unga utanför färdiga "in-groups".

UX-case i kursen UI/UX & Frontendutveckling, Lexicon, hösten 2026.

## Testa

**https://fungusflip.github.io/Anknytning/** (när GitHub Pages är påslaget)

Appen frågar efter din plats och sorterar event efter avstånd. Nekar du visas event nära Bro.
Vädret hämtas från [Open-Meteo](https://open-meteo.com) för eventets dag och plats.

- **Start:** dra kortet åt höger (intresserad) eller vänster (nästa).
- **Sök:** sök med intresseord.
- **Intresserade:** dina högerswipes.
- **Eventdetalj:** tryck på ett event för pris, tid, plats och väder.

## Var eventen kommer ifrån

En GitHub Action ([update-events.yml](.github/workflows/update-events.yml)) kör
[scripts/fetch-events.mjs](scripts/fetch-events.mjs) varje måndag. Den samlar event från alla källor
inom 50 km från Stockholm–Bro och sparar dem i `events.json`, som appen läser.
Tills någon källa ger riktiga event visar appen exempel-event.

| Källa | Hur du slår på den |
|---|---|
| Egna event | Lägg till event i [egna-event.json](egna-event.json) (se exempel nedan) |
| Ticketmaster | Skaffa en gratis nyckel på developer.ticketmaster.com och spara den som repo-secret `TICKETMASTER_KEY` (Settings → Secrets and variables → Actions) |

Vill du köra hämtningen direkt: **Actions → Hämta event → Run workflow**.

Exempel på ett eget event (t.ex. från en Facebook-sida, med länk tillbaka dit):

```json
[
  {
    "t": "Brädspelskväll",
    "datum": "2026-10-17",
    "tid": "18:00",
    "plats": "Kungsängens bibliotek",
    "lat": 59.4777,
    "lon": 17.7516,
    "pris": 0,
    "tags": ["spel"],
    "url": "https://www.facebook.com/events/..."
  }
]
```

Koordinater (`lat`, `lon`) hittar du genom att högerklicka på platsen i Google Maps.
Facebook och Meetup går inte att hämta automatiskt: Facebook har inget öppet event-API och
Meetups API kräver ett betalt Pro-konto.

## Dokument

- [Kravlista (user stories, MoSCoW)](docs/kravlista.md)
- [Sitemap](docs/sitemap.png)

## Nästa steg

- Flöde och wireframes (modul 2, övning 2.7)
- Figma-prototyp (modul 3)
- Fler källor, t.ex. kommunernas evenemangskalendrar
