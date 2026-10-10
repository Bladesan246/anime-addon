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
  timeout: 8000
});

// Limpa pontuações e caracteres especiais para melhorar os resultados de busca
function sanitizeTitle(str) {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getAnimeTitles(id) {
  const parts = id.split(":");
  const mainId = parts[0];
  const rawTitles = new Set();

  // 1. Consulta no Kitsu (Idiomas: Japonês Romaji, Inglês e Canónico)
  if (id.startsWith("kitsu")) {
    try {
      const res = await client.get(`https://kitsu.io/api/edge/anime/${parts[1]}`);
      const attr = res.data?.data?.attributes;
      if (attr) {
        if (attr.canonicalTitle) rawTitles.add(attr.canonicalTitle);
        if (attr.titles?.en_jp) rawTitles.add(attr.titles.en_jp);
        if (attr.titles?.en) rawTitles.add(attr.titles.en);
        if (attr.titles?.ja_jp) rawTitles.add(attr.titles.ja_jp);
      }
    } catch (e) {}
  }

  // 2. Consulta no Cinemeta (IMDb ID ttXXXXX)
  if (mainId.startsWith("tt")) {
    try {
      const res = await client.get(`https://v3-cinemeta.strem.fun/meta/series/${mainId}.json`);
      if (res.data?.meta?.name) {
        rawTitles.add(res.data.meta.name);
      }
    } catch (e) {}

    try {
      const kitsuRes = await client.get(`https://kitsu.io/api/edge/anime?filter[text]=${mainId}`);
      const attr = kitsuRes.data?.data?.[0]?.attributes;
      if (attr) {
        if (attr.canonicalTitle) rawTitles.add(attr.canonicalTitle);
        if (attr.titles?.en_jp) rawTitles.add(attr.titles.en_jp);
        if (attr.titles?.en) rawTitles.add(attr.titles.en);
      }
    } catch (err) {}
  }

  // Monta lista com versões originais e tratadas
  const searchQueries = new Set();
  rawTitles.forEach((t) => {
    if (t) {
      searchQueries.add(t);
      searchQueries.add(sanitizeTitle(t));
    }
  });

  return Array.from(searchQueries);
}

async function scrapeAnimesOnlineForQuery(query, episode) {
  const streams = [];
  try {
    const searchUrl = `https://animesonlinecc.to/?s=${encodeURIComponent(query)}`;
    const { data: searchHtml } = await client.get(searchUrl);
    const $search = cheerio.load(searchHtml);

    let animeUrls = [];
    $search(".result-item article .details .title a, article a").each((_, el) => {
      const href = $search(el).attr("href");
      if (href && !animeUrls.includes(href)) {
        animeUrls.push(href);
      }
    });

    for (const animeUrl of animeUrls.slice(0, 3)) {
      const { data: animeHtml } = await client.get(animeUrl);
      const $anime = cheerio.load(animeHtml);

      let epUrls = [];
      $anime("#episodios li, .episodios li, ul.episodios li").each((_, el) => {
        const epText = $anime(el).text().trim().toLowerCase();
        const link = $anime(el).find("a").attr("href");

        // Verifica equivalência do número do episódio
        if (
          epText.includes(`episodio ${episode}`) ||
          epText.includes(`episódio ${episode}`) ||
          epText.includes(`ep ${episode}`) ||
          epText.endsWith(` ${episode}`)
        ) {
          if (link) epUrls.push(link);
        }
      });

      for (const epUrl of epUrls.slice(0, 2)) {
        const { data: epHtml } = await client.get(epUrl);
        const $ep = cheerio.load(epHtml);

        $ep("iframe, video source, embed, option").each((_, el) => {
          let src = "";
          const attrs = ["src", "data-src", "data-lazy-src", "value"];

          for (const attr of attrs) {
            const val = $ep(el).attr(attr);
            if (val && (val.includes("http") || val.includes("//"))) {
              src = val;
              break;
            }
          }

          if (
            src &&
            !src.includes("facebook") &&
            !src.includes("disqus") &&
            !src.includes("twitter")
          ) {
            if (src.startsWith("//")) src = "https:" + src;

            const isDub =
              epHtml.toLowerCase().includes("dublado") ||
              animeUrl.toLowerCase().includes("dublado");
            const label = isDub ? "Dublado" : "Legendado";

            streams.push({
              title: `🌐 AnimesOnline (${label}) - Ep ${episode}\n[Busca: ${query}]`,
              url: src
            });
          }
        });
      }
    }
  } catch (err) {}
  return streams;
}

async function fetchAnimeStreams(id) {
  const parts = id.split(":");
  const episode = parts.length > 2 ? parts[2] : parts[1] || "1";

  const queries = await getAnimeTitles(id);
  if (queries.length === 0) return [];

  let allStreams = [];

  // Testa as buscas sequencialmente até obter resultados
  for (const query of queries) {
    const streams = await scrapeAnimesOnlineForQuery(query, episode);
    if (streams.length > 0) {
      allStreams = allStreams.concat(streams);
      break;
    }
  }

  return allStreams;
}

const manifest = {
  id: "br.meuanime.addon",
  version: "1.0.5",
  name: "Animes BR",
  description: "Addon de animes PT-BR com busca multi-idioma.",
  resources: ["stream"],
  types: ["anime", "series", "movie"],
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

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.get(["/", "/manifest.json"], (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(JSON.stringify(addonInterface.manifest));
});

app.get("/stream/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  try {
    const resp = await addonInterface.get("stream", type, id);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.send(JSON.stringify(resp));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;