const express = require("express");
const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();

const client = axios.create({
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
  },
  timeout: 5000
});

const FALLBACK_MAP = {
  "tt0214341": "Dragon Ball",
  "tt0280249": "Dragon Ball Z",
  "tt0988824": "Dragon Ball Super",
  "tt0409591": "Naruto",
  "tt0988822": "Naruto Shippuden",
  "tt0388629": "One Piece",
  "tt2560140": "Shingeki no Kyojin",
  "tt4644488": "One Punch Man",
  "tt12343534": "Jujutsu Kaisen",
  "tt9335498": "Kimetsu no Yaiba"
};

async function getAnimeTitle(id) {
  const parts = id.split(":");
  const mainId = parts[0];

  if (FALLBACK_MAP[mainId]) return FALLBACK_MAP[mainId];

  if (id.startsWith("kitsu")) {
    try {
      const res = await client.get(`https://kitsu.io/api/edge/anime/${parts[1]}`);
      const attr = res.data?.data?.attributes;
      if (attr) return attr.canonicalTitle || attr.titles.en || attr.titles.en_jp;
    } catch (e) {}
  }

  if (mainId.startsWith("tt")) {
    try {
      const res = await client.get(`https://v3-cinemeta.strem.fun/meta/series/${mainId}.json`);
      if (res.data?.meta?.name) return res.data.meta.name;
    } catch (e) {
      try {
        const kitsuRes = await client.get(`https://kitsu.io/api/edge/anime?filter[text]=${mainId}`);
        const attr = kitsuRes.data?.data?.[0]?.attributes;
        if (attr) return attr.canonicalTitle || attr.titles.en;
      } catch (err) {}
    }
  }

  return null;
}

async function scrapeAnimesOnline(title, episode) {
  const streams = [];
  try {
    const searchUrl = `https://animesonlinecc.to/?s=${encodeURIComponent(title)}`;
    const { data: searchHtml } = await client.get(searchUrl);
    const $search = cheerio.load(searchHtml);

    let animeUrl = "";
    $search(".result-item article .details .title a").each((_, el) => {
      const foundTitle = $search(el).text().trim().toLowerCase();
      if (foundTitle.includes(title.toLowerCase())) {
        animeUrl = $search(el).attr("href");
        return false;
      }
    });

    if (!animeUrl) return streams;

    const { data: animeHtml } = await client.get(animeUrl);
    const $anime = cheerio.load(animeHtml);

    let epUrl = "";
    $anime("#episodios li, .episodios li").each((_, el) => {
      const epText = $anime(el).text().trim();
      if (epText.includes(`Episódio ${episode}`) || epText.endsWith(` ${episode}`)) {
        epUrl = $anime(el).find("a").attr("href");
      }
    });

    if (epUrl) {
      const { data: epHtml } = await client.get(epUrl);
      const $ep = cheerio.load(epHtml);

      $ep("iframe").each((_, el) => {
        const src = $ep(el).attr("src") \vert{}\vert{} $ep(el).attr("data-src");
        if (src) {
          streams.push({
            title: `🌐 AnimesOnline - ${title} (Ep ${episode})`,
            url: src
          });
        }
      });
    }
  } catch (err) {}
  return streams;
}

async function fetchAnimeStreams(id) {
  const parts = id.split(":");
  const episode = parts.length > 2 ? parts[2] : (parts[1] || "1");
  const title = await getAnimeTitle(id);
  if (!title) return [];

  return await scrapeAnimesOnline(title, episode);
}

const manifest = {
  id: "br.meuanime.addon",
  version: "1.0.2",
  name: "Animes BR",
  description: "Addon de animes em PT-BR para Stremio.",
  resources: ["stream"],
  types: ["anime", "series"],
  idPrefixes: ["tt", "kitsu"],
  catalogs: []
};

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async ({ type, id }) => {
  let streams = await fetchAnimeStreams(id);
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

// Libera CORS para o Stremio em todas as rotas
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Rota do Manifesto
app.get(["/", "/manifest.json"], (req, res) => {
  res.json(addonInterface.manifest);
});

// Rota dos Streams
app.get("/stream/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  try {
    const resp = await addonInterface.get("stream", type, id);
    res.json(resp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;