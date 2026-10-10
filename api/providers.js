const axios = require("axios");
const cheerio = require("cheerio");

const http = axios.create({
  timeout: 5000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
  }
});

function log(stage, details = {}) {
  console.log(
    JSON.stringify({
      time: new Date().toISOString(),
      stage,
      ...details
    })
  );
}

function cleanTitle(str) {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractUrl($elem) {
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
async function scrapeAnimesOnlineCC(query) {
  const streams = [];
  try {
    const title = cleanTitle(query.title);
    const searchUrl = `https://animesonlinecc.to/?s=${encodeURIComponent(title)}`;
    const { data } = await http.get(searchUrl);
    const $ = cheerio.load(data);

    let animeUrl = "";
    $(".result-item article .details .title a, article a").each((_, el) => {
      const href = $(el).attr("href");
      if (href && href.includes("animesonline") && !animeUrl) animeUrl = href;
    });

    if (!animeUrl) return [];

    const { data: animeHtml } = await http.get(animeUrl);
    const $anime = cheerio.load(animeHtml);

    let epUrl = "";
    $anime("#episodios li, .episodios li").each((_, el) => {
      const text = $anime(el).text().trim().toLowerCase();
      const link = $anime(el).find("a").attr("href");
      if (
        text.includes(`episodio ${query.episode}`) ||
        text.includes(`ep ${query.episode}`) ||
        text.endsWith(` ${query.episode}`)
      ) {
        if (link) epUrl = link;
      }
    });

    if (!epUrl) epUrl = `${animeUrl.replace(/\/$/, "")}-episodio-${query.episode}/`;

    const { data: epHtml } = await http.get(epUrl);
    const $ep = cheerio.load(epHtml);

    $ep("iframe, video source, option").each((_, el) => {
      const src = extractUrl($ep(el));
      if (src && !src.includes("facebook") && !src.includes("disqus")) {
        streams.push({
          name: "AnimesOnlineCC",
          title: `AnimesOnlineCC — Ep ${query.episode}`,
          url: src
        });
      }
    });
  } catch (e) {
    log("provider_error", { provider: "AnimesOnlineCC", error: e.message });
  }
  return streams;
}

// 2. AnimesDigital
async function scrapeAnimesDigital(query) {
  const streams = [];
  try {
    const title = cleanTitle(query.title);
    const searchUrl = `https://animesdigital.org/?s=${encodeURIComponent(title)}`;
    const { data } = await http.get(searchUrl);
    const $ = cheerio.load(data);

    let animeUrl = "";
    $(".item article .data .title a, .items article a").each((_, el) => {
      const href = $(el).attr("href");
      if (href && !animeUrl) animeUrl = href;
    });

    if (!animeUrl) return [];

    const { data: animeHtml } = await http.get(animeUrl);
    const $anime = cheerio.load(animeHtml);

    let epUrl = "";
    $anime(".episodios li, #episodios li").each((_, el) => {
      const text = $anime(el).text().toLowerCase();
      const link = $anime(el).find("a").attr("href");
      if (
        text.includes(`episodio ${query.episode}`) ||
        text.includes(`ep ${query.episode}`)
      ) {
        if (link) epUrl = link;
      }
    });

    if (!epUrl) epUrl = animeUrl;

    const { data: epHtml } = await http.get(epUrl);
    const $ep = cheerio.load(epHtml);

    $ep("iframe, video source, option").each((_, el) => {
      const src = extractUrl($ep(el));
      if (src && !src.includes("disqus")) {
        streams.push({
          name: "AnimesDigital",
          title: `AnimesDigital — Ep ${query.episode}`,
          url: src
        });
      }
    });
  } catch (e) {
    log("provider_error", { provider: "AnimesDigital", error: e.message });
  }
  return streams;
}

// 3. Goyabu
async function scrapeGoyabu(query) {
  const streams = [];
  try {
    const title = cleanTitle(query.title);
    const searchUrl = `https://goyabu.org/?s=${encodeURIComponent(title)}`;
    const { data } = await http.get(searchUrl);
    const $ = cheerio.load(data);

    let animeUrl = "";
    $(".post-title a, article a").each((_, el) => {
      const href = $(el).attr("href");
      if (href && !animeUrl) animeUrl = href;
    });

    if (!animeUrl) return [];

    const { data: animeHtml } = await http.get(animeUrl);
    const $anime = cheerio.load(animeHtml);

    let epUrl = "";
    $anime(".eps-single a, .episode-list a").each((_, el) => {
      const text = $anime(el).text().toLowerCase();
      const link = $anime(el).attr("href");
      if (
        text.includes(`episodio ${query.episode}`) ||
        text.includes(`ep ${query.episode}`) ||
        text.endsWith(`${query.episode}`)
      ) {
        if (link) epUrl = link;
      }
    });

    if (!epUrl) epUrl = animeUrl;

    const { data: epHtml } = await http.get(epUrl);
    const $ep = cheerio.load(epHtml);

    $ep("iframe, video source").each((_, el) => {
      const src = extractUrl($ep(el));
      if (src) {
        streams.push({
          name: "Goyabu",
          title: `Goyabu — Ep ${query.episode}`,
          url: src
        });
      }
    });
  } catch (e) {
    log("provider_error", { provider: "Goyabu", error: e.message });
  }
  return streams;
}

// 4. AnimesOrion
async function scrapeAnimesOrion(query) {
  const streams = [];
  try {
    const title = cleanTitle(query.title);
    const searchUrl = `https://animesorion.vip/?s=${encodeURIComponent(title)}`;
    const { data } = await http.get(searchUrl);
    const $ = cheerio.load(data);

    let animeUrl = "";
    $(".post-title a, article a, .video-item a").each((_, el) => {
      const href = $(el).attr("href");
      if (href && !animeUrl) animeUrl = href;
    });

    if (!animeUrl) return [];

    const { data: animeHtml } = await http.get(animeUrl);
    const $anime = cheerio.load(animeHtml);

    let epUrl = "";
    $anime(".episodios li, .single-eps a").each((_, el) => {
      const text = $anime(el).text().toLowerCase();
      // CORRIGIDO: || em vez de \vert{}\vert{}
      const link =
        $anime(el).find("a").attr("href") || $anime(el).attr("href");
      if (
        text.includes(`episodio ${query.episode}`) ||
        text.includes(`ep ${query.episode}`)
      ) {
        if (link) epUrl = link;
      }
    });

    if (!epUrl) epUrl = animeUrl;

    const { data: epHtml } = await http.get(epUrl);
    const $ep = cheerio.load(epHtml);

    $ep("iframe, video source").each((_, el) => {
      const src = extractUrl($ep(el));
      if (src) {
        streams.push({
          name: "AnimesOrion",
          title: `AnimesOrion — Ep ${query.episode}`,
          url: src
        });
      }
    });
  } catch (e) {
    log("provider_error", { provider: "AnimesOrion", error: e.message });
  }
  return streams;
}

async function searchAllProviders(query) {
  log("search_all_start", { query });

  const results = await Promise.allSettled([
    scrapeAnimesOnlineCC(query),
    scrapeAnimesDigital(query),
    scrapeGoyabu(query),
    scrapeAnimesOrion(query)
  ]);

  const streams = results.flatMap((r) =>
    r.status === "fulfilled" ? r.value : []
  );

  const unique = [];
  const seen = new Set();

  for (const item of streams) {
    if (item.url && !seen.has(item.url)) {
      seen.add(item.url);
      unique.push(item);
    }
  }

  log("search_all_complete", { streamsFound: unique.length });
  return unique;
}

module.exports = {
  searchAllProviders
};