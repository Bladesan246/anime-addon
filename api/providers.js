const axios = require("axios");
const cheerio = require("cheerio");

const http = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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

function detectLanguage(name) {
  const n = name.toLowerCase();
  if (n.includes("pt-br") || n.includes("ptbr") || n.includes("brazilian")) {
    if (n.includes("dublado") || n.includes("dual") || n.includes("multi-audio") || n.includes("multi audio")) {
      return "🇧🇷 Dublado";
    }
    return "🇧🇷 Legendado";
  }
  if (n.includes("legendado")) return "🇧🇷 Legendado";
  if (n.includes("dublado")) return "🇧🇷 Dublado";
  if (n.includes("dual audio") || n.includes("dual-audio") || n.includes("multi-audio")) return "🌐 Dual";
  return null;
}

function detectQuality(name) {
  const n = name.toLowerCase();
  if (n.includes("2160p") || n.includes("4k")) return "4K";
  if (n.includes("1080p") || n.includes("1080")) return "1080p";
  if (n.includes("720p") || n.includes("720")) return "720p";
  if (n.includes("480p")) return "480p";
  return "HD";
}

function matchesEpisode(name, episode) {
  const n = name.toLowerCase();
  const ep = String(episode);
  const ep2 = ep.padStart(2, "0");
  const ep3 = ep.padStart(3, "0");

  // Padrões comuns de episódio
  const patterns = [
    new RegExp(`\\b${ep2}\\b`),
    new RegExp(`\\b${ep3}\\b`),
    new RegExp(`\\be${ep2}\\b`),
    new RegExp(`\\bep\\.?\\s*${ep2}\\b`),
    new RegExp(`\\bepisode\\s*${ep}\\b`),
    new RegExp(`\\bepisodio\\s*${ep}\\b`),
    new RegExp(`\\bepisódio\\s*${ep}\\b`),
    new RegExp(`-\\s*${ep2}\\b`),
    new RegExp(`-\\s*${ep3}\\b`),
    new RegExp(`\\s${ep2}\\s`),
    new RegExp(`\\s${ep3}\\s`)
  ];

  return patterns.some((p) => p.test(n));
}

function isBatchOrMovie(name) {
  const n = name.toLowerCase();
  return (
    n.includes("complete") ||
    n.includes("batch") ||
    n.includes("completo") ||
    n.includes("season") ||
    n.includes("s01-") ||
    n.includes("s1-") ||
    n.includes("movie") ||
    n.includes("filme") ||
    n.includes("ova") ||
    n.includes("special") ||
    n.includes("especial") ||
    n.match(/\d{2,3}\s*[~\-–]\s*\d{2,3}/) || // 01-12, 001~050 etc
    n.match(/\d{2,3}\s+a\s+\d{2,3}/)
  );
}

function scoreResult(name, query, seeders) {
  let score = 0;
  const n = name.toLowerCase();

  // Episódio correto (obrigatório quase)
  if (matchesEpisode(name, query.episode)) {
    score += 300;
  } else {
    score -= 200;
  }

  // Penaliza forte batches e filmes
  if (isBatchOrMovie(name)) {
    score -= 150;
  }

  // Idioma
  if (n.includes("pt-br") || n.includes("ptbr")) score += 180;
  if (n.includes("legendado")) score += 140;
  if (n.includes("dublado")) score += 150;
  if (n.includes("dual") || n.includes("multi-audio")) score += 60;

  // Qualidade
  if (n.includes("1080p") || n.includes("1080")) score += 25;
  if (n.includes("720p")) score += 12;
  if (n.includes("2160p") || n.includes("4k")) score += 20;
  if (n.includes("bd") || n.includes("bluray")) score += 15;

  score += Math.min(seeders, 80) * 0.25;

  return score;
}

function buildDisplayName(name, seeders) {
  const quality = detectQuality(name);
  const lang = detectLanguage(name);
  const parts = [quality];
  if (lang) parts.push(lang);
  parts.push(`🌱 ${seeders}`);
  return parts.join(" | ");
}

function buildCleanTitle(name, episode) {
  // Tenta extrair um nome mais limpo
  let clean = name
    .replace(/\[.*?\]/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Se ficar muito genérico, usa o original resumido
  if (clean.length < 10) {
    clean = name.replace(/\s+/g, " ").trim();
  }

  if (clean.length > 70) {
    clean = clean.slice(0, 67) + "...";
  }

  return `Ep ${String(episode).padStart(2, "0")} · ${clean}`;
}

async function searchNyaa(searchQuery) {
  const streams = [];
  try {
    const url = `https://nyaa.si/?f=0&c=1_0&q=${encodeURIComponent(searchQuery)}&s=seeders&o=desc`;
    log("nyaa_request", { q: searchQuery });

    const { data } = await http.get(url);
    const $ = cheerio.load(data);

    $("table.torrent-list tbody tr").each((_, el) => {
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
        rawName: name,
        size,
        seeders,
        infoHash,
        url: magnet
      });
    });
  } catch (e) {
    log("nyaa_error", { message: e.message, status: e.response?.status });
  }
  return streams;
}

async function searchAllProviders(query) {
  log("search_start", { title: query.title, episode: query.episode });

  const title = cleanTitle(query.title);
  const ep = query.episode;
  const ep2 = String(ep).padStart(2, "0");
  const ep3 = String(ep).padStart(3, "0");

  // Buscas mais precisas primeiro
  const searches = [
    `${title} ${ep2}`,
    `${title} ${ep3}`,
    `${title} - ${ep2}`,
    `${title} E${ep2}`,
    `${title} Episode ${ep}`,
    `${title} PT-BR ${ep2}`,
    `${title} Legendado ${ep2}`,
    `${title} Dublado ${ep2}`
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
      unique.push(item);
    }
  }

  // Pontua
  const scored = unique.map((item) => ({
    ...item,
    score: scoreResult(item.rawName, query, item.seeders)
  }));

  // Só mantém resultados com score razoável (que parecem ser o episódio certo)
  const filtered = scored.filter((item) => item.score > 100);

  filtered.sort((a, b) => b.score - a.score);

  const final = filtered.slice(0, 20).map((item) => ({
    name: buildDisplayName(item.rawName, item.seeders),
    title: `${buildCleanTitle(item.rawName, query.episode)} | ${item.size}`,
    infoHash: item.infoHash,
    url: item.url,
    behaviorHints: {
      bingeGroup: `nyaa-${cleanTitle(query.title)}-ep${query.episode}`
    }
  }));

  log("search_complete", {
    total: all.length,
    unique: unique.length,
    filtered: filtered.length,
    returned: final.length
  });

  return final;
}

module.exports = {
  searchAllProviders
};