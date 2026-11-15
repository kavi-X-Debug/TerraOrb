// Service worker: lets Monsoon Compass open without internet (a PWA).
//
// App shell (HTML, CSS, JS, text files, icon, Leaflet, Chart.js, fonts):
//   served from the cache straight away, and refreshed in the background when online,
//   so a new version shows on the next visit.
// Data (../data/*.json):
//   always tries the network first so it's fresh; the copy is saved, and used when offline.
//   A response from the cache carries the header "x-mc-offline: 1" so the app can say so.
// Map tiles are not cached (too many); offline, the map shows markers without imagery.

const SHELL_CACHE = "mc-shell-v138";     // bump after a big UI change so it shows on the next visit
const DATA_CACHE = "mc-data-v1";

const SHELL_FILES = [
  "./", "index.html", "css/style.css", "css/site.css", "css/earth.css", "manifest.webmanifest", "icon.svg",
  "js/main.js", "js/i18n.js", "js/data.js", "js/ui.js", "js/map.js",
  "js/tank.js", "js/plan.js", "js/card.js", "js/learn.js", "js/forecast.js", "js/weather.js", "js/live.js", "js/crops.js", "js/about.js", "css/about.css", "js/calendar.js", "js/cropicons.js", "css/calendar.css", "js/assistant.js", "js/assistant-kb.js", "strings/assistant.en.json", "strings/assistant.si.json", "css/assistant.css", "js/challenges.js", "css/challenges.css", "js/minigame.js", "css/minigame.css", "js/datasources.js", "css/datasources.css", "js/kids.js", "css/kids.css", "js/cloudgame.js", "js/cloudaudio.js", "css/cloudgame.css", "css/farmgame.css", "css/matchgame.css", "css/lessons.css", "css/desktop.css", "css/week.css", "js/week.js", "js/outlook.js", "js/nowcast.js", "css/rewards.css", "js/rewards.js", "js/rewardspage.js", "css/ends.css", "css/ends-pages.css", "js/landing.js", "js/planner.js", "js/planner-extras.js", "js/officer.js", "js/research.js", "farmer.html", "learn.html", "officer.html", "research.html", "plan.html", "manifest-farmer.webmanifest", "manifest-learn.webmanifest", "manifest-officer.webmanifest", "manifest-research.webmanifest", "manifest-plan.webmanifest", "css/farm.css", "css/farm-plan.css", "js/farm/index.js", "js/farm/api.js", "js/farm/auth.js", "js/farm/register.js", "js/farm/location.js", "js/farm/zones.js", "js/farm/plan.js", "js/farm/mockups.js", "strings/manifest.json", "strings/farm.en.json", "strings/farm.si.json", "strings/farm-plan.en.json", "strings/farm-plan.si.json", "js/lessons.js", "img/lessons/water1.jpg", "img/lessons/water2.jpg", "img/lessons/water3.jpg", "img/lessons/seasons1.jpg", "img/lessons/seasons2.jpg", "img/lessons/seasons3.jpg", "img/lessons/cascade1.jpg", "img/lessons/cascade2.jpg", "img/lessons/cascade3.jpg", "img/lessons/sat1.jpg", "img/lessons/sat2.jpg", "img/lessons/sat3.jpg", "img/lessons/bethma1.jpg", "img/lessons/bethma2.jpg", "img/lessons/bethma3.jpg", "img/lessons/crops1.jpg", "img/lessons/crops2.jpg", "img/lessons/crops3.jpg", "img/lessons/forecast1.jpg", "img/lessons/forecast2.jpg", "img/lessons/forecast3.jpg", "img/lessons/sowing1.jpg", "img/lessons/sowing2.jpg", "img/lessons/sowing3.jpg", "img/lessons/fire1.jpg", "img/lessons/fire2.jpg", "img/lessons/fire3.jpg", "img/lessons/slide1.jpg", "img/lessons/slide2.jpg", "img/lessons/slide3.jpg", "img/lessons/elnino1.jpg", "img/lessons/elnino2.jpg", "img/lessons/elnino3.jpg", "img/lessons/carbon1.jpg", "img/lessons/carbon2.jpg", "img/lessons/carbon3.jpg", "img/lessons/cycle1.jpg", "img/lessons/cycle2.jpg", "img/lessons/cycle3.jpg", "img/lessons/ice1.jpg", "img/lessons/ice2.jpg", "img/lessons/ice3.jpg", "img/lessons/lanina1.jpg", "img/lessons/lanina2.jpg", "img/lessons/lanina3.jpg", "img/lessons/warming1.jpg", "img/lessons/warming2.jpg", "img/lessons/warming3.jpg", "js/matchgame.js", "js/gamesound.js", "img/match/cardback.png", "img/farm/sweetpotato.png", "img/farm/millet.png", "img/farm/sesame.png", "img/farm/cowpea.png", "img/match/meadow.jpg", "css/loader.css", "css/learnhub.css", "img/learn/hero.jpg", "img/learn/cloud.jpg", "img/learn/farmer.jpg", "img/learn/kids.jpg", "img/learn/challenges.jpg", "js/plantation.js", "img/farm/groundnut.png", "img/farm/chilli.png", "img/farm/brinjal.png", "img/farm/pumpkin.png", "img/farm/onion.png", "img/farm/farmer.png", "img/farm/drop.png", "img/farm/bean.png", "img/farm/maize.png", "img/farm/seedling.png", "img/game/cloud.png", "img/game/cloud_full.png", "img/game/palm.png", "img/how/wewa.jpg", "img/how/satellite.jpg", "img/how/laptop.jpg", "img/how/meeting.jpg", "img/how/farmer.jpg", "img/how/rain.jpg", "img/game/tank.png", "img/game/paddy.png", "img/game/sun.png", "img/hero.jpg", "img/rain.jpg", "img/crops.jpg", "img/crops/mung_bean.jpg", "img/crops/cowpea.jpg", "img/crops/black_gram.jpg", "img/crops/maize.jpg", "img/crops/groundnut.jpg", "img/crops/soybean.jpg", "img/crops/finger_millet.jpg", "img/crops/sesame.jpg", "img/crops/sweet_potato.jpg", "img/crops/big_onion.jpg", "img/crops/brinjal.jpg", "img/crops/chilli.jpg", "img/crops/pumpkin.jpg", "img/crops/paddy.jpg", "img/crops/paddy_short.jpg", "img/crops/credits.json",
  "si.json", "en.json",
];
const CDN_FILES = [
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
];
// Other sites whose files we keep once loaded (fonts, html2canvas for Share).
const CACHED_HOSTS = ["unpkg.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com",
                      "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // cache: "reload" = fetch from the server, not from the browser's HTTP cache,
    // otherwise an old copy of a file could be saved for offline use.
    await cache.addAll(SHELL_FILES.map((url) => new Request(url, { cache: "reload" })));
    // CDN files: best effort, one failing must not stop the install.
    await Promise.all(CDN_FILES.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name !== SHELL_CACHE && name !== DATA_CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (request.headers.has("range") || request.destination === "video" || request.destination === "audio") return;     // videos stream straight from the network (the cache cannot hold partial responses)
  const url = new URL(request.url);

  if (url.origin === self.location.origin && url.pathname.includes("/data/") && url.pathname.endsWith(".json")) {
    event.respondWith(networkFirst(request));
  } else if (url.origin === self.location.origin || CACHED_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
  // anything else (map tiles, NASA APIs): normal network request
});

async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (!cached) throw new Error("offline and not cached");
    const headers = new Headers(cached.headers);
    headers.set("x-mc-offline", "1");
    return new Response(await cached.blob(), { status: cached.status, statusText: cached.statusText, headers });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  // Ask the server whether the file changed (not the browser's HTTP cache).
  const fresh = request.mode === "navigate"
    ? new Request(request.url, { cache: "no-cache", credentials: "same-origin" })
    : new Request(request, { cache: "no-cache" });
  const update = fetch(fresh)
    .then((response) => {
      if (response.ok || response.type === "opaque") cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await update) || new Response("Offline", { status: 503 });
}
