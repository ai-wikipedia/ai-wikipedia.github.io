#!/usr/bin/env node
// 스케줄러 LLM 단계 실행기 — Stage 2(키워드 선정) / Stage 4(콘텐츠 생성 + 번역)
//
// 기존 run-daily.sh는 `claude --dangerously-skip-permissions --print`(도구·훅·플러그인·CLAUDE.md 전부 로드)로
// 키워드를 하나씩 순차 생성해, 실패율 70%(JSON 깨짐·10분 타임아웃)와 키워드당 2~10분이 걸렸다.
// 여기서는:
//   - 도구/설정/MCP 없이 순수 생성 모드로 호출 (--tools "" --setting-sources "" --strict-mcp-config, 중립 cwd)
//   - --json-schema 구조화 출력 → 따옴표 미이스케이프 등 JSON 깨짐 원천 차단, 실패 시 1회 재시도
//   - 키워드별 병렬 실행, 본문 생성(고품질 모델)과 번역(경량 모델) 분리
//   - 품질 게이트: 본문 1000자 미만은 반영하지 않음 (build.js THIN_THRESHOLD와 동일)
//
// 사용법:
//   node scripts/llm-stage.js select  --run-dir DIR [--max 5]
//   node scripts/llm-stage.js content --run-dir DIR [--parallel 3]
//   node scripts/llm-stage.js translate --ids a,b,c --out DIR [--parallel 3]   (기존 항목 번역만 재생성 → apply-updates.js 입력)
//   node scripts/llm-stage.js translate --stale --out DIR   (공개 항목 중 번역이 없거나 한국어 본문이 바뀐 것만 — i18n-meta.json 기준)
//   node scripts/llm-stage.js restyle --ids a,b --out DIR   (기존 글을 현재 작성 기준으로 다시 쓰기 — 기존 본문의 사실만 사용 → apply-updates.js 입력)
// 환경변수(선택): AIWIKI_CLAUDE, AIWIKI_LOG,
//   AIWIKI_{SELECT,CONTENT,TRANSLATE}_MODEL / _EFFORT

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const WORK_DIR = path.resolve(__dirname, '..');
const CLAUDE = process.env.AIWIKI_CLAUDE || 'claude';
const LOG = process.env.AIWIKI_LOG || '';
const env = (k, d) => process.env[k] || d;
const CFG = {
  select:    { model: env('AIWIKI_SELECT_MODEL', 'sonnet'),    effort: env('AIWIKI_SELECT_EFFORT', 'medium'),  timeout: 300 },
  content:   { model: env('AIWIKI_CONTENT_MODEL', 'opus'),     effort: env('AIWIKI_CONTENT_EFFORT', 'medium'), timeout: 600 },
  translate: { model: env('AIWIKI_TRANSLATE_MODEL', 'sonnet'), effort: env('AIWIKI_TRANSLATE_EFFORT', 'low'),  timeout: 300 },
};
const THIN_THRESHOLD = 1000;
const CATS = ['prompting', 'model', 'tooling', 'data', 'agent', 'infra', 'safety', 'application'];
const PROMPTS = path.join(WORK_DIR, '.claude', 'prompts');

// 프로젝트 CLAUDE.md가 자동 로드되지 않도록 레포 밖 빈 디렉토리에서 실행
const NEUTRAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwiki-llm-'));
process.on('exit', () => { try { fs.rmSync(NEUTRAL_DIR, { recursive: true, force: true }); } catch (e) {} });

function ts() { return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }); }
function log(msg) {
  const line = `[${ts()}] ${msg}\n`;
  if (LOG) fs.appendFileSync(LOG, line); else process.stderr.write(line);
}

function parseArgs(argv) {
  const a = { mode: argv[0], max: 5, parallel: 3 };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--run-dir') a.runDir = argv[++i];
    else if (argv[i] === '--max') a.max = parseInt(argv[++i], 10);
    else if (argv[i] === '--parallel') a.parallel = parseInt(argv[++i], 10);
    else if (argv[i] === '--ids') a.ids = argv[++i];
    else if (argv[i] === '--out') a.out = argv[++i];
    else if (argv[i] === '--stale') a.stale = true;
    else if (argv[i] === '--limit') a.limit = parseInt(argv[++i], 10);
  }
  return a;
}

// {UPPER_CASE} 플레이스홀더만 치환 (프롬프트 안의 JSON 예시 중괄호는 건드리지 않음)
function fill(tpl, vars) {
  return tpl.replace(/\{([A-Z_]+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

function killGroup(child) {
  try { process.kill(-child.pid, 'SIGTERM'); } catch (e) {}
  setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {} }, 3000).unref();
}

// claude CLI 1회 호출 → structured_output 반환
function callClaude(prompt, schema, cfg, label) {
  return new Promise((resolve) => {
    const args = [
      '--print', '--tools', '', '--setting-sources', '', '--strict-mcp-config',
      '--no-session-persistence', '--model', cfg.model, '--effort', cfg.effort,
      '--output-format', 'json', '--json-schema', JSON.stringify(schema),
    ];
    const started = Date.now();
    const child = spawn(CLAUDE, args, { cwd: NEUTRAL_DIR, env: process.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', errOut = '', parsed = null, done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => {
      log(`  TIMEOUT ${label} (${cfg.timeout}s)`);
      killGroup(child);
      finish({ ok: false, error: `timeout ${cfg.timeout}s` });
    }, cfg.timeout * 1000);

    child.stdout.on('data', (d) => {
      out += d;
      // 결과 JSON을 다 출력하고도 프로세스가 안 끝나는 경우 대비: 완결된 result 객체면 즉시 정리
      if (out.trimEnd().endsWith('}')) {
        try { const r = JSON.parse(out); if (r && r.type === 'result') { parsed = r; killGroup(child); } } catch (e) {}
      }
    });
    child.stderr.on('data', (d) => { errOut += d; });
    child.on('error', (e) => finish({ ok: false, error: `spawn 실패: ${e.message}` }));
    child.on('close', (code) => {
      let r = parsed;
      if (!r) { try { r = JSON.parse(out); } catch (e) {} }
      const sec = Math.round((Date.now() - started) / 1000);
      if (!r) return finish({ ok: false, error: `출력 파싱 불가 (exit ${code}, ${sec}s) ${errOut.slice(-300).trim()}` });
      if (r.is_error || !r.structured_output) {
        return finish({ ok: false, error: `is_error=${r.is_error} subtype=${r.subtype} (${sec}s) ${String(r.result || '').slice(0, 300)}` });
      }
      finish({ ok: true, data: r.structured_output, cost: r.total_cost_usd || 0, sec });
    });
    child.stdin.end(prompt);
  });
}

async function callWithRetry(prompt, schema, cfg, label, tries = 2) {
  let last;
  for (let i = 1; i <= tries; i++) {
    last = await callClaude(prompt, schema, cfg, label);
    if (last.ok) { log(`  ${label} 완료 (${last.sec}s, $${last.cost.toFixed(3)})`); return last; }
    log(`  ${label} 실패 ${i}/${tries}: ${last.error}`);
  }
  return last;
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, n) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
}

const readText = (p, d = '') => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return d; } };
const textLen = (html) => String(html || '').replace(/<[^>]+>/g, '').length;
const existingIds = () => new Set(readText(path.join(WORK_DIR, 'keywords-index.txt')).split('\n').map((l) => l.split('\t')[0]).filter(Boolean));

// ── Stage 2: 키워드 선정 ──
const SELECT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' }, keyword: { type: 'string' }, keywordKo: { type: 'string' }, en: { type: 'string' },
          kind: { type: 'string', enum: ['model', 'concept', 'tool', 'pattern', 'other'] }, // model = AI 모델 출시/버전
        },
        required: ['id', 'keyword', 'keywordKo', 'en', 'kind'],
      },
    },
  },
  required: ['items'],
};

// 선정 결과를 저장하고 Stage 3 입력(keywords-list.txt: id|t|en|ko)을 만든다
function writeSelection(runDir, items) {
  fs.writeFileSync(path.join(runDir, 'keywords-selected.json'), JSON.stringify(items, null, 2));
  // (기존엔 keyword_ko 오타로 한국어 키워드가 전달되지 않았음)
  fs.writeFileSync(path.join(runDir, 'keywords-list.txt'),
    items.map((k) => [k.id, k.keyword, k.en || k.keyword, k.keywordKo || k.keyword].join('|')).join('\n') + (items.length ? '\n' : ''));
}

async function runSelect(a) {
  // AIWIKI_KEYWORDS_FILE: 키워드 목록을 직접 지정 (예: 이전 실행에서 생성 실패한 후보 재시도). LLM 선정을 건너뛴다.
  if (process.env.AIWIKI_KEYWORDS_FILE) {
    const have = existingIds();
    const items = JSON.parse(readText(process.env.AIWIKI_KEYWORDS_FILE, '[]'))
      .filter((k) => k && k.id && !have.has(k.id)).slice(0, a.max);
    writeSelection(a.runDir, items);
    log(`  키워드 목록 파일 사용 (LLM 선정 생략): ${items.length}개`);
    process.stdout.write(String(items.length));
    return;
  }
  let prompt = fill(readText(path.join(PROMPTS, 'keyword-select.md')), {
    TRENDS_JSON: readText(path.join(a.runDir, 'trends.json'), '{}'),
    DISCOVERY_JSON: readText(path.join(a.runDir, 'discovery.json'), '{}'),
    KEYWORDS_INDEX: readText(path.join(WORK_DIR, 'keywords-index.txt')),
  });
  // 이전 실행에서 선정됐지만 생성에 실패한 후보 (AIWIKI_BACKLOG_FILE) — 재검토 대상으로 함께 넘긴다
  const backlog = process.env.AIWIKI_BACKLOG_FILE ? readText(process.env.AIWIKI_BACKLOG_FILE) : '';
  if (backlog.trim()) {
    prompt += `\n\n## 이전 실행에서 선정됐지만 생성에 실패한 후보 (재검토 대상)\n${backlog}\n`
      + '위 후보도 같은 선정·품질 기준으로 다시 판단하라. 지금도 유효하고, 이후 나온 후속 버전에 묻히지 않았으며, 기존 키워드와 겹치지 않는 것만 items에 포함한다.\n';
  }
  const r = await callWithRetry(prompt, SELECT_SCHEMA, CFG.select, '키워드 선정');
  if (!r.ok) { log('키워드 선정 실패'); process.exit(1); }

  const have = existingIds();
  const seen = new Set();
  // 모델 출시 카드가 대부분을 차지하지 않도록 실행 1회당 모델 수를 제한 (AIWIKI_MAX_MODEL_KEYWORDS, 기본 1)
  const maxModels = parseInt(env('AIWIKI_MAX_MODEL_KEYWORDS', '1'), 10);
  let models = 0;
  const items = (r.data.items || [])
    .map((k) => ({ ...k, id: String(k.id || '').trim().toLowerCase() }))
    .filter((k) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(k.id) && !have.has(k.id) && !seen.has(k.id) && seen.add(k.id))
    .filter((k) => k.kind !== 'model' || models++ < maxModels)
    .slice(0, a.max);

  writeSelection(a.runDir, items);
  if ((r.data.items || []).length > items.length) log(`  선정 ${r.data.items.length}개 → 중복/형식/모델 상한(${maxModels})/전체 상한(${a.max}) 필터 후 ${items.length}개`);
  log(`  선정 결과: ${items.map((k) => `${k.id}(${k.kind})`).join(', ') || '없음'}`);
  process.stdout.write(String(items.length));
}

// ── Stage 4: 콘텐츠 생성 + 번역 ──
const CONTENT_SCHEMA = {
  type: 'object',
  properties: {
    skip: { type: 'boolean' },
    skip_reason: { type: 'string' },
    id: { type: 'string' },
    t: { type: 'string' },
    en: { type: 'string' },
    c: { type: 'string', enum: CATS },
    born: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    sum: { type: 'string' },
    det: { type: 'string' },
    rel: { type: 'array', items: { type: 'string' } },
    refs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, url: { type: 'string' }, type: { type: 'string', enum: ['official', 'blog', 'paper', 'tutorial'] } },
        required: ['title', 'url', 'type'],
      },
    },
    videos: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, id: { type: 'string' }, lang: { type: 'string', enum: ['en', 'ko'] } },
        required: ['title', 'id', 'lang'],
      },
    },
    hot: { type: 'boolean' },
  },
  required: ['skip', 'id', 't', 'en', 'c', 'born', 'tags', 'sum', 'det', 'rel', 'refs', 'videos', 'hot'],
};

const LANG_PART = { type: 'object', properties: { sum: { type: 'string' }, det: { type: 'string' } }, required: ['sum', 'det'] };
const { I18N_LANGS } = require('./i18n-meta');
const TRANSLATE_SCHEMA = { type: 'object', properties: Object.fromEntries(I18N_LANGS.map((l) => [l, LANG_PART])), required: I18N_LANGS };

function loadData() {
  const src = fs.readFileSync(path.join(WORK_DIR, 'data.js'), 'utf8').replace(/^const /gm, 'var ');
  const sandbox = {};
  new Function('sandbox', `${src}; sandbox.D = D; sandbox.I = I18N_CONTENT;`)(sandbox);
  return sandbox;
}
const loadEntries = () => loadData().D;

// 본문 작성 기준(det-style.md) — 새 글 생성과 기존 글 변환이 공유. 주석 제거 후 모범 예시를 채운다.
function detStyle(example) {
  const raw = readText(path.join(PROMPTS, 'det-style.md')).replace(/<!--[\s\S]*?-->\n?/g, '');
  return fill(raw, { EXAMPLE_DET: example });
}

// 프롬프트에 넣을 모범 det (구성·톤 기준). 섹션 제목을 그대로 베끼지 않도록 프롬프트에서 따로 지시한다.
function exampleDet() {
  try {
    const e = loadEntries().find((x) => x.id === 'gpt-6-sol'); // 2026-10 개편 기준 문서 (한눈에 보기 + 표·그래프)
    return e ? e.det : '';
  } catch (e) { return ''; }
}

async function runContent(a) {
  const selected = JSON.parse(readText(path.join(a.runDir, 'keywords-selected.json'), '[]'));
  const contentTpl = readText(path.join(PROMPTS, 'content-generate.md'));
  const translateTpl = readText(path.join(PROMPTS, 'translate.md'));
  const index = readText(path.join(WORK_DIR, 'keywords-index.txt'));
  const have = existingIds();
  const example = exampleDet();
  const results = [];
  const stat = { ok: 0, fail: 0, skip: 0, cost: 0 };

  await pool(selected, a.parallel, async (item) => {
    const id = item.id;
    const dir = path.join(a.runDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const sources = JSON.parse(readText(path.join(dir, 'sources.json'), '{}'));
    const prompt = fill(contentTpl, {
      SOURCES_DATA: JSON.stringify([{ keyword: item, sources }], null, 2),
      KEYWORDS_INDEX: index,
      DET_STYLE: detStyle(example),
    });

    const r = await callWithRetry(prompt, CONTENT_SCHEMA, CFG.content, `본문 ${id}`);
    if (!r.ok) { stat.fail++; return; }
    stat.cost += r.cost;
    const entry = r.data;
    fs.writeFileSync(path.join(dir, 'content-raw.json'), JSON.stringify(entry, null, 2));

    if (entry.skip) { stat.skip++; log(`  skip ${id}: ${entry.skip_reason || '(사유 없음)'}`); return; }
    const len = textLen(entry.det);
    if (len < THIN_THRESHOLD) { stat.skip++; log(`  skip ${id}: 본문 ${len}자 (< ${THIN_THRESHOLD}, 품질 게이트)`); return; }

    entry.id = id; // 선정 단계 id로 고정
    entry.rel = (entry.rel || []).filter((x) => have.has(x)).slice(0, 8);
    entry.refs = (entry.refs || []).filter((r) => !/youtube\.com|youtu\.be/.test(r.url)).slice(0, 5); // 영상은 videos에만
    delete entry.skip; delete entry.skip_reason;

    const tr = await callWithRetry(
      fill(translateTpl, { TITLE: `${entry.t} (${entry.en})`, SUM: entry.sum, DET: entry.det }),
      TRANSLATE_SCHEMA, CFG.translate, `번역 ${id}`);
    if (tr.ok) { entry.translations = tr.data; stat.cost += tr.cost; }
    else log(`  WARN ${id}: 번역 실패 — 한국어만 반영`);

    fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify(entry, null, 2));
    results.push(entry);
    stat.ok++;
    log(`  ✓ ${id} (본문 ${len}자)`);
  });

  // 선정 순서 유지
  const order = new Map(selected.map((k, i) => [k.id, i]));
  results.sort((x, y) => order.get(x.id) - order.get(y.id));
  fs.writeFileSync(path.join(a.runDir, 'content.json'), JSON.stringify(results, null, 2));
  log(`  Stage 4 요약: 성공 ${stat.ok} / 스킵 ${stat.skip} / 실패 ${stat.fail} · 비용 $${stat.cost.toFixed(2)}`);
  process.stdout.write(JSON.stringify(stat));
}

// ── 기존 항목 번역만 재생성 (본문을 심화한 뒤 옛 번역을 갱신할 때) ──
async function runTranslate(a) {
  const { D, I } = loadData();
  let ids = String(a.ids || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (a.stale) {
    // 공개 항목(본문 1000자 이상) 중 번역이 없거나, 번역 당시와 한국어 sum+det가 달라진 것
    const { koHash, loadMeta } = require('./i18n-meta');
    const meta = loadMeta();
    ids = D.filter((e) => textLen(e.det) >= THIN_THRESHOLD)
      .filter((e) => !I18N_LANGS.every((l) => I[l] && I[l][e.id]) || meta[e.id] !== koHash(e))
      .map((e) => e.id)
      .slice(0, a.limit || 60); // 1회 상한 (매일 실행 안전장치, 대량 작업은 --limit으로)
    log(`  번역 동기화 대상: ${ids.length}개${ids.length ? ` (${ids.join(', ')})` : ''}`);
  }
  const tpl = readText(path.join(PROMPTS, 'translate.md'));
  fs.mkdirSync(a.out, { recursive: true });
  const stat = { ok: 0, fail: 0 };
  await pool(ids, a.parallel, async (id) => {
    const e = D.find((x) => x.id === id);
    if (!e) { log(`  ! ${id}: 항목 없음`); stat.fail++; return; }
    const sum = String(e.sum || '').replace(/<[^>]+>/g, '');
    const r = await callWithRetry(fill(tpl, { TITLE: `${e.t} (${e.en || e.t})`, SUM: sum, DET: e.det }), TRANSLATE_SCHEMA, CFG.translate, `번역 ${id}`);
    if (!r.ok) { stat.fail++; return; }
    fs.writeFileSync(path.join(a.out, `${id}.json`), JSON.stringify({ id, translations: r.data }));
    stat.ok++;
  });
  log(`  번역 요약: 성공 ${stat.ok} / 실패 ${stat.fail}`);
  process.stdout.write(JSON.stringify(stat));
}

// ── 기존 글을 현재 작성 기준으로 다시 쓰기 (기존 본문의 사실만 사용) ──
const RESTYLE_SCHEMA = { type: 'object', properties: { sum: { type: 'string' }, det: { type: 'string' } }, required: ['sum', 'det'] };

async function runRestyle(a) {
  const D = loadEntries();
  const ids = String(a.ids || '').split(',').map((x) => x.trim()).filter(Boolean);
  const tpl = readText(path.join(PROMPTS, 'restyle.md'));
  const style = detStyle(exampleDet());
  fs.mkdirSync(a.out, { recursive: true });
  const stat = { ok: 0, fail: 0, retried: 0 };
  await pool(ids, a.parallel, async (id) => {
    const e = D.find((x) => x.id === id);
    if (!e) { log(`  ! ${id}: 항목 없음`); stat.fail++; return; }
    // 원문 길이에 맞춘 분량 지시 — 이미 짧은 글까지 '압축'하면 공개 기준(1,000자) 아래로 떨어진다
    const origLen = textLen(e.det);
    const lengthGuide = origLen >= 1800
      ? `기존 본문은 ${origLen}자로 길다. 독자에게 정말 필요한 내용만 남겨 1,100~1,500자로 줄인다.`
      : `기존 본문은 ${origLen}자로 이미 짧다. 내용을 덜어내지 말고 구성(한눈에 보기·표·짧은 문단)만 바꿔서 1,100~1,400자를 유지한다. ${THIN_THRESHOLD}자 미만이 되면 사이트에 공개되지 않는다.`;
    const prompt = fill(tpl, { DET_STYLE: style, TITLE: `${e.t} (${e.en || e.t})`, SUM: String(e.sum || '').replace(/<[^>]+>/g, ''), DET: e.det, LENGTH_GUIDE: lengthGuide });
    let r = await callWithRetry(prompt, RESTYLE_SCHEMA, CFG.content, `변환 ${id}`);
    if (!r.ok) { stat.fail++; return; }
    let len = textLen(r.data.det);
    if (len < THIN_THRESHOLD) {
      // 너무 짧으면(공개 기준 미달) 길이를 알려주고 한 번 더 — 원문의 사용법·예시를 더 살리게 한다
      log(`  ↻ ${id}: ${len}자로 짧아 재시도`);
      stat.retried++;
      const retry = prompt + `\n\n## 다시 쓰기 요청\n직전 결과는 태그를 뺀 텍스트가 ${len}자로 너무 짧았다. 이 사이트는 ${THIN_THRESHOLD}자 미만이면 공개되지 않는다. 기존 본문에서 사용법·구체적 예시·선택 기준을 더 살려 1,150~1,400자로 다시 써라. 새로운 사실을 지어내지는 마라.`;
      const r2 = await callWithRetry(retry, RESTYLE_SCHEMA, CFG.content, `변환 재시도 ${id}`);
      if (r2.ok) { r = r2; len = textLen(r.data.det); }
    }
    const problems = [];
    if (len < THIN_THRESHOLD) problems.push(`본문 ${len}자`);
    if (!/^\s*<h4>한눈에 보기<\/h4>/.test(r.data.det)) problems.push('첫 섹션이 한눈에 보기가 아님');
    if (/<(ul|ol|li)[ >]/.test(r.data.det)) problems.push('글머리표 사용');
    if (problems.length) { log(`  ✗ ${id}: ${problems.join(', ')} — 반영 안 함`); stat.fail++; return; }
    fs.writeFileSync(path.join(a.out, `${id}.json`), JSON.stringify({ id, sum: r.data.sum, det: r.data.det }));
    log(`  ✓ ${id} (${textLen(e.det)}자 → ${len}자)`);
    stat.ok++;
  });
  log(`  변환 요약: 성공 ${stat.ok} / 실패 ${stat.fail} / 길이 재시도 ${stat.retried}`);
  process.stdout.write(JSON.stringify(stat));
}

(async () => {
  const a = parseArgs(process.argv.slice(2));
  const ok = (a.mode === 'translate' && (a.ids || a.stale) && a.out) || (a.mode === 'restyle' && a.ids && a.out) || (a.runDir && ['select', 'content'].includes(a.mode));
  if (!ok) {
    console.error('usage: node scripts/llm-stage.js <select|content> --run-dir DIR [--max N] [--parallel N]\n       node scripts/llm-stage.js translate --ids a,b --out DIR [--parallel N]');
    process.exit(2);
  }
  if (a.mode === 'select') await runSelect(a);
  else if (a.mode === 'content') await runContent(a);
  else if (a.mode === 'restyle') await runRestyle(a);
  else await runTranslate(a);
})();
