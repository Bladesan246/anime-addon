const axios = require("axios");
const cheerio = require("cheerio");

const http = axios.create({
  timeout: 12000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"
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

function scoreResult(name, query) {
  const n = name.toLowerCase();
  let score = 0;

  // Prioridade máxima para português
  if (n.includes("pt-br") || n.includes("ptbr") || n.includes("portuguese")) score += 100;
  if (n.includes("legendado") || n.includes("legenda")) score += 80;
  if (n.includes("dublado") || n.includes("dual") || n.includes("multi-audio") || n.includes("multi audio")) score += 70;
  if (n.includes("brazilian") || n.includes("brasil")) score += 60;

  // Qualidade
  if (n.includes("1080p") || n.includes("1080")) score += 30;
  if (n.includes("720p") || n.includes("720")) score += 15;
  if (n.includes("2160p") || n.includes("4k")) score += 25;
  if (n.includes("bluray") || n.includes("bdrip") || n.includes("bd ")) score += 20;
  if (n.includes("web-dl") || n.includes("webdl") || n.includes("webrip")) score += 10;

  // Episódio
  const ep = String(query.episode).padStart(2, "0");
  if (
    n.includes(` - ${query.episode}`) ||
    n.includes(` - ${ep}`) ||
    n.includes(`e${ep}`) ||
    n.includes(`ep${ep}`) ||
    n.includes(`episode ${query.episode}`) ||
    n.includes(`episodio ${query.episode}`)
  ) {
    score += 40;
  }

  // Penaliza batches grandes demais se estamos buscando episódio específico
  if (n.includes("batch") || n.includes("complete") || n.includes("completo")) {
    score -= 15;
  }

  return score;
}

async function searchNyaa(query, extraTerms = "") {
  const streams = [];
  try {
    const title = cleanTitle(query.title);
    const searchQuery = `${title} ${extraTerms}`.trim();
    const url = `https://nyaa.si/?f=0&c=1_0&q=${encodeURIComponent(searchQuery)}&s=seeders&o=desc`;

    const { data } = await http.get(url);
    const $ = cheerio.load(data);

    $("table.torrent-list tbody tr").each((_, el) => {
      const $el = $(el);
      const nameLink = $el.find("td:nth-child(2) a:not(.comments)").first();
      const name = nameLink.text().trim();
      const magnet = $el.find('a[href^="magnet:"]').attr("href");
      const size = $el.find("td:nth-child(4)").text().trim();
      const seeders = parseInt($el.find("td:nth-child(6)").text().trim()) || 0;

      if (!name || !magnet || seeders < 1) return;

      const score = scoreResult(name, query);

      streams.push({
        name: name.length > 90 ? name.slice(0, 87) + "..." : name,
        title: `${name} | ${size} | 🌱 ${seeders}`,
        infoHash: magnet.match(/btih:([a-fA-F0-9]{40})/)?.[1] || null,
        url: magnet,
        behaviorHints: {
          bingeGroup: `nyaa-${query.title}`
        },
        _score: score,
        _seeders: seeders
      });
    });
  } catch (e) {
    log("nyaa_error", { error: e.message, extra: extraTerms });
  }
  return streams;
}

async function searchAllProviders(query) {
  log("search_all_start", { query });

  // Buscas em paralelo: normal + priorizando português
  const [normal, ptbr, legendado, dublado] = await Promise.all([
    searchNyaa(query),
    searchNyaa(query, "PT-BR"),
    searchNyaa(query, "Legendado"),
    searchNyaa(query, "Dublado")
  ]);

  const all = [...normal, ...ptbr, ...legendado, ...dublado];

  // Remove duplicados pelo infoHash
  const seen = new Set();
  const unique = [];

  for (const item of all) {
    const key = item.infoHash || item.url;
    if (key && !seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  // Ordena por score (português primeiro) e depois por seeders
  unique.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    return b._seeders - a._seeders;
  });

  // Limita a 25 resultados para não poluir o Stremio
  const final = unique.slice(0, 25).map(({ _score, _seeders, ...rest }) => rest);

  log("search_all_complete", { streamsFound: final.length });
  return final;
}

module.exports = {
  searchAllProviders
};