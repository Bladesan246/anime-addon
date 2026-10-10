
const express = require("express");
const axios = require("axios");
const { addonBuilder } = require("stremio-addon-sdk");
const { PROVIDERS, searchAllProviders } = require("./providers");

const app = express();
const PORT = process.env.PORT || 3000;

const manifest = {
  id: "br.meuanime.addon",
  version: "1.2.0",
  name: "Animes BR",
  description:
    "Addon de animes com pesquisa em provedores configurados.",
  resources: ["stream"],
  types: ["anime", "series", "movie"],
  idPrefixes: ["tt", "kitsu"],
  catalogs: []
};

const builder = new addonBuilder(manifest);

const http = axios.create({
  timeout: 10000,
  headers: { Accept: "application/json" }
});

function log(stage, details = {}) {
  console.log(JSON.stringify({
    time: new Date().toISOString(),
    stage,
    ...details
  }));
}

function parseId(id) {
  if (typeof id !== "string") {
    return { error: "ID ausente" };
  }

  const parts = id.split(":");

  if (/^kitsu$/i.test(parts[0])) {
    if (!/^\d+$/.test(parts[1] || "")) {
      return { error: "ID Kitsu inválido" };
    }

    if (parts.length === 2) {
      return {
        source: "kitsu",
        animeId: parts[1],
        season: 1,
        episode: null
      };
    }

    if (parts.length === 4) {
      const season = Number(parts[2]);
      const episode = Number(parts[3]);

      if (
        !Number.isInteger(season) ||
        !Number.isInteger(episode) ||
        season < 0 ||
        episode < 1
      ) {
        return { error: "Temporada ou episódio inválido" };
      }

      return {
        source: "kitsu",
        animeId: parts[1],
        season,
        episode
      };
    }

    return { error: "Formato Kitsu não reconhecido" };
  }

  if (/^tt\d+$/i.test(parts[0])) {
    if (parts.length === 1) {
      return {
        source: "imdb",
        animeId: parts[0],
        season: 1,
        episode: null
      };
    }

    if (parts.length === 3) {
      const season = Number(parts[1]);
      const episode = Number(parts[2]);

      if (
        !Number.isInteger(season) ||
        !Number.isInteger(episode) ||
        season < 0 ||
        episode < 1
      ) {
        return { error: "Temporada ou episódio inválido" };
      }

      return {
        source: "imdb",
        animeId: parts[0],
        season,
        episode
      };
    }

    return { error: "Formato IMDb não reconhecido" };
  }

  return { error: "Prefixo de ID não suportado" };
}

async function getMetadata(parsed) {
  let response;

  if (parsed.source === "kitsu") {
    response = await http.get(
      `https://kitsu.io/api/edge/anime/${encodeURIComponent(parsed.animeId)}`
    );

    const attr = response.data?.data?.attributes;

    if (!attr) {
      throw new Error("Anime não encontrado no Kitsu");
    }

    return {
      title:
        attr.canonicalTitle ||
        attr.titles?.en ||
        attr.titles?.en_jp
    };
  }

  response = await http.get(
    `https://v3-cinemeta.strem.fun/meta/series/${encodeURIComponent(parsed.animeId)}.json`
  );

  const meta = response.data?.meta;

  if (!meta?.name) {
    throw new Error("Anime não encontrado no Cinemeta");
  }

  return { title: meta.name };
}

builder.defineStreamHandler(async ({ type, id }) => {
  log("request", { type, id });

  const parsed = parseId(id);

  if (parsed.error) {
    log("invalid_id", { id, reason: parsed.error });
    return { streams: [] };
  }

  if (parsed.episode == null) {
    log("episode_missing", {
      id,
      message: "O ID não especifica um episódio"
    });

    return { streams: [] };
  }

  let metadata;

  try {
    metadata = await getMetadata(parsed);
  } catch (error) {
    log("metadata_error", {
      id,
      message: error.message,
      httpStatus: error.response?.status || null
    });

    return { streams: [] };
  }

  if (!metadata.title) {
    log("metadata_error", { id, message: "Título vazio" });
    return { streams: [] };
  }

  log("metadata_success", { id, title: metadata.title });

  const streams = await searchAllProviders({
    title: metadata.title,
    season: parsed.season,
    episode: parsed.episode
  });

  log("complete", {
    id,
    title: metadata.title,
    streamsFound: streams.length
  });

  return { streams };
});

const addonInterface = builder.getInterface();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.get("/", (req, res) => {
  res.redirect("/manifest.json");
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    version: manifest.version,
    providers: PROVIDERS.map(provider => ({
      name: provider.name,
      configured: Boolean(process.env[provider.env])
    }))
  });
});

app.get("/manifest.json", (req, res) => {
  res.json(addonInterface.manifest);
});

app.get("/stream/:type/:id.json", async (req, res) => {
  try {
    const result = await addonInterface.get(
      "stream",
      req.params.type,
      req.params.id
    );

    res.json(result);
  } catch (error) {
    log("endpoint_error", {
      message: error.message,
      type: req.params.type,
      id: req.params.id
    });

    res.status(500).json({ streams: [] });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    log("server_started", { port: PORT });
  });
}

module.exports = app;
