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
  if (n.includes("dual audio") || n.includes("dual-audio") || n.includes("multi-audio")) return "🌐 Dual Audio";
  if (n.includes("eng sub") || n.includes("english")) return "🇺🇸 Eng";
  return "🌐 Multi";
}

function detectQuality(name) {
  const n = name.toLowerCase();
  if (n.includes("2160p") || n.includes("4k")) return "4K";
  if (n.includes("1080p") || n.includes("1080")) return "1080p";
  if (n.includes("720p") || n.includes("720")) return "720p";
  if (n.includes("480p") || n.includes("480")) return "480p";
  return "HD";
}

function isLikelySingleEpisode(name, episode) {
  const n = name.toLowerCase();
  const ep = String(episode);
  const epPad = ep.padStart(2, "0");
  const epPad3 = ep.padStart(3, "0");

  // Batches grandes
  if (
    n.includes("complete") ||
    n.includes("batch") ||
    n.includes("completo") ||
    n.includes("season") ||
    n.includes("s01-") ||
    n.includes("01-") ||
    n.match(/\d{2,3}\s*~\s*\d{2,3}/) ||
    n.match(/\d{2,3}-\d{2,3}/)
  ) {
    return false;
  }

  // Parece episódio único
  if (
    n.includes(` - ${ep} `) ||
    n.includes(` - ${epPad}`) ||
    n.includes(` - ${epPad3}`) ||
    n.includes(`e${epPad}`) ||
    n.includes(`ep${epPad}`) ||
    n.includes(`episode ${ep}`) ||
    n.includes(`episodio ${ep}`) ||
    n.match(new RegExp(`\\b${epPad}\\b`)) ||
    n.match(new RegExp(`\\b${epPad3}\\b`))
  ) {
    return true;
  }

  return false;
}

function scoreResult(name, query, seeders) {
  const n = name.toLowerCase();
  let score = 0;

  // Idioma (máxima prioridade)
  if (n.includes("pt-br") || n.includes("ptbr")) score += 200;
  if (n.includes("legendado")) score += 150;
  if (n.includes("dublado")) score += 160;
  if (n.includes("dual") || n.includes("multi-audio")) score += 80;

  // Episódio individual vs batch
  if (isLikelySingleEpisode(name, query.episode)) {
    score += 120;
  } else {
    score -= 40; // penaliza batches
  }

  // Qualidade
  if (n.includes("1080p") || n.includes("1080")) score += 30;
  if (n.includes("720p")) score += 15;
  if (n.includes("2160p") || n.includes("4k")) score += 25;
  if (n.includes("bd") || n.includes("bluray") || n.includes("blu-ray")) score += 20;

  // Seeders (ajuda, mas não domina)
  score += Math.min(seeders, 100) * 0.3;

  return score;
}

function buildStreamName(name, seeders) {
  const quality = detectQuality(name);
  const lang = detectLanguage(name);
  return `${quality} | ${lang} | 🌱 ${seeders}`;
}

function buildStreamTitle(name) {
  // Limpa um pouco o nome para ficar legível
  let clean = name
    .replace(/\[.*?\]/g, (match) => match) // mantém os grupos
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length > 95) {
    clean = clean.slice(0, 92) + "...";
  }
  return clean;
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
  const epPad = String(ep).padStart(2, "0");

  const searches = [
    `${title} ${epPad}`,
    `${title} ${ep}`,
    `${title}`,
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
      unique.push(item);
    }
  }

  // Pontua e ordena
  const scored = unique.map((item) => {
    const score = scoreResult(item.rawName, query, item.seeders);
    return { ...item, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Monta o formato final limpo
  const final = scored.slice(0, 25).map((item) => {
    return {
      name: buildStreamName(item.rawName, item.seeders),
      title: `${buildStreamTitle(item.rawName)} | ${item.size}`,
      infoHash: item.infoHash,
      url: item.url,
      behaviorHints: {
        bingeGroup: `nyaa-${cleanTitle(query.title)}`
      }
    };
  });

  log("search_complete", {
    total: all.length,
    unique: unique.length,
    returned: final.length
  });

  return final;
}

module.exports = {
  searchAllProviders
};