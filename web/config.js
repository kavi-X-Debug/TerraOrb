// Where the website finds its services. Loaded before every page's scripts (see tools/ends/template.html).
//   - on your own computer (localhost) nothing is set: the farm planner and the chat use http://localhost:8000
//   - when hosted: the chat helper is a Cloudflare Pages Function on the SAME address as the site (/api/copilot/...),
//     and the farm planner backend is NOT online yet (it needs a server and an SMS service for sign-in codes). Until it is, FARM_API
//     points to an address that cannot be reached, so the farm pages show the friendly "not online yet" message and never try
//     the visitor's own computer. When a backend exists, put its address in FARM_API (and its site address in the backend's MC_CORS).
(function () {
  var host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return;
  var FARM_API = "https://farm-service-not-online.invalid";
  window.MC_API = window.MC_API || FARM_API;
  window.MC_COPILOT_API = window.MC_COPILOT_API || location.origin;
})();
