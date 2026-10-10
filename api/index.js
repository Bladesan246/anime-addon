const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const { addonBuilder } = require("stremio-addon-sdk");

const app = express();
const PORT = process.env.PORT || 3000;

const http = axios.create({
  timeout: 4500,
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

async function getMetadataTitles(parsed, type) {
  const titles = new Set();

  if (parsed.source === "kitsu") {
    try {
      const res = await http.get(`https://kitsu.io/api/edge/anime/${encodeURIComponent(parsed.animeId)}`);
      const attr = res.data?.data?.attributes;
      if (attr) {
        if (attr.canonicalTitle) titles.add(attr.canonicalTitle);
        if (attr.titles?.en_jp) titles.add(attr.titles.en_jp);
        if (attr.titles?.en) titles.add(attr.titles.en);
      }
    } catch (e) {}
  }

  const metaType = type === "movie" ? "movie" : "series";
  try {
    const res = await http.get(`https://v3-cinemeta.strem.fun/meta/${metaType}/${encodeURIComponent(parsed.animeId)}.json`);
    const meta = res.data?.meta;
    if (meta?.name) titles.add(meta.name);
  } catch (e) {}

  try {
    const kitsuRes = await http.get(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(parsed.animeId)}`);
    const attr = kitsuRes.data?.data?.[0]?.attributes;
    if (attr) {
      if (attr.canonicalTitle) titles.add(attr.canonicalTitle);
      if (attr.titles?.en_jp) titles.add(attr.titles.en_jp);
    }
  } catch (e) {}

  const finalQueries = new Set();
  titles.forEach((t) => {
    if (t) {
      finalQueries.add(t);
      finalQueries.add(sanitizeTitle(t));
    }
  });

  return Array.from(finalQueries);
}

function extractStreamUrl($elem) {
  const attrs = ["src", "data-src", "data-lazy-src", "value"];
  for (const attr of attrs) {
    const val = $elem.attr(attr);
    if (val && (val.includes("http") || val.includes("//"))) {
      return val.startsWith("//") ? "https:" + val : val;
    }
  }
  return null;
}

// 1. AnimesOnlineCC
async function scrapeAnimesOnlineCC(title, episode) {
  const streams = [];
  try {
    const clean = sanitizeTitle(title);
    const searchRes = await http.get(`https://animesonlinecc.to/?s=${encodeURIComponent(clean)}`);
    const $search = cheerio.load(searchRes.data || "");

    let animeUrl = "";
    $search(".result-item article .details .title a, article a").each((_, el) => {
      const href = $search(el).attr("href");
      if (href && href.includes("animesonline") && !animeUrl) animeUrl = href;
    });

    if (!animeUrl) return [];

    const { data: animeHtml } = await http.get(animeUrl);
    const $anime = cheerio.load(animeHtml);

    let epUrl = "";
    $anime("#episodios li, .episodios li").each((_, el) => {
      const text = $anime(el).text().trim().toLowerCase();
      const link = $anime(el).find("a").attr("href");
      if (text.includes(`episodio ${episode}`) || text.includes(`ep ${episode}`) || text.endsWith(` ${episode}`)) {
        if (link) epUrl = link;
      }
    });

    if (!epUrl) epUrl = `${animeUrl.replace(/\/$/, "")}-episodio-${episode}/`;

    const { data: epHtml } = await http.get(epUrl);
    const $ep = cheerio.load(epHtml);

    $ep("iframe, video source, option, embed").each((_, el) => {
      const src = extractStreamUrl($ep(el));
      if (src && !src.includes("facebook") && !src.includes("disqus") && !src.includes("twitter")) {
        streams.push({ name: "Animes BR", title: `🌐 AnimesOnlineCC — Ep ${episode}`, url: src });
      }
    });
  } catch (e) {}
  return streams;
}

// 2. AnimesDigital
async function scrapeAnimesDigital(title, episode) {
  const streams = [];
  try {
    const clean = sanitizeTitle(title);
    const searchRes = await http.get(`https://animesdigital.org/?s=${encodeURIComponent(clean)}`);
    const $search = cheerio.load(searchRes.data || "");

    let animeUrl = "";
    $search(".item article .data .title a, .items article a").each((_, el) => {
      const href = $search(el).attr("href");
      if (href && !animeUrl) animeUrl = href;
    });

    if (!animeUrl) return [];

    const { data: animeHtml } = await http.get(animeUrl);
    const $anime = cheerio.load(animeHtml);

    let epUrl = "";
    $anime(".episodios li, #episodios li").each((_, el) => {
      const text = $anime(el).text().toLowerCase();
      const link = $anime(el).find("a").attr("href");
      if (text.includes(`episodio ${episode}`) || text.includes(`ep ${episode}`)) {
        if (link) epUrl = link;
      }
    });

    if (!epUrl) epUrl = animeUrl;

    const { data: epHtml } = await http.get(epUrl);
    const $ep = cheerio.load(epHtml);

    $ep("iframe, video source, option").each((_, el) => {
      const src = extractStreamUrl($ep(el));
      if (src && !src.includes("disqus")) {
        streams.push({ name: "Animes BR", title: `🌐 AnimesDigital — Ep ${episode}`, url: src });
      }
    });
  } catch (e) {}
  return streams;
}

// 3. Goyabu
async function scrapeGoyabu(title, episode) {
  const streams = [];
  try {
    const clean = sanitizeTitle(title);
    const searchRes = await http.get(`https://goyabu.org/?s=${encodeURIComponent(clean)}`);
    const $search = cheerio.load(searchRes.data || "");

    let animeUrl = "";
    $search(".post-title a, article a").each((_, el) => {
      const href = $search(el).attr("href");
      if (href && !animeUrl) animeUrl = href;
    });

    if (!animeUrl) return [];

    const { data: animeHtml } = await http.get(animeUrl);
    const $anime = cheerio.load(animeHtml);

    let epUrl = "";
    $anime(".eps-single a, .episode-list a").each((_, el) => {
      const text = $anime(el).text().toLowerCase();
      const link = $anime(el).attr("href");
      if (text.includes(`episodio ${episode}`) || text.includes(`ep ${episode}`) || text.endsWith(`${episode}`)) {
        if (link) epUrl = link;
      }
    });

    if (!epUrl) epUrl = animeUrl;

    const { data: epHtml } = await http.get(epUrl);
    const $ep = cheerio.load(epHtml);

    $ep("iframe, video source").each((_, el) => {
      const src = extractStreamUrl($ep(el));
      if (src) streams.push({ name: "Animes BR", title: `🌐 Goyabu — Ep ${episode}`, url: src });
    });
  } catch (e) {}
  return streams;
}

// 4. AnimesOrion
async function scrapeAnimesOrion(title, episode) {
  const streams = [];
  try {
    const clean = sanitizeTitle(title);
    const searchRes = await http.get(`https://animesorion.vip/?s=${encodeURIComponent(clean)}`);
    const $search = cheerio.load(searchRes.data || "");

    let animeUrl = "";
    $search(".post-title a, article a, .video-item a").each((_, el) => {
      const href = $search(el).attr("href");
      if (href && !animeUrl) animeUrl = href;
    });

    if (!animeUrl) return [];

    const { data: animeHtml } = await http.get(animeUrl);
    const $anime = cheerio.load(animeHtml);

    let epUrl = "";
    $anime(".episodios li, .single-eps a").each((_, el) => {
      const text = $anime(el).text().toLowerCase();
      const link = $anime(el).find("a").attr("href") \vert{}\vert{} $anime(el).attr("href");
      if (text.includes(`episodio ${episode}`) || text.includes(`ep ${episode}`)) {
        if (link) epUrl = link;
      }
    });

    if (!epUrl) epUrl = animeUrl;

    const { data: epHtml } = await http.get(epHtml);
    const $ep = cheerio.load(epHtml);

    $ep("iframe, video source").each((_, el) => {
      const src = extractStreamUrl($ep(el));
      if (src) streams.push({ name: "Animes BR", title: `🌐 AnimesOrion — Ep ${episode}`, url: src });
    });
  } catch (e) {}
  return streams;
}

async function searchAllProviders(titles, episode) {
  if (!titles || titles.length === 0) return [];

  const tasks = [];
  for (const title of titles.slice(0, 2)) {
    tasks.push(scrapeAnimesOnlineCC(title, episode));
    tasks.push(scrapeAnimesDigital(title, episode));
    tasks.push(scrapeGoyabu(title, episode));
    tasks.push(scrapeAnimesOrion(title, episode));
  }

  const results = await Promise.allSettled(tasks);

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
  version: "1.3.8",
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
  const titles = await getMetadataTitles(parsed, type);

  let streams = [];
  if (titles.length > 0) {
    streams = await searchAllProviders(titles, parsed.episode);
  }

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