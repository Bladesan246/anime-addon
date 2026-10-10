const axios = require("axios");
const cheerio = require("cheerio");

const http = axios.create({
  timeout: 6000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
  }
});

function log(provider, status, details = {}) {
  console.log(
    JSON.stringify({
      time: new Date().toISOString(),
      provider,
      status,
      ...details
    })
  );
}

// Helper para sanitizar termos de busca
function cleanTitle(str) {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Helper para extrair atributos de video de elementos Cheerio
function extractStreamUrl($elem) {
  const attrs = ["src", "data-src", "data-lazy-src", "value"];
  for (const attr of attrs) {
    const val = $elem.attr(attr);
    if (val && (val.includes("http") || val.includes("//"))) {
      if (val.startsWith("//")) return "https:" + val;
      return val;
    }
  }
  return null;
}

// 1. Provider: AnimesOnlineCC
async function scrapeAnimesOnlineCC(query) {
  const streams = [];
  try {
    const title = cleanTitle(query.title);
    const searchUrl = `https://animesonlinecc.to/?s=${encodeURIComponent(title)}`;
    const { data: searchHtml } = await http.get(searchUrl);
    const $search = cheerio.load(searchHtml);

    let animeUrl = "";
    $search(".result-item article .details .title a, article a").each((_, el) => {
      const href = $search(el).attr("href");
      if (href && href.includes("animesonline") && !animeUrl) {
        animeUrl = href;
      }
    });

    if (!animeUrl) return [];

    const { data: animeHtml } = await http.get(animeUrl);
    const $anime = cheerio.load(animeHtml);

    let epUrl = "";
    $anime("#episodios li, .episodios li, ul.episodios li").each((_, el) => {
      const epText = $anime(el).text().trim().toLowerCase();
      const link = $anime(el).find("a").attr("href");

      if (
        epText.includes(`episodio ${query.episode}`) ||
        epText.includes(`episódio ${query.episode}`) ||
        epText.includes(`ep ${query.episode}`) ||
        epText.endsWith(` ${query.episode}`)
      ) {
        if (link) epUrl = link;
      }
    });

    if (!epUrl) epUrl = `${animeUrl.replace(/\/$/, "")}-episodio-${query.episode}/`;

    const { data: epHtml } = await http.get(epUrl);
    const $ep = cheerio.load(epHtml);

    $ep("iframe, video source, embed, option").each((_, el) => {
      const src = extractStreamUrl($ep(el));
      if (src && !src.includes("facebook") && !src.includes("disqus")) {
        streams.push({
          name: "AnimesOnlineCC",
          title: `AnimesOnlineCC — Ep ${query.episode}`,
          url: src
        });
      }
    });
  } catch (error) {
    log("AnimesOnlineCC", "error", { message: error.message });
  }
  return streams;
}

// 2. Provider: AnimesDigital
async function scrapeAnimesDigital(query) {
  const streams = [];
  try {
    const title = cleanTitle(query.title);
    const searchUrl = `https://animesdigital.org/?s=${encodeURIComponent(title)}`;
    const { data: searchHtml } = await http.get(searchUrl);
    const $search = cheerio.load(searchHtml);

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
      if (text.includes(`episodio ${query.episode}`) || text.includes(`ep ${query.episode}`)) {
        if (link) epUrl = link;
      }
    });

    if (!epUrl) epUrl = animeUrl;

    const { data: epHtml } = await http.get(epUrl);
    const $ep = cheerio.load(epHtml);

    $ep("iframe, video source, option").each((_, el) => {
      const src = extractStreamUrl($ep(el));
      if (src && !src.includes("disqus")) {
        streams.push({
          name: "AnimesDigital",
          title: `AnimesDigital — Ep ${query.episode}`,
          url: src
        });
      }
    });
  } catch (error) {
    log("AnimesDigital", "error", { message: error.message });
  }
  return streams;
}

// 3. Provider: Goyabu
async function scrapeGoyabu(query) {
  const streams = [];
  try {
    const title = cleanTitle(query.title);
    const searchUrl = `https://goyabu.org/?s=${encodeURIComponent(title)}`;
    const { data: searchHtml } = await http.get(searchUrl);
    const $search = cheerio.load(searchHtml);

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
      if (text.includes(`episodio ${query.episode}`) || text.includes(`ep ${query.episode}`) || text.endsWith(`${query.episode}`)) {
        if (link) epUrl = link;
      }
    });

    if (!epUrl) epUrl = animeUrl;

    const { data: epHtml } = await http.get(epUrl);
    const $ep = cheerio.load(epHtml);

    $ep("iframe, video source").each((_, el) => {
      const src = extractStreamUrl($ep(el));
      if (src) {
        streams.push({
          name: "Goyabu",
          title: `Goyabu — Ep ${query.episode}`,
          url: src
        });
      }
    });
  } catch (error) {
    log("Goyabu", "error", { message: error.message });
  }
  return streams;
}

// 4. Provider: AnimesOrion
async function scrapeAnimesOrion(query) {
  const streams = [];
  try {
    const title = cleanTitle(query.title);
    const searchUrl = `https://animesorion.vip/?s=${encodeURIComponent(title)}`;
    const { data: searchHtml } = await http.get(searchUrl);
    const $search = cheerio.load(searchHtml);

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
      if (text.includes(`episodio ${query.episode}`) || text.includes(`ep ${query.episode}`)) {
        if (link) epUrl = link;
      }
    });

    if (!epUrl) epUrl = animeUrl;

    const { data: epHtml } = await http.get(epUrl);
    const $ep = cheerio.load(epHtml);

    $ep("iframe, video source").each((_, el) => {
      const src = extractStreamUrl($ep(el));
      if (src) {
        streams.push({
          name: "AnimesOrion",
          title: `AnimesOrion — Ep ${query.episode}`,
          url: src
        });
      }
    });
  } catch (error) {
    log("AnimesOrion", "error", { message: error.message });
  }
  return streams;
}

const PROVIDERS = [
  { name: "AnimesOnlineCC", scraper: scrapeAnimesOnlineCC },
  { name: "AnimesDigital", scraper: scrapeAnimesDigital },
  { name: "Goyabu", scraper: scrapeGoyabu },
  { name: "AnimesOrion", scraper: scrapeAnimesOrion }
];

async function searchAllProviders(query) {
  log("search_all", "starting", { query });

  // Executa os 4 scrapers simultaneamente em paralelo
  const results = await Promise.allSettled(
    PROVIDERS.map(p => p.scraper(query))
  );

  const streams = results.flatMap(result =>
    result.status === "fulfilled" ? result.value : []
  );

  // Remove links duplicados
  const unique = [];
  const seen = new Set();

  for (const stream of streams) {
    if (stream.url && !seen.has(stream.url)) {
      seen.add(stream.url);
      unique.push(stream);
    }
  }

  log("search_all", "complete", { streamsFound: unique.length });
  return unique;
}

module.exports = {
  PROVIDERS,
  searchAllProviders
};