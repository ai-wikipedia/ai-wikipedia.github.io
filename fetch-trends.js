#!/usr/bin/env node
/**
 * fetch-trends.js
 * Usage: node fetch-trends.js
 *
 * Collects recent AI-related trending topics from 3 sources in parallel,
 * then outputs JSON to stdout.
 * Reads API keys from .env (no external packages).
 */

const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const { resolve } = require('path');

// 모든 요청에 타임아웃 — 응답 없는 소켓 하나가 실행 전체를 멈추지 않게
const _fetch = globalThis.fetch;
const fetch = (url, opts = {}) => _fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });

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
// GeekNews (news.hada.io) — HTML scraping
// ---------------------------------------------------------------------------
const GN_BASE = 'https://news.hada.io';
const GN_HEADERS = { 'User-Agent': 'AI-Wiki-Bot/1.0' };

async function fetchGeekNews() {
  const res = await fetch(GN_BASE + '/new', { headers: GN_HEADERS });
  if (!res.ok) throw new Error(`GeekNews error (${res.status})`);
  const html = await res.text();

  const articles = [];
  // Split by topic_row boundaries
  const parts = html.split(/class='topic_row'/);
  for (let i = 1; i < parts.length; i++) { // /new 첫 페이지 전체 (스크래핑이라 비용 없음)
    const block = parts[i];

    // Title + URL: <a href='topic?id=NNN' ...><h1>Title</h1></a>
    const linkMatch = block.match(/class=topictitle>[\s\S]*?<a[^>]+href='([^']+)'[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;

    let url = linkMatch[1];
    const title = linkMatch[2].replace(/<[^>]+>/g, '').trim();
    if (!url.startsWith('http')) url = GN_BASE + '/' + url;

    // Points: <span id='tpNNN'>NN</span>
    const ptsMatch = block.match(/<span id='tp\d+'>(\d+)<\/span>/);
    const points = ptsMatch ? parseInt(ptsMatch[1]) : 0;

    articles.push({ title, url, points });
  }
  return articles;
}

// 주간뉴스 목록의 회차 ID (YYYYWW, 최신순)
async function fetchGeekNewsWeeklyIds() {
  const listRes = await fetch(GN_BASE + '/weekly', { headers: GN_HEADERS });
  if (!listRes.ok) throw new Error(`GeekNews weekly list error (${listRes.status})`);
  const listHtml = await listRes.text();
  return [...new Set([...listHtml.matchAll(/href='\/weekly\/(\d+)'/g)].map(m => m[1]))];
}

async function fetchGeekNewsWeeklyById(weeklyId) {
  const detailRes = await fetch(`${GN_BASE}/weekly/${weeklyId}`, { headers: GN_HEADERS });
  if (!detailRes.ok) throw new Error(`GeekNews weekly detail error (${detailRes.status})`);
  const detailHtml = await detailRes.text();

  // 회차 본문의 토픽 링크 (예전 class='desc' 구조는 2026-09 개편 이후 없음 → 항상 0건이었음)
  const items = [];
  const linkRegex = /<a[^>]+href=['"]((?:https:\/\/news\.hada\.io)?\/?topic\?id=\d+)['"][^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = linkRegex.exec(detailHtml)) !== null) {
    let linkUrl = m[1];
    const linkTitle = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!linkTitle || linkTitle.length < 4) continue;
    if (!linkUrl.startsWith('http')) linkUrl = GN_BASE + '/' + linkUrl.replace(/^\//, '');
    if (!items.some(it => it.url === linkUrl)) items.push({ title: linkTitle, url: linkUrl });
  }
  return { id: weeklyId, items };
}

// 최신 2회차 — 하루이틀 실행이 빠져도 지난주 회차를 놓치지 않게
async function fetchGeekNewsWeekly() {
  const ids = await fetchGeekNewsWeeklyIds();
  if (!ids.length) throw new Error('GeekNews: 최신 주간뉴스 ID를 찾을 수 없음');
  const issues = await Promise.all(ids.slice(0, 2).map(fetchGeekNewsWeeklyById));
  return { id: issues.map(w => w.id).join(','), items: issues.flatMap(w => w.items) };
}

// ISO 주차 ID (YYYYWW) — 주간뉴스 회차 번호와 같은 체계
function isoWeekId(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}${String(week).padStart(2, '0')}`;
}

// 백필: since 이후 모든 주간뉴스 회차
async function fetchGeekNewsWeeklySince(since) {
  const from = isoWeekId(new Date(since));
  const ids = (await fetchGeekNewsWeeklyIds()).filter(id => id >= from);
  const out = [];
  for (const id of ids) {
    try { out.push(await fetchGeekNewsWeeklyById(id)); }
    catch (e) { console.error(`GeekNews weekly ${id} 실패: ${e.message}`); }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hacker News
// ---------------------------------------------------------------------------
// 약어는 단어 경계로 ("ml"이 HTML에, "ai"가 said에 걸리지 않게), 회사·모델·도구 이름도 포함
const HN_AI_RE = new RegExp([
  '\\b(ai|ml|llms?|gpt|rag|nlp|mcp|agi|asr|tts|gpu|tpu)\\b',
  'claude|openai|anthropic|gemini|deepseek|qwen|llama|mistral|grok|kimi|\\bglm|copilot|cursor|codex|hugging ?face|ollama|vllm',
  'transformer|neural|agent|embedding|fine-?tun|diffusion|multimodal|reasoning|context window|token|prompt|model|inference|chatbot',
  'machine learning|deep learning|vision|generative|vibe cod',
].join('|'), 'i');

function isAiRelated(title) {
  return HN_AI_RE.test(title);
}

async function fetchHackerNews() {
  const topRes = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
  if (!topRes.ok) {
    throw new Error(`HN topstories error (${topRes.status})`);
  }
  const ids = await topRes.json();
  const top30 = ids.slice(0, 100); // 상위 100개 (HN API는 무료, 30위 밖 AI 글도 잡히게)

  const items = await Promise.all(
    top30.map(async id => {
      const res = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      if (!res.ok) return null;
      return res.json();
    })
  );

  return items
    .filter(item => item && item.title && isAiRelated(item.title))
    .map(item => ({
      title: item.title || '',
      url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
      score: item.score || 0,
    }));
}

// 백필: HN Algolia로 since 이후 주 단위 AI 관련 고득점 글 (주당 상위 30개)
async function fetchHackerNewsSince(since) {
  const out = [];
  const end = Math.floor(Date.now() / 1000);
  for (let t = Math.floor(new Date(since).getTime() / 1000); t < end; t += 7 * 86400) {
    const q = `tags=story&hitsPerPage=1000&numericFilters=${encodeURIComponent(`created_at_i>${t},created_at_i<${t + 7 * 86400},points>100`)}`;
    try {
      const r = await fetch(`https://hn.algolia.com/api/v1/search?${q}`);
      if (!r.ok) throw new Error(`HN Algolia ${r.status}`);
      const j = await r.json();
      (j.hits || [])
        .filter(h => h.title && isAiRelated(h.title))
        .sort((a, b) => b.points - a.points).slice(0, 30)
        .forEach(h => out.push({
          title: h.title,
          url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
          score: h.points || 0,
          date: (h.created_at || '').slice(0, 10),
        }));
    } catch (e) { console.error(`HN 백필 ${new Date(t * 1000).toISOString().slice(0, 10)} 실패: ${e.message}`); }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tavily Search
// ---------------------------------------------------------------------------
async function tavilySearch(query, apiKey, maxResults = 10) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query: query,
      max_results: maxResults,
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
// Main
// ---------------------------------------------------------------------------
function parseArg(argv, name) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1]) return argv[i + 1];
  }
  return null;
}

async function main() {
  const env = loadEnv(resolve(__dirname, '.env'));
  const saveDir = parseArg(process.argv.slice(2), '--save-dir');
  // --since YYYY-MM-DD: 실행이 밀린 기간의 HN·GeekNews 주간뉴스를 함께 수집 (백필)
  const since = parseArg(process.argv.slice(2), '--since');

  const TAVILY_API_KEY = env.TAVILY_API_KEY || process.env.TAVILY_API_KEY;

  if (!TAVILY_API_KEY) {
    console.error('Missing TAVILY_API_KEY in .env');
    process.exit(1);
  }

  const redditQuery = `AI OR LLM OR machine learning new ${new Date().getFullYear()} site:reddit.com`;

  const [hackernews, reddit, geeknews, geeknews_weekly] = await Promise.all([
    fetchHackerNews(),
    tavilySearch(redditQuery, TAVILY_API_KEY, 10),
    fetchGeekNews().catch(err => { console.error('GeekNews fetch failed:', err.message); return []; }),
    fetchGeekNewsWeekly().catch(err => { console.error('GeekNews weekly failed:', err.message); return { id: '', items: [] }; }),
  ]);

  const result = {
    hackernews,
    reddit,
    geeknews,
    geeknews_weekly,
  };
  if (since) {
    const [hnPast, weeklyPast] = await Promise.all([
      fetchHackerNewsSince(since),
      fetchGeekNewsWeeklySince(since).catch(err => { console.error('GeekNews weekly 백필 실패:', err.message); return []; }),
    ]);
    result.backfill = { since, hackernews: hnPast, geeknews_weekly: weeklyPast };
    console.error(`[backfill] since ${since}: HN ${hnPast.length}개 · 주간뉴스 ${weeklyPast.length}회 (${weeklyPast.reduce((n, w) => n + w.items.length, 0)}개)`);
  }

  const json = JSON.stringify(result, null, 2);
  console.log(json);

  if (saveDir) {
    mkdirSync(saveDir, { recursive: true });
    writeFileSync(resolve(saveDir, 'trends.json'), json);
    console.error(`Saved to ${saveDir}/trends.json`);
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
