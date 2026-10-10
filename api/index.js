
const express = require("express");
const axios = require("axios");
const { addonBuilder } = require("stremio-addon-sdk");
const { searchAllProviders } = require("./providers");

const app = express();

const manifest = {
  id: "br.meuanime.addon",
  version: "1.4.0",
  name: "Animes BR",
  description:
    "Addon de animes com integração para provedores autorizados.",
  resources: ["stream"],
  types: ["anime", "series", "movie"],
  idPrefixes: ["tt", "kitsu"],
  catalogs: []
};

const http = axios.create({
  timeout: 10000,
  headers: {
    Accept: "application/json"
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

function parseId(id) {
  if (typeof id !== "string" || !id.trim()) {
    return { error: "ID ausente" };
  }

  const parts = id.split(":");

  // IDs Kitsu
  if (parts[0].toLowerCase() === "kitsu") {
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

  // IDs IMDb
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
  }

  return { error: "Formato de ID não suportado" };
}

async function getMetadata(parsed, type) {
  if (parsed.source === "kitsu") {
    const response = await http.get(
      `https://kitsu.io/api/edge/anime/${encodeURIComponent(
        parsed.animeId
      )}`
    );

    const attributes = response.data?.data?.attributes;

    const title =
      attributes?.canonicalTitle ||
      attributes?.titles?.en ||
      attributes?.titles?.en_jp;

    if (!title) {
      throw new Error("Título não encontrado no Kitsu");
    }

    return { title };
  }

  const metadataType = type === "movie" ? "movie" : "series";

  const response = await http.get(
    `https://v3-cinemeta.strem.fun/meta/${metadataType}/${encodeURIComponent(
      parsed.animeId
    )}.json`
  );

  const meta = response.data?.meta;

  if (!meta?.name) {
    throw new Error("Título não encontrado no Cinemeta");
  }

  return { title: meta.name };
}

const builder = new addonBuilder(manifest);

// Registre o handler ANTES de chamar getInterface().
builder.defineStreamHandler(async ({ type, id }) => {
  log("stream_request", { type, id });

  if (!manifest.types.includes(type)) {
    return { streams: [] };
  }

  const parsed = parseId(id);

  if (parsed.error) {
    log("invalid_id", {
      id,
      reason: parsed.error
    });

    return { streams: [] };
  }

  if (parsed.episode === null) {
    log("episode_missing", { id });
    return { streams: [] };
  }

  let metadata;

  try {
    metadata = await getMetadata(parsed, type);
  } catch (error) {
    log("metadata_error", {
      id,
      message: error.message,
      status: error.response?.status || null
    });

    return { streams: [] };
  }

  try {
    const streams = await searchAllProviders({
      title: metadata.title,
      season: parsed.season,
      episode: parsed.episode,
      type
    });

    log("stream_request_complete", {
      id,
      title: metadata.title,
      streamsFound: streams.length
    });

    return { streams };
  } catch (error) {
    log("provider_error", {
      id,
      message: error.message
    });

    return { streams: [] };
  }
});

// Obtenha a interface somente depois de registrar os handlers.
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
    providerConfigured: Boolean(
      process.env.AUTHORIZED_PROVIDER_API_URL
    ),
    timestamp: new Date().toISOString()
  });
});

app.get("/manifest.json", (req, res) => {
  res.json(addonInterface.manifest);
});

app.get("/stream/:type/:id.json", async (req, res) => {
  try {
    const id = req.params.id.replace(/\.json$/, "");

    const result = await addonInterface.get(
      "stream",
      req.params.type,
      id
    );

    res.json(result);
  } catch (error) {
    log("stream_endpoint_error", {
      message: error.message,
      type: req.params.type,
      id: req.params.id
    });

    res.status(500).json({
      streams: []
    });
  }
});

app.use((error, req, res, next) => {
  log("unhandled_error", {
    message: error.message,
    path: req.path
  });

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: "Erro interno do servidor"
  });
});

// Execução local
if (require.main === module) {
  const port = process.env.PORT || 3000;

  app.listen(port, () => {
    log("server_started", { port });
  });
}

// Exportação para a Vercel
module.exports = app;
