const { addonBuilder } = require("stremio-addon-sdk");
const { fetchAnimeStreams } = require("../scrapers/animeScraper");

const manifest = {
  id: "br.meuanime.addon",
  version: "1.0.2",
  name: "Animes BR",
  description: "Addon focado em animes dublados e legendados em PT-BR.",
  resources: ["stream"],
  types: ["anime", "series"],
  idPrefixes: ["tt", "kitsu"],
  catalogs: []
};

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async ({ type, id }) => {
  let streams = [];
  try {
    streams = await fetchAnimeStreams(id);
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

module.exports = (req, res) => {
  // Permite conexões CORS do Stremio
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.url === "/" || req.url === "/manifest.json") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify(addonInterface.manifest));
  }

  if (req.url.startsWith("/stream/")) {
    const parts = req.url.split("/");
    const type = parts[2];
    const id = parts[3].replace(".json", "");

    return addonInterface.get("stream", type, id)
      .then((resp) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(resp));
      })
      .catch((err) => {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      });
  }

  res.statusCode = 404;
  res.end("Not Found");
};