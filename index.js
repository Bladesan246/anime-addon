const { addonBuilder } = require("stremio-addon-sdk");
const path = require("path");

// Importação dinâmica do scraper para o ambiente Serverless da Vercel
let fetchAnimeStreams;
try {
  fetchAnimeStreams = require("../scrapers/animeScraper").fetchAnimeStreams;
} catch (e) {
  fetchAnimeStreams = require(path.join(process.cwd(), "scrapers", "animeScraper")).fetchAnimeStreams;
}

const manifest = {
  id: "br.meuanime.addon",
  version: "1.0.2",
  name: "Animes BR",
  description: "Addon de animes legendados e dublados em PT-BR.",
  resources: ["stream"],
  types: ["anime", "series"],
  idPrefixes: ["tt", "kitsu"],
  catalogs: []
};

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async ({ type, id }) => {
  let streams = [];
  try {
    if (fetchAnimeStreams) {
      streams = await fetchAnimeStreams(id);
    }
  } catch (error) {
    console.error("[Erro Handler]:", error.message);
  }

  if (!streams || streams.length === 0) {
    streams = [
      {
        title: "⚠️ Nenhum stream encontrado para este episódio",
        url: "https://vjs.zencdn.net/v/oceans.mp4"
      }
    ];
  }

  return { streams, cacheMaxAge: 0 };
});

const addonInterface = builder.getInterface();

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  const rawUrl = req.url.split('?')[0].toLowerCase();

  // Rota do Manifesto
  if (rawUrl === "/" || rawUrl === "/manifest.json" || rawUrl.endsWith("/manifest.json")) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify(addonInterface.manifest));
  }

  // Rota de Streams
  if (rawUrl.includes("/stream/")) {
    const parts = req.url.split("/");
    const type = parts[2];
    const id = parts[3] ? parts[3].replace(".json", "") : "";

    try {
      const resp = await addonInterface.get("stream", type, id);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify(resp));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "Not Found" }));
};