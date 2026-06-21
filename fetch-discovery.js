#!/usr/bin/env node
/**
 * fetch-discovery.js
 * Usage: node fetch-discovery.js [--days N] [--features] [--save-dir DIR]
 *
 * 발굴 레이어 (docs/auto-update-plan.md 의 D1·D2·D4):
 *   D1  OpenRouter /v1/models      → 신규 모델·버전
 *   D2  GitHub Search (토픽+생성일)  → 신규 플러그인·도구
 *   D4  Tavily "X new features"     → 모델/제품 최신 기능 (--features 시)
 *
 * 외부 패키지 없음. .env 에서 TAVILY_API_KEY(D4용), GITHUB_TOKEN(선택) 로드.
 * 각 소스는 독립 try/catch — 하나 실패해도 나머지는 진행.
 */

const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const { resolve } = require('path');

// --- .env ---
function loadEnv(p) {
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return {}; }
  const env = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('='); if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

// --- args ---
function parseArgs(argv) {
  const a = { days: 3, features: false, saveDir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days' && argv[i + 1]) a.days = parseInt(argv[++i], 10);
    else if (argv[i] === '--features') a.features = true;
    else if (argv[i] === '--save-dir' && argv[i + 1]) a.saveDir = argv[++i];
  }
  return a;
}

// 타임아웃 있는 fetch — 소켓 hang 방지 (기본 15초). abort 시 호출부 try/catch가 처리.
async function fetchT(url, opts = {}, ms = 15000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(timer); }
}

// 기존 키워드 인덱스 (러프 dedup 힌트)
function loadExistingBlob() {
  try { return readFileSync(resolve(__dirname, 'keywords-index.txt'), 'utf8').toLowerCase(); }
  catch { return ''; }
}

// 메타리스트·로드맵·치트시트 등 위키 부적합 레포 판별
const META_RE = /awesome|roadmap|cheat[\s-]?sheet|curated list|list of|interview|tutorial-list|资料|모음集?|教程/i;

// ---------------------------------------------------------------------------
// D1: OpenRouter — 신규 모델
// ---------------------------------------------------------------------------
async function discoverModels(cutoff, blob) {
  const r = await fetchT('https://openrouter.ai/api/v1/models');
  if (!r.ok) throw new Error(`OpenRouter ${r.status}`);
  const j = await r.json();
  const recent = (j.data || []).filter(m => m.created && m.created > cutoff)
    .sort((a, b) => b.created - a.created);
  // 버전 단위로 개별 추출 (계열로 뭉치지 않음). 신규 모델 버전이 각각 후보가 되게.
  const seen = new Set();
  const out = [];
  for (const m of recent) {
    const id = m.id || '';
    if (!id || seen.has(id)) continue;
    if (id.includes(':free')) continue; // 유료판과 중복되는 free 변형 제외
    seen.add(id);
    const modelPart = id.split('/')[1] || id;
    const fam = (modelPart.match(/^[a-z]+/i) || [modelPart])[0].toLowerCase();
    out.push({
      family: fam,
      id,
      name: m.name || id,
      date: new Date(m.created * 1000).toISOString().slice(0, 10),
      knownFamily: blob.includes(fam), // 계열이 이미 위키에 있나(힌트)
    });
    if (out.length >= 40) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// D2: GitHub — 신규 생태계 레포 (토픽 + 생성일)
// ---------------------------------------------------------------------------
const GH_TOPICS = ['claude-code', 'claude', 'gemini-cli', 'gemini', 'codex', 'openai-codex'];

async function discoverRepos(sinceDate, token) {
  const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'AI-Wiki-Bot/1.0' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const byName = new Map();
  for (const topic of GH_TOPICS) {
    try {
      const q = encodeURIComponent(`topic:${topic} created:>${sinceDate}`);
      const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=15`;
      const r = await fetchT(url, { headers });
      if (!r.ok) { console.error(`  GitHub topic:${topic} → ${r.status}`); continue; }
      const j = await r.json();
      for (const it of j.items || []) {
        const name = it.full_name || '';
        const desc = it.description || '';
        if (META_RE.test(name) || META_RE.test(desc)) continue; // 메타리스트 제외
        if (!byName.has(name)) {
          byName.set(name, {
            full_name: name,
            repo: (name.split('/')[1] || name),
            desc: desc.slice(0, 120),
            stars: it.stargazers_count || 0,
            created: (it.created_at || '').slice(0, 10),
            topic,
          });
        }
      }
    } catch (e) { console.error(`  GitHub topic:${topic} 실패: ${e.message}`); }
  }
  return [...byName.values()].sort((a, b) => b.stars - a.stars);
}

// ---------------------------------------------------------------------------
// D4: Tavily — 기능 추출
// ---------------------------------------------------------------------------
async function tavilyFeatures(query, key) {
  const r = await fetchT('https://api.tavily.com/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, query, max_results: 5, include_answer: true }),
  });
  if (!r.ok) throw new Error(`Tavily ${r.status}`);
  const j = await r.json();
  return (j.answer || '').slice(0, 400);
}

async function extractFeatures(models, repos, key, cap) {
  const targets = [];
  models.forEach(m => targets.push({ kind: 'model', label: m.name, query: `${m.name} new features capabilities changelog 2026` }));
  repos.slice(0, Math.max(0, cap - models.length)).forEach(r =>
    targets.push({ kind: 'repo', label: r.repo, query: `${r.repo} ${r.desc} — what is it, key features` }));
  const out = [];
  for (const t of targets.slice(0, cap)) {
    try { out.push({ name: t.label, kind: t.kind, summary: await tavilyFeatures(t.query, key) }); }
    catch (e) { console.error(`  Tavily "${t.label}" 실패: ${e.message}`); }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const env = loadEnv(resolve(__dirname, '.env'));
  const args = parseArgs(process.argv.slice(2));
  const blob = loadExistingBlob();

  const nowSec = Math.floor(Date.now() / 1000);
  const cutoffSec = nowSec - args.days * 86400;
  const sinceDate = new Date(cutoffSec * 1000).toISOString().slice(0, 10);

  console.error(`[discovery] 최근 ${args.days}일 (since ${sinceDate})`);

  const [models, repos] = await Promise.all([
    discoverModels(cutoffSec, blob).catch(e => { console.error('D1 OpenRouter 실패:', e.message); return []; }),
    discoverRepos(sinceDate, env.GITHUB_TOKEN || process.env.GITHUB_TOKEN).catch(e => { console.error('D2 GitHub 실패:', e.message); return []; }),
  ]);

  let features = [];
  if (args.features) {
    const key = env.TAVILY_API_KEY || process.env.TAVILY_API_KEY;
    if (!key) console.error('D4 건너뜀: TAVILY_API_KEY 없음');
    else features = await extractFeatures(models, repos, key, 12); // 최대 12 호출
  }

  const result = { generatedDays: args.days, since: sinceDate, models, repos, features };
  const json = JSON.stringify(result, null, 2);
  console.log(json);

  // 사람이 읽는 요약은 stderr로
  console.error(`\n[discovery] 신규 모델 ${models.length} · 레포 ${repos.length} · 기능요약 ${features.length}`);
  models.slice(0, 10).forEach(m => console.error(`  모델 ${m.date}  ${m.family}${m.knownFamily ? '' : ' ★신규계열'}  (${m.id})`));
  repos.slice(0, 10).forEach(r => console.error(`  레포 ★${r.stars}  ${r.full_name} — ${r.desc.slice(0, 50)}`));

  if (args.saveDir) {
    mkdirSync(args.saveDir, { recursive: true });
    writeFileSync(resolve(args.saveDir, 'discovery.json'), json);
    console.error(`Saved to ${args.saveDir}/discovery.json`);
  }
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
