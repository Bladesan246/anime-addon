const express = require("express");
const axios = require("axios");
const { addonBuilder } = require("stremio-addon-sdk");

const app = express();
const PORT = process.env.PORT || 3000;

const http = axios.create({
  timeout: 5000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
  }
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

function parseId(id) {
  if (typeof id !== "string" || !id.trim()) return { error: "ID ausente" };
  const decodedId = decodeURIComponent(id);
  const parts = decodedId.split(":");

  if (/^kitsu$/i.test(parts[0])) {
    if (parts.length === 2) return { source: "kitsu", animeId: parts[1], season: 1, episode: 1 };
    if (parts.length >= 3) {
      const ep = Number(parts[parts.length - 1]) || 1;
      return { source: "kitsu", animeId: parts[1], season: 1, episode: ep };
    }
  }

  if (/^tt\d+$/i.test(parts[0])) {
    if (parts.length === 1) return { source: "imdb", animeId: parts[0], season: 1, episode: 1 };
    if (parts.length >= 3) {
      const season = Number(parts[1]) || 1;
      const episode = Number(parts[2]) || 1;
      return { source: "imdb", animeId: parts[0], season, episode };
    }
  }

  return { source: "unknown", animeId: parts[0], season: 1, episode: 1 };
}

async function getMetadata(parsed, type) {
  if (parsed.source === "kitsu") {
    try {
      const res = await http.get(`https://kitsu.io/api/edge/anime/${encodeURIComponent(parsed.animeId)}`);
      const attr = res.data?.data?.attributes;
      if (attr) return { title: attr.canonicalTitle || attr.titles?.en || attr.titles?.en_jp };
    } catch (e) {}
  }

  const metaType = type === "movie" ? "movie" : "series";
  try {
    const res = await http.get(`https://v3-cinemeta.strem.fun/meta/${metaType}/${encodeURIComponent(parsed.animeId)}.json`);
    const meta = res.data?.meta;
    if (meta?.name) return { title: meta.name };
  } catch (e) {}

  return { title: null };
}

// Scraper 1: AnimesOnlineCC
async function scrapeAnimesOnlineCC(title, episode) {
  const streams = [];
  try {
    const clean = sanitizeTitle(title);
    const searchRes = await http.get(`https://animesonlinecc.to/?s=${encodeURIComponent(clean)}`);
    const html = searchRes.data || "";

    const linkMatch = html.match(/href="(https?:\/\/animesonlinecc\.to\/anime\/[^"]+)"/i);
    const animeUrl = linkMatch ? linkMatch[1] : null;
    if (!animeUrl) return [];

    const epUrl = `${animeUrl.replace(/\/$/, "")}-episodio-${episode}/`;
    const epRes = await http.get(epUrl);
    const epHtml = epRes.data || "";

    const iframeMatches = epHtml.matchAll(/src="(https?:\/\/[^"]+)"/gi);
    for (const match of iframeMatches) {
      const src = match[1];
      if (src && !src.includes("facebook") && !src.includes("disqus")) {
        streams.push({ name: "Animes BR", title: `🌐 AnimesOnlineCC — Ep ${episode}`, url: src });
      }
    }
  } catch (e) {}
  return streams;
}

// Scraper 2: AnimesDigital
async function scrapeAnimesDigital(title, episode) {
  const streams = [];
  try {
    const clean = sanitizeTitle(title);
    const searchRes = await http.get(`https://animesdigital.org/?s=${encodeURIComponent(clean)}`);
    const html = searchRes.data || "";

    const linkMatch = html.match(/href="(https?:\/\/animesdigital\.org\/anime\/[^"]+)"/i);
    const animeUrl = linkMatch ? linkMatch[1] : null;
    if (!animeUrl) return [];

    const epUrl = `${animeUrl.replace(/\/$/, "")}-episodio-${episode}/`;
    const epRes = await http.get(epUrl);
    const epHtml = epRes.data || "";

    const iframeMatches = epHtml.matchAll(/src="(https?:\/\/[^"]+)"/gi);
    for (const match of iframeMatches) {
      const src = match[1];
      if (src && !src.includes("disqus")) {
        streams.push({ name: "Animes BR", title: `🌐 AnimesDigital — Ep ${episode}`, url: src });
      }
    }
  } catch (e) {}
  return streams;
}

// Scraper 3: Goyabu
async function scrapeGoyabu(title, episode) {
  const streams = [];
  try {
    const clean = sanitizeTitle(title);
    const searchRes = await http.get(`https://goyabu.org/?s=${encodeURIComponent(clean)}`);
    const html = searchRes.data || "";

    const linkMatch = html.match(/href="(https?:\/\/goyabu\.org\/[^"]+)"/i);
    const animeUrl = linkMatch ? linkMatch[1] : null;
    if (!animeUrl) return [];

    const epRes = await http.get(animeUrl);
    const epHtml = epRes.data || "";

    const iframeMatches = epHtml.matchAll(/src="(https?:\/\/[^"]+)"/gi);
    for (const match of iframeMatches) {
      const src = match[1];
      if (src) streams.push({ name: "Animes BR", title: `🌐 Goyabu — Ep ${episode}`, url: src });
    }
  } catch (e) {}
  return streams;
}

// Scraper 4: AnimesOrion
async function scrapeAnimesOrion(title, episode) {
  const streams = [];
  try {
    const clean = sanitizeTitle(title);
    const searchRes = await http.get(`https://animesorion.vip/?s=${encodeURIComponent(clean)}`);
    const html = searchRes.data || "";

    const linkMatch = html.match(/href="(https?:\/\/animesorion\.vip\/[^"]+)"/i);
    const animeUrl = linkMatch ? linkMatch[1] : null;
    if (!animeUrl) return [];

    const epRes = await http.get(animeUrl);
    const epHtml = epRes.data || "";

    const iframeMatches = epHtml.matchAll(/src="(https?:\/\/[^"]+)"/gi);
    for (const match of iframeMatches) {
      const src = match[1];
      if (src) streams.push({ name: "Animes BR", title: `🌐 AnimesOrion — Ep ${episode}`, url: src });
    }
  } catch (e) {}
  return streams;
}

async function searchAllProviders(query) {
  if (!query.title) return [];

  const results = await Promise.allSettled([
    scrapeAnimesOnlineCC(query.title, query.episode),
    scrapeAnimesDigital(query.title, query.episode),
    scrapeGoyabu(query.title, query.episode),
    scrapeAnimesOrion(query.title, query.episode)
  ]);

  const streams = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const unique = [];
  const seen = new Set();

  for (const s of streams) {
    if (s.url && !seen.has(s.url)) {
      seen.add(s.url);
      unique.push(s);
    }
  }

  return unique;
}

const manifest = {
  id: "br.meuanime.addon",
  version: "1.3.3",
  name: "Animes BR",
  description: "Addon de animes em Português (PT-BR).",
  resources: ["stream"],
  types: ["anime", "series", "movie"],
  idPrefixes: ["tt", "kitsu"],
  catalogs: []
};

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async ({ type, id }) => {
  const parsed = parseId(id);
  const metadata = await getMetadata(parsed, type);

  let streams = [];
  if (metadata.title) {
    streams = await searchAllProviders({
      title: metadata.title,
      season: parsed.season,
      episode: parsed.episode
    });
  }

  // Se nada for encontrado, retorna mensagem legível no Stremio
  if (!streams || streams.length === 0) {
    streams = [
      {
        name: "Animes BR",
        title: "⚠️ Nenhum stream encontrado para este episódio",
        url: "https://vjs.zencdn.net/v/oceans.mp4"
      }
    ];
  }

  return { streams };
});

const addonInterface = builder.getInterface();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get(["/", "/manifest.json"], (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.json(addonInterface.manifest);
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", version: manifest.version });
});

app.get("/stream/:type/:id.json", async (req, res) => {
  try {
    const { type, id } = req.params;
    const result = await addonInterface.get("stream", type, id.replace(".json", ""));
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.json(result);
  } catch (error) {
    res.status(500).json({ streams: [] });
  }
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
}

module.exports = app;