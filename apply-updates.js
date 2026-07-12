#!/usr/bin/env node
// 기존 D 항목의 det(상세 본문)를 심화된 내용으로 안전하게 교체한다.
// 재직렬화 없이 det 백틱 문자열만 외과적으로 치환하고, updated 날짜를 갱신한다.
// I18N_CONTENT(번역 블록)는 절대 건드리지 않는다.
//
// 사용법: node apply-updates.js <updatesDir>
//   updatesDir 안의 각 *.json = {"id":"vibe-coding","det":"<h4>...</h4>..."}
//   (선택) "sum" 필드가 있으면 sum도 교체한다.

const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) { console.error('usage: node apply-updates.js <updatesDir>'); process.exit(1); }

const escBacktick = s => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
const escSingle = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const today = new Date().toISOString().slice(0, 10);
const DATA = path.join(__dirname, 'data.js');

// 백틱 문자열의 끝(이스케이프 \` 고려)을 찾는다.
function findBacktickEnd(s, contentStart) {
  let i = contentStart;
  while (i < s.length) {
    if (s[i] === '\\') { i += 2; continue; }
    if (s[i] === '`') return i;
    i++;
  }
  return -1;
}

function replaceDet(src, entryStart, entryEnd, newDet) {
  const k = src.indexOf('det:`', entryStart);
  if (k < 0 || k > entryEnd) return null;
  const cEnd = findBacktickEnd(src, k + 5);
  if (cEnd < 0 || cEnd > entryEnd) return null;
  const newLit = 'det:`' + escBacktick(newDet) + '`';
  return src.slice(0, k) + newLit + src.slice(cEnd + 1);
}

function replaceUpdated(src, entryStart, entryEnd) {
  // 엔트리 블록 내 updated:'...' 교체 (있을 때만)
  const block = src.slice(entryStart, entryEnd);
  const m = block.match(/updated:'[^']*'/);
  if (!m) return src;
  const abs = entryStart + m.index;
  return src.slice(0, abs) + `updated:'${today}'` + src.slice(abs + m[0].length);
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
let src = fs.readFileSync(DATA, 'utf8');
let applied = 0;
const failed = [];

for (const f of files) {
  const u = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (!u.id || !u.det) { failed.push(`${f} (id/det 누락)`); continue; }

  // 매 반복마다 경계 재계산 (src가 변하므로)
  const dStart = src.indexOf('const D = [');
  const i18nStart = src.indexOf('const I18N_CONTENT');
  const idMarker = `{id:'${u.id}',`;
  const entryStart = src.indexOf(idMarker, dStart);
  if (entryStart < 0 || entryStart > i18nStart) { failed.push(`${u.id} (엔트리 못찾음)`); continue; }
  // 엔트리 끝 = 다음 엔트리 시작 직전, 없으면 I18N 직전
  let entryEnd = src.indexOf('\n  {id:', entryStart + 1);
  if (entryEnd < 0 || entryEnd > i18nStart) entryEnd = i18nStart;

  const detLen = (u.det || '').replace(/<[^>]+>/g, '').length;
  if (detLen < 700) { failed.push(`${u.id} (심화 부족: ${detLen}자)`); continue; }

  const replaced = replaceDet(src, entryStart, entryEnd, u.det);
  if (!replaced) { failed.push(`${u.id} (det 치환 실패)`); continue; }
  src = replaced;

  // updated 갱신 (경계 재계산 후)
  const eStart2 = src.indexOf(idMarker, src.indexOf('const D = ['));
  let eEnd2 = src.indexOf('\n  {id:', eStart2 + 1);
  const i18n2 = src.indexOf('const I18N_CONTENT');
  if (eEnd2 < 0 || eEnd2 > i18n2) eEnd2 = i18n2;
  src = replaceUpdated(src, eStart2, eEnd2);

  applied++;
  console.log(`  ✓ ${u.id} (det ${detLen}자)`);
}

// LAST_UPDATED 갱신
src = src.replace(/^const LAST_UPDATED = '[^']*';/m, `const LAST_UPDATED = '${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}';`);

fs.writeFileSync(DATA, src);
console.log(`\n적용 ${applied}건` + (failed.length ? `, 실패 ${failed.length}건:\n  - ${failed.join('\n  - ')}` : ''));

// 구문 검증: 수정된 data.js가 정상 eval 되는지
try {
  const chk = fs.readFileSync(DATA, 'utf8').replace(/^const /gm, 'var ');
  eval(chk);
  console.log(`✓ data.js 구문 검증 통과 (D=${D.length}, I18N=${Object.keys(I18N_CONTENT).length}개 언어)`);
} catch (e) {
  console.error('✗ data.js 구문 오류! 되돌리세요:', e.message);
  process.exit(1);
}
