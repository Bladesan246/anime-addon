const { addonBuilder } = require("stremio-addon-sdk");
const { fetchAnimeStreams } = require("../scrapers/animeScraper");

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

module.exports = async (req, res) => {
  // Libera acesso CORS para o aplicativo do Stremio
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  const url = req.url.toLowerCase();

  // Tratamento da rota do Manifesto
  if (url === "/" || url === "/manifest.json" || url.endsWith("/manifest.json")) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify(addonInterface.manifest));
  }

  // Tratamento da rota de Streams do Stremio
  if (url.includes("/stream/")) {
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