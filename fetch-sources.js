#!/usr/bin/env node
/**
 * fetch-sources.js
 * Usage: node fetch-sources.js --keyword "MCP" --keyword-ko "MCP" --en "Model Context Protocol"
 *
 * Calls Tavily Search API and YouTube Data API v3 in parallel, then outputs JSON to stdout.
 * Reads API keys from .env (no external packages).
 */

const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const { resolve } = require('path');

// ---------------------------------------------------------------------------
// .env parser
// ---------------------------------------------------------------------------
function loadEnv(envPath) {
  let raw;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    return {};
  }
  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    env[key] = value;
  }
  return env;
}

// ---------------------------------------------------------------------------
// CLI args parser
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { keyword: null, keywordKo: null, en: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--keyword' && argv[i + 1]) {
      args.keyword = argv[++i];
    } else if (argv[i] === '--keyword-ko' && argv[i + 1]) {
      args.keywordKo = argv[++i];
    } else if (argv[i] === '--en' && argv[i + 1]) {
      args.en = argv[++i];
    } else if (argv[i] === '--save-dir' && argv[i + 1]) {
      args.saveDir = argv[++i];
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Tavily Search
// ---------------------------------------------------------------------------
async function tavilySearch(query, apiKey) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query: query,
      max_results: 10,
      include_answer: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Tavily error (${res.status}): ${body}`);
  }
  const data = await res.json();
  return (data.results || []).map(item => ({
    title: item.title || '',
    link: item.url || '',
    snippet: item.content || '',
  }));
}

// ---------------------------------------------------------------------------
// YouTube search.list
// ---------------------------------------------------------------------------
async function youtubeSearch(query, apiKey) {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('q', query);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('order', 'relevance');
  url.searchParams.set('maxResults', '10');

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube search error (${res.status}): ${body}`);
  }
  const data = await res.json();
  return (data.items || []).map(item => ({
    videoId: item.id?.videoId || '',
    title: item.snippet?.title || '',
    channelTitle: item.snippet?.channelTitle || '',
    publishedAt: item.snippet?.publishedAt || '',
  }));
}

// ---------------------------------------------------------------------------
// YouTube videos.list (statistics)
// ---------------------------------------------------------------------------
async function youtubeStatistics(videoIds, apiKey) {
  if (!videoIds.length) return {};

  const chunks = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    chunks.push(videoIds.slice(i, i + 50));
  }

  const statMap = {};
  await Promise.all(
    chunks.map(async chunk => {
      const url = new URL('https://www.googleapis.com/youtube/v3/videos');
      url.searchParams.set('key', apiKey);
      url.searchParams.set('id', chunk.join(','));
      url.searchParams.set('part', 'statistics');

      const res = await fetch(url.toString());
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`YouTube videos.list error (${res.status}): ${body}`);
      }
      const data = await res.json();
      for (const item of data.items || []) {
        statMap[item.id] = parseInt(item.statistics?.viewCount || '0', 10);
      }
    })
  );
  return statMap;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const env = loadEnv(resolve(__dirname, '.env'));

  const TAVILY_API_KEY = env.TAVILY_API_KEY || process.env.TAVILY_API_KEY;
  const YOUTUBE_API_KEY = env.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY;

  if (!TAVILY_API_KEY) {
    console.error('Missing TAVILY_API_KEY in .env');
    process.exit(1);
  }
  if (!YOUTUBE_API_KEY) {
    console.error('Warning: Missing YOUTUBE_API_KEY in .env — YouTube results will be empty');
  }

  const args = parseArgs(process.argv.slice(2));
  const saveDir = args.saveDir;

  const enQuery = args.en || args.keyword;
  const koQuery = args.keywordKo || args.keyword;

  if (!enQuery && !koQuery) {
    console.error('Usage: node fetch-sources.js --keyword "MCP" [--keyword-ko "MCP"] [--en "Model Context Protocol"]');
    process.exit(1);
  }

  // Run all 4 API calls in parallel; YouTube failures are non-fatal
  const safeYT = fn => (YOUTUBE_API_KEY ? fn().catch(e => { console.error('YouTube skip:', e.message); return []; }) : Promise.resolve([]));
  const [webEn, webKo, ytEn, ytKo] = await Promise.all([
    enQuery ? tavilySearch(enQuery, TAVILY_API_KEY) : Promise.resolve([]),
    koQuery ? tavilySearch(koQuery, TAVILY_API_KEY) : Promise.resolve([]),
    safeYT(() => enQuery ? youtubeSearch(enQuery, YOUTUBE_API_KEY) : Promise.resolve([])),
    safeYT(() => koQuery ? youtubeSearch(koQuery, YOUTUBE_API_KEY) : Promise.resolve([])),
  ]);

  // Collect all unique videoIds for statistics lookup
  const allVideoIds = [...new Set([...ytEn, ...ytKo].map(v => v.videoId).filter(Boolean))];
  const statMap = allVideoIds.length && YOUTUBE_API_KEY
    ? await youtubeStatistics(allVideoIds, YOUTUBE_API_KEY).catch(e => { console.error('YouTube stats skip:', e.message); return {}; })
    : {};

  const attachStats = videos =>
    videos.map(v => ({ ...v, viewCount: statMap[v.videoId] ?? 0 }));

  const result = {
    web: {
      en: webEn,
      ko: webKo,
    },
    youtube: {
      en: attachStats(ytEn),
      ko: attachStats(ytKo),
    },
  };

  const json = JSON.stringify(result, null, 2);
  console.log(json);

  if (saveDir) {
    mkdirSync(saveDir, { recursive: true });
    writeFileSync(resolve(saveDir, 'sources.json'), json);
    console.error(`Saved to ${saveDir}/sources.json`);
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
