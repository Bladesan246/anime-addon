const express = require("express");
const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();

const client = axios.create({
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
  },
  timeout: 4500
});

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
  const titles = new Set();

  if (id.startsWith("kitsu")) {
    try {
      const res = await client.get(`https://kitsu.io/api/edge/anime/${parts[1]}`);
      const attr = res.data?.data?.attributes;
      if (attr) {
        if (attr.canonicalTitle) titles.add(attr.canonicalTitle);
        if (attr.titles?.en_jp) titles.add(attr.titles.en_jp);
        if (attr.titles?.en) titles.add(attr.titles.en);
      }
    } catch (e) {}
  } else if (mainId.startsWith("tt")) {
    try {
      const res = await client.get(`https://v3-cinemeta.strem.fun/meta/series/${mainId}.json`);
      if (res.data?.meta?.name) {
        titles.add(res.data.meta.name);
      }
    } catch (e) {}

    try {
      const kitsuRes = await client.get(`https://kitsu.io/api/edge/anime?filter[text]=${mainId}`);
      const attr = kitsuRes.data?.data?.[0]?.attributes;
      if (attr) {
        if (attr.canonicalTitle) titles.add(attr.canonicalTitle);
        if (attr.titles?.en_jp) titles.add(attr.titles.en_jp);
      }
    } catch (err) {}
  }

  const queries = new Set();
  titles.forEach((t) => {
    if (t) {
      queries.add(t);
      queries.add(sanitizeTitle(t));
    }
  });

  return Array.from(queries);
}

async function scrapeAnimesOnlineQuery(query, episode) {
  const streams = [];
  try {
    const searchUrl = `https://animesonlinecc.to/?s=${encodeURIComponent(query)}`;
    const { data: searchHtml } = await client.get(searchUrl);
    const $search = cheerio.load(searchHtml);

    let animeUrls = [];
    $search(".result-item article .details .title a, article a, .items article a").each((_, el) => {
      const href = $search(el).attr("href");
      if (href && href.includes("animesonline") && !animeUrls.includes(href)) {
        animeUrls.push(href);
      }
    });

    for (const animeUrl of animeUrls.slice(0, 2)) {
      const { data: animeHtml } = await client.get(animeUrl);
      const $anime = cheerio.load(animeHtml);

      let epUrl = "";
      $anime("#episodios li, .episodios li, ul.episodios li, .list-episodios li").each((_, el) => {
        const epText = $anime(el).text().trim().toLowerCase();
        const link = $anime(el).find("a").attr("href");

        if (
          epText.includes(`episodio ${episode}`) ||
          epText.includes(`episódio ${episode}`) ||
          epText.includes(`ep ${episode}`) ||
          epText.endsWith(` ${episode}`) ||
          epText.includes(` ${episode} `)
        ) {
          if (link) epUrl = link;
        }
      });

      if (!epUrl) {
        // Fallback: tentar montar URL padrão de episódio se não achar no menu
        epUrl = `${animeUrl.replace(/\/$/, "")}-episodio-${episode}/`;
      }

      try {
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
            !src.includes("twitter") &&
            !src.includes("google")
          ) {
            if (src.startsWith("//")) src = "https:" + src;

            const isDub =
              epHtml.toLowerCase().includes("dublado") ||
              animeUrl.toLowerCase().includes("dublado");
            const label = isDub ? "Dublado" : "Legendado";

            streams.push({
              title: `🌐 AnimesOnline (${label}) - Ep ${episode}`,
              url: src
            });
          }
        });
      } catch (e) {}
    }
  } catch (err) {}
  return streams;
}

async function fetchAnimeStreams(id) {
  const parts = id.split(":");
  const episode = parts.length > 2 ? parts[2] : parts[1] || "1";

  const queries = await getAnimeTitles(id);
  if (queries.length === 0) return [];

  // Busca em paralelo para evitar timeout na Vercel
  const results = await Promise.allSettled(
    queries.slice(0, 3).map((q) => scrapeAnimesOnlineQuery(q, episode))
  );

  let allStreams = [];
  results.forEach((res) => {
    if (res.status === "fulfilled" && Array.isArray(res.value)) {
      allStreams = allStreams.concat(res.value);
    }
  });

  return allStreams;
}

const manifest = {
  id: "br.meuanime.addon",
  version: "1.0.6",
  name: "Animes BR",
  description: "Addon de animes PT-BR para Stremio.",
  resources: ["stream"],
  types: ["anime", "series", "movie"],
  idPrefixes: ["tt", "kitsu"],
  catalogs: []
};

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async ({ type, id }) => {
  let streams = await fetchAnimeStreams(id);

  // Remove URLs duplicadas
  const uniqueStreams = [];
  const seenUrls = new Set();
  if (streams && streams.length > 0) {
    for (const s of streams) {
      if (!seenUrls.has(s.url)) {
        seenUrls.add(s.url);
        uniqueStreams.push(s);
      }
    }
  }

  if (uniqueStreams.length === 0) {
    return {
      streams: [
        {
          title: "⚠️ Nenhum stream encontrado para este episódio",
          url: "https://vjs.zencdn.net/v/oceans.mp4"
        }
      ],
      cacheMaxAge: 0
    };
  }

  return { streams: uniqueStreams, cacheMaxAge: 0 };
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