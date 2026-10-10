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
  timeout: 6000
});

/**
 * Busca o título do anime DINAMICAMENTE (sem lista fixa)
 */
async function getAnimeTitle(id) {
  const parts = id.split(":");
  const mainId = parts[0];

  // 1. Busca no Kitsu se for ID de anime
  if (id.startsWith("kitsu")) {
    try {
      const res = await client.get(`https://kitsu.io/api/edge/anime/${parts[1]}`);
      const attr = res.data && res.data.data && res.data.data.attributes;
      if (attr) {
        return attr.canonicalTitle || attr.titles.en || attr.titles.en_jp;
      }
    } catch (e) {}
  }

  // 2. Busca no Cinemeta ou Fallback Kitsu se for ID do IMDb (ttXXXXX)
  if (mainId.startsWith("tt")) {
    try {
      const res = await client.get(`https://v3-cinemeta.strem.fun/meta/series/${mainId}.json`);
      if (res.data && res.data.meta && res.data.meta.name) {
        return res.data.meta.name;
      }
    } catch (e) {
      try {
        const kitsuRes = await client.get(`https://kitsu.io/api/edge/anime?filter[text]=${mainId}`);
        const attr = kitsuRes.data && kitsuRes.data.data && kitsuRes.data.data[0] && kitsuRes.data.data[0].attributes;
        if (attr) {
          return attr.canonicalTitle || attr.titles.en;
        }
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

    let animeUrls = [];
    $search(".result-item article .details .title a").each((_, el) => {
      const foundTitle = $search(el).text().trim().toLowerCase();
      const cleanTitle = title.toLowerCase();

      if (foundTitle.includes(cleanTitle) || cleanTitle.includes(foundTitle)) {
        const href = $search(el).attr("href");
        if (href) animeUrls.push(href);
      }
    });

    if (animeUrls.length === 0) {
      const firstHref = $search(".result-item article .details .title a").first().attr("href");
      if (firstHref) animeUrls.push(firstHref);
    }

    for (const animeUrl of animeUrls.slice(0, 2)) {
      const { data: animeHtml } = await client.get(animeUrl);
      const $anime = cheerio.load(animeHtml);

      let epUrl = "";
      $anime("#episodios li, .episodios li, ul.episodios li").each((_, el) => {
        const epText = $anime(el).text().trim().toLowerCase();
        const link = $anime(el).find("a").attr("href");

        if (epText.includes(`episódio ${episode}`) || epText.includes(`ep ${episode}`) || epText.endsWith(` ${episode}`)) {
          epUrl = link;
        }
      });

      if (epUrl) {
        const { data: epHtml } = await client.get(epUrl);
        const $ep = cheerio.load(epHtml);

        $ep("iframe, video source, embed").each((_, el) => {
          let src = "";
          const attrs = ["src", "data-src", "data-lazy-src"];

          for (const attr of attrs) {
            const val = $ep(el).attr(attr);
            if (val) {
              src = val;
              break;
            }
          }

          if (src && !src.includes("facebook") && !src.includes("disqus")) {
            if (src.startsWith("//")) src = "https:" + src;
            streams.push({
              title: `🌐 AnimesOnline - ${title} (Ep ${episode})`,
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
  const episode = parts.length > 2 ? parts[2] : (parts[1] || "1");

  const title = await getAnimeTitle(id);
  if (!title) return [];

  return await scrapeAnimesOnline(title, episode);
}

const manifest = {
  id: "br.meuanime.addon",
  version: "1.0.3",
  name: "Animes BR",
  description: "Addon de animes PT-BR.",
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