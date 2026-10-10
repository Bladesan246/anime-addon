const axios = require("axios");
const cheerio = require("cheerio");

const http = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8"
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
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreResult(name, query) {
  const n = name.toLowerCase();
  let score = 0;

  // Prioridade português
  if (n.includes("pt-br") || n.includes("ptbr")) score += 120;
  if (n.includes("legendado")) score += 90;
  if (n.includes("dublado") || n.includes("dual audio") || n.includes("dual-audio") || n.includes("multi-audio")) score += 80;
  if (n.includes("brazilian") || n.includes("brasil")) score += 50;

  // Qualidade
  if (n.includes("1080p") || n.includes("1080")) score += 25;
  if (n.includes("720p")) score += 10;
  if (n.includes("2160p") || n.includes("4k")) score += 20;
  if (n.includes("bd") || n.includes("bluray") || n.includes("blu-ray")) score += 15;

  // Episódio (bônus, não obrigatório)
  const ep = String(query.episode);
  const epPad = ep.padStart(2, "0");
  const epPad3 = ep.padStart(3, "0");

  if (
    n.includes(` ${ep} `) ||
    n.includes(` ${epPad} `) ||
    n.includes(` ${epPad3} `) ||
    n.includes(`-${ep}`) ||
    n.includes(`-${epPad}`) ||
    n.includes(`e${epPad}`) ||
    n.includes(`ep${epPad}`) ||
    n.includes(`episode ${ep}`) ||
    n.includes(`episodio ${ep}`)
  ) {
    score += 50;
  }

  return score;
}

async function searchNyaa(searchQuery) {
  const streams = [];
  try {
    const url = `https://nyaa.si/?f=0&c=1_0&q=${encodeURIComponent(searchQuery)}&s=seeders&o=desc`;
    log("nyaa_request", { url: searchQuery });

    const { data, status } = await http.get(url);
    log("nyaa_response", { status, length: data?.length || 0 });

    const $ = cheerio.load(data);
    const rows = $("table.torrent-list tbody tr");

    log("nyaa_rows", { count: rows.length });

    rows.each((_, el) => {
      const $el = $(el);
      const nameLink = $el.find("td:nth-child(2) a:not(.comments)").first();
      const name = nameLink.text().trim();
      const magnet = $el.find('a[href^="magnet:"]').attr("href");
      const size = $el.find("td:nth-child(4)").text().trim();
      const seeders = parseInt($el.find("td:nth-child(6)").text().trim(), 10) || 0;

      if (!name || !magnet || seeders < 1) return;

      const infoHashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/i);
      const infoHash = infoHashMatch ? infoHashMatch[1].toLowerCase() : null;

      streams.push({
        name: name.length > 80 ? name.slice(0, 77) + "..." : name,
        title: `${size} | 🌱 ${seeders}`,
        infoHash,
        url: magnet,
        behaviorHints: {
          bingeGroup: "nyaa-anime"
        },
        _seeders: seeders,
        _name: name
      });
    });
  } catch (e) {
    log("nyaa_error", { 
      message: e.message, 
      code: e.code,
      status: e.response?.status 
    });
  }
  return streams;
}

async function searchAllProviders(query) {
  log("search_start", { title: query.title, episode: query.episode });

  const title = cleanTitle(query.title);
  const ep = query.episode;

  // Várias buscas em paralelo
  const searches = [
    `${title}`,
    `${title} ${ep}`,
    `${title} PT-BR`,
    `${title} Legendado`,
    `${title} Dublado`
  ];

  const results = await Promise.all(searches.map((q) => searchNyaa(q)));

  const all = results.flat();

  // Remove duplicados
  const seen = new Set();
  const unique = [];

  for (const item of all) {
    const key = item.infoHash || item.url;
    if (key && !seen.has(key)) {
      seen.add(key);
      item._score = scoreResult(item._name, query);
      unique.push(item);
    }
  }

  // Ordena: português primeiro, depois seeders
  unique.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    return b._seeders - a._seeders;
  });

  const final = unique.slice(0, 30).map(({ _score, _seeders, _name, ...rest }) => rest);

  log("search_complete", { 
    totalFound: all.length, 
    unique: unique.length, 
    returned: final.length 
  });

  return final;
}

module.exports = {
  searchAllProviders
};