// 번역 동기화 메타 — 번역할 때 쓴 한국어 sum+det의 해시를 i18n-meta.json에 기록한다.
// 본문이 바뀌면 해시가 달라지므로, 낡은 번역을 정확히 찾아낼 수 있다.
// apply-entries.js(신규 항목)·apply-updates.js(번역 교체)가 기록하고,
// llm-stage.js translate --stale이 읽어 번역이 없거나 낡은 공개 항목만 다시 번역한다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const META_PATH = path.join(__dirname, '..', 'i18n-meta.json');

// 번역 대상 언어 (2026-10-10 사용자 결정: 영어만). 실행기·apply-entries·apply-updates·동기화 판정이 모두 이 값을 따른다.
const I18N_LANGS = ['en'];

function koHash(entry) {
  return crypto.createHash('sha1').update(`${entry.sum || ''}\n${entry.det || ''}`).digest('hex').slice(0, 12);
}

function loadMeta() {
  try { return JSON.parse(fs.readFileSync(META_PATH, 'utf8')); } catch (e) { return {}; }
}

function saveMeta(meta) {
  const sorted = Object.fromEntries(Object.keys(meta).sort().map((k) => [k, meta[k]]));
  fs.writeFileSync(META_PATH, JSON.stringify(sorted, null, 1) + '\n');
}

// 번역을 갱신한 항목들의 현재 한국어 해시를 기록
function recordTranslated(entries) {
  if (!entries.length) return;
  const meta = loadMeta();
  for (const e of entries) meta[e.id] = koHash(e);
  saveMeta(meta);
}

module.exports = { koHash, loadMeta, saveMeta, recordTranslated, META_PATH, I18N_LANGS };
