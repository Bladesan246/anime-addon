
const axios = require("axios");

const http = axios.create({
  timeout: 10000,
  headers: {
    Accept: "application/json"
  }
});

function log(stage, details = {}) {
  console.log(JSON.stringify({
    time: new Date().toISOString(),
    stage,
    ...details
  }));
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

async function searchAllProviders(query) {
  const apiUrl = process.env.AUTHORIZED_PROVIDER_API_URL;

  if (!apiUrl) {
    log("provider_not_configured", {
      title: query.title,
      episode: query.episode
    });

    return [];
  }

  if (!isHttpUrl(apiUrl)) {
    log("provider_invalid_api_url");
    return [];
  }

  try {
    const response = await http.get(apiUrl, {
      params: {
        title: query.title,
        season: query.season,
        episode: query.episode
      }
    });

    const items = Array.isArray(response.data?.streams)
      ? response.data.streams
      : [];

    const unique = new Map();

    for (const item of items) {
      if (
        !item ||
        typeof item.url !== "string" ||
        !isHttpUrl(item.url)
      ) {
        continue;
      }

      unique.set(item.url, {
        name: String(item.name || "Fonte autorizada"),
        title: String(
          item.title ||
          `${query.title} — Episódio ${query.episode}`
        ),
        url: item.url
      });
    }

    const streams = [...unique.values()];

    log("provider_search_complete", {
      title: query.title,
      episode: query.episode,
      streamsFound: streams.length
    });

    return streams;
  } catch (error) {
    log("provider_error", {
      message: error.message,
      status: error.response?.status || null
    });

    return [];
  }
}

module.exports = {
  searchAllProviders
};
