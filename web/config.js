// Where the website finds its services. Loaded before every page's scripts (see tools/ends/template.html).
//   - on your own computer (localhost) nothing is set: the farm planner and the chat use http://localhost:8000
//   - when hosted: the chat helper is a Cloudflare Pages Function on the SAME address as the site (/api/copilot/...),
//     and the farm planner backend runs on Hugging Face. Change FARM_API if the Space has another address.
(function () {
  var host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return;
  var FARM_API = "https://kavixdebug-terraorb-api.hf.space";
  window.MC_API = window.MC_API || FARM_API;
  window.MC_COPILOT_API = window.MC_COPILOT_API || location.origin;
})();
