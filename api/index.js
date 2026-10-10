const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const client = axios.create({
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
  },
  timeout: 7000
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

  if (FALLBACK_MAP[mainId]) {
    return FALLBACK_MAP[mainId];
  }

  if (id.startsWith("kitsu")) {
    try {
      const kitsuId = parts[1];
      const res = await client.get(`https://kitsu.io/api/edge/anime/${kitsuId}`);
      const attr = res.data && res.data.data && res.data.data.attributes;
      if (attr) {
        return attr.canonicalTitle || attr.titles.en || attr.titles.en_jp;
      }
    } catch (e) {}
  }

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

    let animeUrl = "";
    $search(".result-item article .details .title a").each((_, el) => {
      const foundTitle = $search(el).text().trim().toLowerCase();
      const targetTitle = title.toLowerCase();

      if (foundTitle.includes(targetTitle) || targetTitle.includes(foundTitle)) {
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
      const link = $anime(el).find("a").attr("href");

      if (epText.includes(`Episódio ${episode}`) || epText.endsWith(` ${episode}`)) {
        epUrl = link;
      }
    });

    if (epUrl) {
      const { data: epHtml } = await client.get(epUrl);
      const $ep = cheerio.load(epHtml);

      $ep("iframe").each((_, el) => {
        let src = $ep(el).attr("src") \vert{}\vert{} $ep(el).attr("data-src");
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
  let allStreams = [];
  const parts = id.split(":");
  const episode = parts.length > 2 ? parts[2] : (parts[1] || "1");

  const title = await getAnimeTitle(id);
  if (!title) return [];

  const results = await Promise.allSettled([
    scrapeAnimesOnline(title, episode)
  ]);

  results.forEach((res) => {
    if (res.status === "fulfilled" && Array.isArray(res.value)) {
      allStreams = allStreams.concat(res.value);
    }
  });

  return allStreams;
}

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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  const rawUrl = req.url.split("?")[0].toLowerCase();

  if (rawUrl === "/" || rawUrl === "/manifest.json" || rawUrl.endsWith("/manifest.json")) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify(addonInterface.manifest));
  }

  if (rawUrl.includes("/stream/")) {
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