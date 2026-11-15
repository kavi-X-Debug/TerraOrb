// A small "NASA layers" switch for Leaflet maps: lets the user lay a real NASA satellite picture over the street map.
// All pictures come from NASA GIBS (Global Imagery Browse Services, public, no login). Time = "default", i.e. the newest picture GIBS has.
// Labels come from t() keys nl.* (web/strings/nasa.*.json). A layer that cannot load simply shows no tiles; nothing is invented.
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

// id -> GIBS layer, tile matrix level, file type, opacity. Layer ids were checked against the GIBS capabilities document.
export const NASA_LAYERS = [
  { id: "truecolor", layer: "MODIS_Terra_CorrectedReflectance_TrueColor", level: 9, ext: "jpg", opacity: 0.95 },
  { id: "rain", layer: "IMERG_Precipitation_Rate", level: 6, ext: "png", opacity: 0.7 },
  { id: "ndvi", layer: "MODIS_Terra_NDVI_8Day", level: 9, ext: "png", opacity: 0.8 },
  { id: "flood", layer: "MODIS_Combined_Flood_3-Day", level: 9, ext: "png", opacity: 0.85 },
  { id: "cloud", layer: "MODIS_Aqua_Cloud_Fraction_Day", level: 6, ext: "png", opacity: 0.6 },
  { id: "night", layer: "VIIRS_Black_Marble", level: 8, ext: "png", opacity: 0.9 },
  { id: "no2", layer: "OMI_Nitrogen_Dioxide_Tropo_Column", level: 6, ext: "png", opacity: 0.75 },
  { id: "aod", layer: "MODIS_Combined_Value_Added_AOD", level: 6, ext: "png", opacity: 0.75 },
  { id: "heat", layer: "MODIS_Terra_Land_Surface_Temp_Day", level: 7, ext: "png", opacity: 0.75 },
];

/** Add the layer switch to a map. `L` is Leaflet, `t` the text function. Returns the Leaflet control (or null). */
export function addNasaLayers(L, map, t) {
  if (!L || !map) return null;
  const overlays = {};
  for (const l of NASA_LAYERS) {
    const url = `${GIBS}/${l.layer}/default/default/GoogleMapsCompatible_Level${l.level}/{z}/{y}/{x}.${l.ext}`;
    overlays[t(`nl.${l.id}`)] = L.tileLayer(url, { maxNativeZoom: l.level, maxZoom: 19, opacity: l.opacity, attribution: t("nl.credit") });
  }
  // radio-style: one NASA picture at a time (overlays are check boxes in Leaflet, so we switch the others off ourselves)
  const control = L.control.layers(null, overlays, { collapsed: true, position: "topright" }).addTo(map);
  map.on("overlayadd", (e) => { for (const layer of Object.values(overlays)) if (layer !== e.layer && map.hasLayer(layer)) map.removeLayer(layer); });
  return control;
}
