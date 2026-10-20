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
  content:   { model: env('AIWIKI_CONTENT_MODEL', 'opus'),     effort: env('AIWIKI_CONTENT_EFFORT', 'medium'), timeout: 900 }, // 소스가 긴 키워드에서 600초 2회 timeout으로 유실되던 것
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
    // 오늘 트렌드에서 화제인 키워드 id (기존 위키 id + 오늘 선정 id) — HOT 표식
    hot: { type: 'array', items: { type: 'string' } },
    // 선정하지 않은 주요 후보와 사유 — 실행 기록 + 다음 실행 재검토용
    rejected: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } }, required: ['name', 'reason'] },
    },
  },
  required: ['items', 'rejected', 'hot'],
};

// LLM이 낸 id를 kebab-case로 정규화 (claude-opus-4.9 → claude-opus-4-9). 버리는 대신 고친다
const normId = (id) => String(id || '').trim().toLowerCase().replace(/[._\s/:+]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');

// 대기열 갱신: 기존 대기열 + 오늘 선정분을 합치고, 위키에 들어간 것·명시적으로 탈락한 것·만료된 것만 뺀다
function saveQueue(prev, valid, rejectedNames) {
  const today = new Date().toISOString().slice(0, 10);
  const out = new Map(prev.filter((k) => !rejectedNames.has(String(k.keyword || '').toLowerCase()) && !rejectedNames.has(String(k.en || '').toLowerCase()) && !rejectedNames.has(k.id)).map((k) => [k.id, k]));
  for (const { id, keyword, keywordKo, en, kind } of valid) out.set(id, { id, keyword, keywordKo, en, kind, queued: (out.get(id) || {}).queued || today });
  fs.writeFileSync(QUEUE_FILE, JSON.stringify([...out.values()], null, 2));
  return out.size;
}

// 선정 대기열: 선정됐지만 일일 상한으로 밀렸거나 생성에 실패해 아직 위키에 없는 후보.
// 다음 실행 선정에 우선 재검토 대상으로 넘기고, 위키에 들어가면 빠진다 (21일 지나면 만료)
const QUEUE_FILE = path.join(WORK_DIR, 'logs', 'keyword-queue.json');
const QUEUE_TTL_DAYS = 21;
function loadQueue(have) {
  const cutoff = new Date(Date.now() - QUEUE_TTL_DAYS * 86400000).toISOString().slice(0, 10);
  let q = [];
  try { q = JSON.parse(readText(QUEUE_FILE, '[]')); } catch (e) {}
  return q.filter((k) => k && k.id && !have.has(k.id) && (k.queued || '') >= cutoff);
}

// ── 선정 입력 압축 ──
// 발굴 기간이 길면 레포·모델이 수백 개라 JSON 그대로 넘기면 프롬프트가 수십만 자가 되고 선정 품질이 떨어진다
// (2026-10-19 백필: 450KB → 빈 키워드·기존 카드 하위 기능 선정). 한 줄 요약으로 넘기고, 레포는 star 상위만 나열하되
// 이름 반복(생태계 신호)은 전체 레포·트렌드에서 코드로 집계해 함께 넘긴다.
const REPO_LIST_MAX = 300;
const ECO_STOP = new Set(('ai agent agents claude code coding codex gemini gpt openai llm llms mcp server servers cli tool tools skill skills '
  + 'the for and with your you app apps api sdk kit open source desktop web chat bot plugin plugins memory model models prompt prompts '
  + 'local auto data team based use using new run runner workflow workflows cursor anthropic google github repo project build builder '
  + 'manager hub lab labs dev hook hooks config template templates context browser search assistant toolkit framework '
  + 'first work any free pro not native multi video image design usage token tokens studio research control session sessions windows mac macos '
  + 'android ios rust git flash show one all that this from into own ever are out too her see per top act era men ant mini more best '
  + 'fast faster simple easy smart full real just like make made get can will how what why when who all its now than then them they '
  + 'via lets let help helps want need also only each every other some most many much over under about after before without within '
  + 'file files text voice audio game games mobile cloud docker python typescript javascript node react swift linux terminal shell '
  + 'version release launch launches introducing announces support update updates guide review vs '
  + 'deepseek live read time zero system start machine learning through builds runs give across software interactive plan turn').split(' '));
// 흔한 단어의 조각(agen ⊂ agent, dex ⊂ codex, clau ⊂ claude)도 일반어로 본다
const isStopFragment = (tok) => ECO_STOP.has(tok) || [...ECO_STOP].some((w) => w.length > tok.length && w.includes(tok));
function ecosystemSignals(names) {
  // names: [{label, name, text}] — name은 레포 이름(조각 단위 비교), text는 설명·글 제목(단어 단위 비교)
  const segs = (str) => String(str || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const rows = names.map((n) => ({ ...n, segs: segs(n.name), words: new Set(segs(n.text)) }));
  const cand = new Set();
  // 후보: 레포 이름 조각 + 설명·제목 단어 ("Jev picks who answers"처럼 이름이 붙은 레포가 아니어도 잡히게)
  for (const r of rows) for (const p of [...r.segs, ...r.words]) if (p.length >= 3 && !isStopFragment(p) && !/^\d+$/.test(p)) cand.add(p);
  // 레포 이름 조각의 앞·뒤에 붙은 경우(jevgrep, ohmyjev)와 설명·제목의 단어로 나온 경우를 센다
  const hit = (r, tok) => r.segs.some((g) => g === tok || g.startsWith(tok) || g.endsWith(tok)) || r.words.has(tok);
  const maxHits = Math.max(8, Math.round(rows.length * 0.03)); // 이보다 흔하면 일반 단어
  const inName = (r, tok) => r.segs.some((g) => g === tok || g.startsWith(tok) || g.endsWith(tok));
  const out = [];
  for (const tok of cand) {
    const hits = rows.filter((r) => hit(r, tok));
    if (hits.length < 3 || hits.length > maxHits) continue;
    // 이름다운 것만: 레포 이름에 2번 이상, 또는 레포 이름 1번 + 커뮤니티 글 제목 1번 이상 (설명문에만 나오는 건 일반 단어)
    const nameHits = rows.filter((r) => r.name && inName(r, tok)).length;
    const trendHits = hits.filter((r) => !r.name).length;
    if (nameHits >= 2 || (nameHits >= 1 && trendHits >= 1)) out.push({ tok, n: hits.length, ex: hits.slice(0, 6).map((h) => h.label) });
  }
  // 긴 토큰이 짧은 토큰과 같은 항목들을 가리키면(예: jevgrep ⊂ jev) 짧은 쪽만 남긴다
  return out.sort((x, y) => y.n - x.n).filter((x, i, arr) => !arr.some((y) => y !== x && x.tok.includes(y.tok) && y.n >= x.n)).slice(0, 30);
}
function compactDiscovery(raw) {
  let d; try { d = JSON.parse(raw); } catch (e) { return raw; }
  const repos = (d.repos || []).slice().sort((a, b) => b.stars - a.stars);
  const lines = [`기간: ${d.since || '?'} 이후 (${d.generatedDays || '?'}일)`, '', `### models (${(d.models || []).length}개, 최신순)`];
  for (const m of d.models || []) lines.push(`- ${m.name} [${m.id}] ${m.date}${m.knownFamily ? '' : ' ★신규계열'}`);
  lines.push('', `### repos (${repos.length}개 중 star 상위 ${Math.min(REPO_LIST_MAX, repos.length)}개)`);
  for (const r of repos.slice(0, REPO_LIST_MAX)) lines.push(`- ${r.full_name} ★${r.stars} (${r.created}): ${r.desc}`);
  lines.push('', '### features');
  for (const f of d.features || []) lines.push(`- ${f.name}: ${f.summary}`);
  return { text: lines.join('\n'), repos };
}
function compactTrends(raw) {
  let t; try { t = JSON.parse(raw); } catch (e) { return { text: raw, items: [] }; }
  const items = [];
  const lines = [];
  const add = (label, list, fmt) => {
    if (!Array.isArray(list) || !list.length) return;
    lines.push('', `### ${label} (${list.length})`);
    for (const x of list) { lines.push(`- ${fmt(x)}`); items.push(x.title || ''); }
  };
  add('hackernews', t.hackernews, (x) => `${x.title} (${x.score || 0}점)`);
  add('reddit', t.reddit, (x) => `${x.title}${x.snippet ? ` — ${String(x.snippet).slice(0, 160)}` : ''}`);
  add('geeknews /new', t.geeknews, (x) => `${x.title} (${x.points || 0}점)`);
  add('geeknews 주간뉴스', (t.geeknews_weekly || {}).items, (x) => x.title);
  if (t.backfill) {
    lines.push('', `## backfill (${t.backfill.since} 이후 — 실행이 밀린 기간)`);
    add('HN 주간 상위', t.backfill.hackernews, (x) => `${x.date} ${x.title} (${x.score}점)`);
    for (const w of t.backfill.geeknews_weekly || []) add(`GeekNews 주간뉴스 ${w.id}`, w.items, (x) => x.title);
  }
  return { text: lines.join('\n').trim(), items };
}

// 같은 runs/ 아래 최근 N일 실행 디렉토리 (현재 실행 제외, 오래된 순)
function recentRunDirs(runDir, days) {
  const root = path.dirname(path.resolve(runDir));
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  let names = [];
  try { names = fs.readdirSync(root); } catch (e) { return []; }
  return names.filter((n) => /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(n) && n.slice(0, 10) >= since && n !== path.basename(path.resolve(runDir)))
    .sort().map((n) => path.join(root, n));
}

// 최근 실행들의 탈락 후보를 이름별로 묶는다 (반복 탈락 = 화제가 계속된다는 신호)
function rejectedHistory(runDir, days) {
  const byName = new Map();
  for (const dir of recentRunDirs(runDir, days)) {
    let list = [];
    try { list = JSON.parse(readText(path.join(dir, 'keywords-rejected.json'), '[]')); } catch (e) {}
    for (const r of list) {
      const key = String(r.name || '').trim().toLowerCase();
      if (!key) continue;
      const cur = byName.get(key) || { name: r.name, count: 0 };
      cur.count++; cur.reason = r.reason; cur.last = path.basename(dir).slice(0, 10);
      byName.set(key, cur);
    }
  }
  return [...byName.values()].sort((x, y) => y.count - x.count);
}

// catch-up: 최근 N일 실행의 트렌드를 합친다 (url·제목 기준 중복 제거). 실행이 밀렸을 때 놓친 화제를 다시 본다
function mergedTrends(runDir, days) {
  const out = JSON.parse(readText(path.join(runDir, 'trends.json'), '{}'));
  for (const dir of recentRunDirs(runDir, days).reverse()) {
    let t;
    try { t = JSON.parse(readText(path.join(dir, 'trends.json'), '{}')); } catch (e) { continue; }
    for (const [k, v] of Object.entries(t)) {
      if (!Array.isArray(v)) continue;
      const list = Array.isArray(out[k]) ? out[k] : (out[k] = []);
      const seen = new Set(list.map((x) => x.url || x.title));
      for (const x of v) if (!seen.has(x.url || x.title)) { seen.add(x.url || x.title); list.push(x); }
    }
  }
  return JSON.stringify(out, null, 2);
}

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
    const valid = JSON.parse(readText(process.env.AIWIKI_KEYWORDS_FILE, '[]'))
      .map((k) => k && { ...k, id: normId(k.id) }).filter((k) => k && k.id && !have.has(k.id));
    const items = valid.slice(0, a.max);
    writeSelection(a.runDir, items);
    fs.writeFileSync(path.join(a.runDir, 'hot-ids.json'), JSON.stringify(items.map((k) => k.id)));
    saveQueue(loadQueue(have), valid, new Set()); // 상한 넘친 지정 키워드도 다음 실행으로
    log(`  키워드 목록 파일 사용 (LLM 선정 생략): ${items.length}개${valid.length > items.length ? ` (${valid.length - items.length}개 대기열)` : ''}`);
    process.stdout.write(String(items.length));
    return;
  }
  // AIWIKI_CATCHUP_DAYS: 밀린 기간의 트렌드를 합쳐서 선정 (발굴 범위는 AIWIKI_DISCOVERY_DAYS로 함께 넓힌다)
  const catchupDays = parseInt(env('AIWIKI_CATCHUP_DAYS', '0'), 10);
  const trends = compactTrends(catchupDays > 0 ? mergedTrends(a.runDir, catchupDays) : readText(path.join(a.runDir, 'trends.json'), '{}'));
  const disc = compactDiscovery(readText(path.join(a.runDir, 'discovery.json'), '{}'));
  const eco = ecosystemSignals([
    ...(disc.repos || []).map((r) => ({ label: `${r.repo}★${r.stars}`, name: r.repo, text: r.desc })),
    ...trends.items.filter(Boolean).map((t) => ({ label: t.slice(0, 50), name: '', text: t })),
  ]);
  const ecoText = eco.length
    ? eco.map((e) => `- "${e.tok}" — ${e.n}건: ${e.ex.join(', ')}`).join('\n')
    : '(없음)';
  let prompt = fill(readText(path.join(PROMPTS, 'keyword-select.md')), {
    TRENDS_JSON: trends.text,
    DISCOVERY_JSON: disc.text || '',
    ECOSYSTEM_SIGNALS: ecoText,
    KEYWORDS_INDEX: readText(path.join(WORK_DIR, 'keywords-index.txt')),
  });
  log(`  선정 입력 ${Math.round(prompt.length / 1000)}K자 · 생태계 신호 ${eco.length}개${eco.length ? ` (${eco.slice(0, 5).map((e) => `${e.tok}:${e.n}`).join(', ')})` : ''}`);
  // 이전 실행에서 선정됐지만 아직 위키에 없는 후보 (대기열 + 수동 지정 AIWIKI_BACKLOG_FILE) — 우선 재검토
  const queue = loadQueue(existingIds());
  let manual = [];
  try { manual = process.env.AIWIKI_BACKLOG_FILE ? JSON.parse(readText(process.env.AIWIKI_BACKLOG_FILE, '[]')) : []; } catch (e) {}
  const backlog = [...queue, ...manual.filter((m) => m && m.id && !queue.some((q) => q.id === m.id))];
  if (backlog.length) {
    prompt += `\n\n## 이전 실행에서 선정됐지만 아직 위키에 없는 후보 (일일 상한으로 밀렸거나 생성 실패)\n${JSON.stringify(backlog.map(({ id, keyword, keywordKo, en, kind, queued }) => ({ id, keyword, keywordKo, en, kind, queued })))}\n`
      + '이미 한 번 선정 기준을 통과한 후보다. 지금도 유효하고, 이후 나온 후속 버전에 묻히지 않았으며, 기존 키워드와 겹치지 않으면 items의 앞쪽(오늘 새 후보보다 우선)에 다시 포함한다.\n';
  }
  if (catchupDays > 0) log(`  catch-up: 최근 ${catchupDays}일 트렌드 합산`);
  // 최근 실행에서 탈락한 후보 — 반복 등장 횟수와 직전 사유를 같이 넘겨 판단을 다시 하게 한다
  const history = rejectedHistory(a.runDir, Math.max(7, catchupDays)).slice(0, 50);
  if (history.length) {
    prompt += `\n\n## 최근 실행에서 탈락한 후보 (재검토 대상)\n${history.map((h) => `- ${h.name} — ${h.count}회 탈락, 마지막 ${h.last}: ${h.reason}`).join('\n')}\n`
      + '여러 번 반복해 탈락한 후보는 그만큼 계속 화제라는 뜻이다. 직전 사유가 지금 기준(특히 중복의 포함 관계, 생태계 신호)으로도 타당한지 다시 판단하고, 타당하지 않으면 items에 포함한다.\n';
  }
  // AIWIKI_SELECT_DRYRUN=1: 프롬프트만 run-dir/select-prompt.md로 저장하고 종료 (입력 점검용, LLM 호출 없음)
  if (process.env.AIWIKI_SELECT_DRYRUN) { fs.writeFileSync(path.join(a.runDir, 'select-prompt.md'), prompt); process.stdout.write('0'); return; }
  const r = await callWithRetry(prompt, SELECT_SCHEMA, CFG.select, '키워드 선정');
  if (!r.ok) { log('키워드 선정 실패'); process.exit(1); }

  const have = existingIds();
  const seen = new Set();
  const rejected = [...(r.data.rejected || [])];
  const valid = [];
  for (const k of r.data.items || []) {
    const id = normId(k.id);
    if (!id) { rejected.push({ name: k.en || k.keyword || String(k.id), reason: `id 형식 오류: ${k.id}` }); continue; }
    // 이름이 비었거나 자리표시자 같은 항목 (구조화 출력이 칸을 채우려고 만든 것)
    if (!String(k.keyword || '').trim() || !String(k.en || '').trim() || /placeholder|^skip|-skip$|tbd|example/.test(id)) {
      log(`  무효 항목 제외: ${id} (keyword="${k.keyword || ''}", en="${k.en || ''}")`); continue;
    }
    if (have.has(id) || seen.has(id)) continue;
    seen.add(id);
    valid.push({ ...k, id });
  }
  // 일일 상한(--max)은 하루 발행량 조절용 — 넘친 후보는 버리지 않고 대기열로 넘긴다
  const items = valid.slice(0, a.max);
  const overflow = valid.slice(a.max);
  const queued = saveQueue(queue, valid, new Set(rejected.map((x) => String(x.name || '').toLowerCase())));

  // HOT: 오늘 화제인 기존 키워드 + 오늘 발행분 중 LLM이 꼽은 것
  const hot = [...new Set((r.data.hot || []).map(normId).filter((id) => have.has(id) || items.some((k) => k.id === id)))];
  fs.writeFileSync(path.join(a.runDir, 'hot-ids.json'), JSON.stringify(hot));
  log(`  HOT ${hot.length}개: ${hot.join(', ') || '(없음)'}`);

  writeSelection(a.runDir, items);
  fs.writeFileSync(path.join(a.runDir, 'keywords-rejected.json'), JSON.stringify(rejected, null, 2));
  if (rejected.length) log(`  탈락 후보 ${rejected.length}개: ${rejected.map((x) => x.name).join(', ')}`);
  if (overflow.length) log(`  일일 상한(${a.max}) 초과 ${overflow.length}개 → 대기열: ${overflow.map((k) => k.id).join(', ')}`);
  log(`  대기열: 오늘 발행 ${items.length}개 외 ${queued - items.length}개가 다음 실행 대기 (logs/keyword-queue.json)`);
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
    const e = loadEntries().find((x) => x.id === 'gpt-6-sol'); // 2026-10 개편 기준 문서 (굵은 핵심 sum + 제목 없는 시작 + 사용처 섹션)
    return e ? `sum: ${e.sum}\ndet: ${e.det}` : '';
  } catch (e) { return ''; }
}

// 형식 검사 (content·restyle·expand·reformat 공통) — 분량 검사는 각 모드가 따로 한다
const formatProblems = (sum, det) => [
  /^\s*<h4>한눈에 보기<\/h4>/.test(det || '') && 'det가 <h4>한눈에 보기</h4>로 시작함 — 요약은 sum이 맡고 det는 제목 없이 바로 시작',
  !/<strong>/.test(sum || '') && 'sum에 <strong>으로 굵게 한 핵심 표현이 없음',
  /<(?!\/?strong>)[^>]*>/.test(sum || '') && 'sum에 <strong> 외의 태그 사용',
  /<(ul|ol|li)[ >]/.test(det || '') && '글머리표(ul/li) 사용 — 표로 바꿀 것',
].filter(Boolean);

async function runContent(a) {
  const selected = JSON.parse(readText(path.join(a.runDir, 'keywords-selected.json'), '[]'));
  const contentTpl = readText(path.join(PROMPTS, 'content-generate.md'));
  const translateTpl = readText(path.join(PROMPTS, 'translate.md'));
  const index = readText(path.join(WORK_DIR, 'keywords-index.txt'));
  const have = existingIds();
  const example = exampleDet();
  const results = [];
  const stat = { ok: 0, fail: 0, skip: 0, cost: 0 };
  // 생성 단계에서 빠진 키워드도 탈락 이력에 남긴다 (다음 선정이 사유를 보고 다시 판단)
  const rejectedPath = path.join(a.runDir, 'keywords-rejected.json');
  const dropped = (item, reason) => {
    let list = [];
    try { list = JSON.parse(readText(rejectedPath, '[]')); } catch (e) {}
    list.push({ name: item.en || item.keyword || item.id, reason: `생성 단계: ${reason}` });
    fs.writeFileSync(rejectedPath, JSON.stringify(list, null, 2));
  };
  // 키워드가 끝날 때마다 content.json을 갱신 — 전체 timeout으로 죽어도 끝난 것은 남는다
  const order = new Map(selected.map((k, i) => [k.id, i]));
  const flush = () => fs.writeFileSync(path.join(a.runDir, 'content.json'),
    JSON.stringify([...results].sort((x, y) => order.get(x.id) - order.get(y.id)), null, 2));

  await pool(selected, a.parallel, async (item) => {
    const id = item.id;
    const dir = path.join(a.runDir, id);
    fs.mkdirSync(dir, { recursive: true });

    // 이전 실행에서 이미 생성됐지만 반영되지 못한 본문(타임아웃·중단)이 있으면 재사용 — 비용·시간 절약
    const prev = recentRunDirs(a.runDir, QUEUE_TTL_DAYS).reverse()
      .map((d) => { try { return JSON.parse(readText(path.join(d, id, 'content.json'), '')); } catch (e) { return null; } })
      .find((e) => e && e.det && textLen(e.det) >= THIN_THRESHOLD);
    if (prev) {
      prev.rel = (prev.rel || []).filter((x) => have.has(x)); // 그사이 바뀐 위키 기준으로 관련 링크 재검증
      fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify(prev, null, 2));
      results.push(prev); flush(); stat.ok++;
      log(`  ✓ ${id} (이전 실행 본문 재사용, ${textLen(prev.det)}자)`);
      return;
    }

    let sources = {};
    try { sources = JSON.parse(readText(path.join(dir, 'sources.json'), '{}')); } catch (e) {}
    // 소스 수집이 실패하면 출처 없는 글을 쓰지 않고 미룬다 (대기열에 남아 다음 실행에서 다시 시도)
    const webCount = Object.values(sources.web || {}).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0); // web: {en:[], ko:[]}
    if (!webCount) {
      stat.skip++; log(`  skip ${id}: 웹 소스 없음 (수집 실패) — 다음 실행으로`); dropped(item, '소스 수집 실패 — 다음 실행 재시도'); return;
    }
    const prompt = fill(contentTpl, {
      SOURCES_DATA: JSON.stringify([{ keyword: item, sources }], null, 2),
      KEYWORDS_INDEX: index,
      DET_STYLE: detStyle(example),
    });

    let r = await callWithRetry(prompt, CONTENT_SCHEMA, CFG.content, `본문 ${id}`);
    if (!r.ok) { stat.fail++; dropped(item, `생성 실패 (${String(r.error || '').slice(0, 80)})`); return; }
    stat.cost += r.cost;
    let entry = r.data;
    fs.writeFileSync(path.join(dir, 'content-raw.json'), JSON.stringify(entry, null, 2));

    if (entry.skip) { stat.skip++; log(`  skip ${id}: ${entry.skip_reason || '(사유 없음)'}`); dropped(item, `skip — ${entry.skip_reason || '사유 없음'}`); return; }
    let len = textLen(entry.det);
    // 분량·형식 검사 (restyle·expand와 같은 기준) — 어긋나면 이유를 알려 주고 한 번 더 쓰게 한다
    const problemsOf = (e) => [
      textLen(e.det) < THIN_THRESHOLD && `본문 ${textLen(e.det)}자 (공개 기준 ${THIN_THRESHOLD}자 미만 — 사용법·주의점을 구체적으로 채워 1,100~1,500자)`,
      ...formatProblems(e.sum, e.det),
    ].filter(Boolean);
    let problems = problemsOf(entry);
    if (problems.length) {
      log(`  ${id}: ${problems.join(', ')} — 재시도`);
      const r2 = await callWithRetry(prompt + `\n\n## 다시 쓰기 요청\n직전 결과의 문제: ${problems.join(' / ')}. 같은 소스로 이 문제만 고쳐 다시 작성하라. 소스에 그만한 내용이 정말 없으면 skip=true.`, CONTENT_SCHEMA, CFG.content, `본문 ${id} (재작성)`, 1);
      if (r2.ok) { stat.cost += r2.cost; if (!r2.data.skip && problemsOf(r2.data).length < problems.length) { entry = r2.data; len = textLen(entry.det); problems = problemsOf(entry); } }
    }
    if (problems.length) { stat.skip++; log(`  skip ${id}: ${problems.join(', ')} — 반영 안 함`); dropped(item, problems.join(', ')); return; }

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
    results.push(entry); flush();
    stat.ok++;
    log(`  ✓ ${id} (본문 ${len}자)`);
  });

  flush(); // 선정 순서 유지
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
    const sum = String(e.sum || ''); // <strong>도 번역본에 그대로 유지
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
      : `기존 본문은 ${origLen}자로 이미 짧다. 내용을 덜어내지 말고 구성(굵은 핵심 sum·표·짧은 문단)만 바꿔서 1,100~1,400자를 유지한다. ${THIN_THRESHOLD}자 미만이 되면 사이트에 공개되지 않는다.`;
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
    problems.push(...formatProblems(r.data.sum, r.data.det));
    if (problems.length) { log(`  ✗ ${id}: ${problems.join(', ')} — 반영 안 함`); stat.fail++; return; }
    fs.writeFileSync(path.join(a.out, `${id}.json`), JSON.stringify({ id, sum: r.data.sum, det: r.data.det }));
    log(`  ✓ ${id} (${textLen(e.det)}자 → ${len}자)`);
    stat.ok++;
  });
  log(`  변환 요약: 성공 ${stat.ok} / 실패 ${stat.fail} / 길이 재시도 ${stat.retried}`);
  process.stdout.write(JSON.stringify(stat));
}

// ── 비공개(본문 1000자 미만) 항목 보강 ──
// 영상·출처·태그는 그대로 두고 sum·det만 새 기준으로 다시 쓴다. 새 검색 없이 기존 본문 + 출처 목록 + 확립된 지식으로 채우고,
// 확실한 내용으로 분량을 못 채우면 skip(비공개 유지). --ids 없으면 비공개 항목 전체(--limit로 개수 제한)
const EXPAND_SCHEMA = { type: 'object', properties: { skip: { type: 'boolean' }, skip_reason: { type: 'string' }, sum: { type: 'string' }, det: { type: 'string' } }, required: ['skip', 'sum', 'det'] };
async function runExpand(a) {
  const D = loadEntries();
  let ids = String(a.ids || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!ids.length) ids = D.filter((e) => textLen(e.det) < THIN_THRESHOLD).map((e) => e.id).slice(0, a.limit || 1000);
  const tpl = readText(path.join(PROMPTS, 'expand.md'));
  const style = detStyle(exampleDet());
  fs.mkdirSync(a.out, { recursive: true });
  const stat = { ok: 0, fail: 0, skip: 0, cost: 0 };
  log(`  보강 대상 ${ids.length}개`);
  await pool(ids, a.parallel, async (id) => {
    const e = D.find((x) => x.id === id);
    if (!e) { log(`  ! ${id}: 항목 없음`); stat.fail++; return; }
    if (fs.existsSync(path.join(a.out, `${id}.json`))) { stat.ok++; return; } // 중단 후 재실행 시 이어서
    const refs = (e.refs || []).map((r) => `- ${r.title} (${r.url})`).join('\n') || '(없음)';
    const prompt = fill(tpl, { DET_STYLE: style, TITLE: `${e.t} (${e.en || e.t})`, SUM: String(e.sum || '').replace(/<[^>]+>/g, ''), DET: e.det, ORIG_LEN: String(textLen(e.det)), REFS: refs });
    let r = await callWithRetry(prompt, EXPAND_SCHEMA, CFG.content, `보강 ${id}`);
    if (!r.ok) { stat.fail++; return; }
    stat.cost += r.cost;
    if (r.data.skip) { stat.skip++; log(`  - ${id}: skip — ${r.data.skip_reason || '사유 없음'}`); return; }
    let len = textLen(r.data.det);
    if (len < THIN_THRESHOLD) {
      log(`  ↻ ${id}: ${len}자로 짧아 재시도`);
      const r2 = await callWithRetry(prompt + `\n\n## 다시 쓰기 요청\n직전 결과는 태그를 뺀 텍스트가 ${len}자였다. ${THIN_THRESHOLD}자 미만이면 공개되지 않는다. 사용법·선택 기준·주의점을 더 구체적으로 채워 1,150~1,400자로 다시 써라. 확실하지 않은 사실은 지어내지 마라.`, EXPAND_SCHEMA, CFG.content, `보강 재시도 ${id}`, 1);
      if (r2.ok) { stat.cost += r2.cost; if (!r2.data.skip) { r = r2; len = textLen(r.data.det); } }
    }
    const problems = [];
    if (len < THIN_THRESHOLD) problems.push(`본문 ${len}자`);
    problems.push(...formatProblems(r.data.sum, r.data.det));
    if (problems.length) { log(`  ✗ ${id}: ${problems.join(', ')} — 반영 안 함`); stat.fail++; return; }
    fs.writeFileSync(path.join(a.out, `${id}.json`), JSON.stringify({ id, sum: r.data.sum, det: r.data.det }));
    log(`  ✓ ${id} (${textLen(e.det)}자 → ${len}자)`);
    stat.ok++;
  });
  log(`  보강 요약: 성공 ${stat.ok} / skip ${stat.skip} / 실패 ${stat.fail} · 비용 $${stat.cost.toFixed(2)}`);
  process.stdout.write(JSON.stringify(stat));
}

// ── 기존 글을 바뀐 형식으로 (2026-10-20): 한눈에 보기 제목 제거 + 굵은 핵심 sum + 마지막 사용처 섹션 ──
// 나머지 섹션은 그대로 두고 앞뒤만 고친다. --ids 없으면 det가 한눈에 보기로 시작하는 공개 항목 전체
const REFORMAT_SCHEMA = { type: 'object', properties: { sum: { type: 'string' }, det: { type: 'string' }, usage_added: { type: 'boolean' } }, required: ['sum', 'det', 'usage_added'] };
async function runReformat(a) {
  const D = loadEntries();
  let ids = String(a.ids || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!ids.length) ids = D.filter((e) => textLen(e.det) >= THIN_THRESHOLD && /^\s*<h4>한눈에 보기<\/h4>/.test(e.det)).map((e) => e.id).slice(0, a.limit || 1000);
  const tpl = readText(path.join(PROMPTS, 'reformat.md'));
  const style = detStyle(exampleDet());
  fs.mkdirSync(a.out, { recursive: true });
  const stat = { ok: 0, fail: 0, usage: 0, cost: 0 };
  log(`  형식 변환 대상 ${ids.length}개`);
  await pool(ids, a.parallel, async (id) => {
    const e = D.find((x) => x.id === id);
    if (!e) { log(`  ! ${id}: 항목 없음`); stat.fail++; return; }
    if (fs.existsSync(path.join(a.out, `${id}.json`))) { stat.ok++; return; } // 중단 후 재실행 시 이어서
    const origLen = textLen(e.det);
    const minLen = Math.max(THIN_THRESHOLD, Math.min(1100, origLen));
    const prompt = fill(tpl, { DET_STYLE: style, TITLE: `${e.t} (${e.en || e.t})`, SUM: e.sum, DET: e.det, ORIG_LEN: String(origLen), MIN_LEN: String(minLen) });
    const problemsOf = (d) => [textLen(d.det) < minLen && `det ${textLen(d.det)}자 (${minLen}자 이상 필요)`, ...formatProblems(d.sum, d.det)].filter(Boolean);
    let r = await callWithRetry(prompt, REFORMAT_SCHEMA, CFG.content, `형식 ${id}`);
    if (!r.ok) { stat.fail++; return; }
    stat.cost += r.cost;
    let problems = problemsOf(r.data);
    if (problems.length) {
      log(`  ↻ ${id}: ${problems.join(', ')} — 재시도`);
      const r2 = await callWithRetry(prompt + `\n\n## 다시 쓰기 요청\n직전 결과의 문제: ${problems.join(' / ')}. 이 문제만 고쳐 다시 출력하라. 사실을 지어내지 마라.`, REFORMAT_SCHEMA, CFG.content, `형식 재시도 ${id}`, 1);
      if (r2.ok) { stat.cost += r2.cost; if (problemsOf(r2.data).length < problems.length) { r = r2; problems = problemsOf(r.data); } }
    }
    if (problems.length) { log(`  ✗ ${id}: ${problems.join(', ')} — 반영 안 함`); stat.fail++; return; }
    if (r.data.usage_added) stat.usage++;
    fs.writeFileSync(path.join(a.out, `${id}.json`), JSON.stringify({ id, sum: r.data.sum, det: r.data.det }));
    log(`  ✓ ${id} (${origLen}자 → ${textLen(r.data.det)}자${r.data.usage_added ? ', 사용처 추가' : ''})`);
    stat.ok++;
  });
  log(`  형식 변환 요약: 성공 ${stat.ok} / 실패 ${stat.fail} / 사용처 추가 ${stat.usage}`);
  process.stdout.write(JSON.stringify(stat));
}

(async () => {
  const a = parseArgs(process.argv.slice(2));
  const ok = (a.mode === 'translate' && (a.ids || a.stale) && a.out) || (a.mode === 'restyle' && a.ids && a.out) || (a.mode === 'expand' && a.out) || (a.mode === 'reformat' && a.out) || (a.runDir && ['select', 'content'].includes(a.mode));
  if (!ok) {
    console.error('usage: node scripts/llm-stage.js <select|content> --run-dir DIR [--max N] [--parallel N]\n       node scripts/llm-stage.js translate --ids a,b --out DIR [--parallel N]');
    process.exit(2);
  }
  if (a.mode === 'select') await runSelect(a);
  else if (a.mode === 'content') await runContent(a);
  else if (a.mode === 'restyle') await runRestyle(a);
  else if (a.mode === 'expand') await runExpand(a);
  else if (a.mode === 'reformat') await runReformat(a);
  else await runTranslate(a);
})();
