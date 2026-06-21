#!/bin/bash
# AI Wiki daily scheduler — 2-stage pipeline (shell + Claude --print)
# Called by launchd: ~/Library/LaunchAgents/com.aiwiki.daily.plist

set -euo pipefail

# --- Config ---
WORK_DIR="/Users/hh/dev/ai-wikipedia.github.io"
LOG="$WORK_DIR/logs/daily.log"
ERR_LOG="$WORK_DIR/logs/daily-err.log"
LOCK="/tmp/aiwiki-daily.lock"
CLAUDE="/Users/hh/.local/bin/claude"
TIMEOUT_SEC=1800  # 30분 (전체 watchdog)
STAGE_TIMEOUT=600  # 10분 (Claude --print 개별 timeout)
MAIN_PID=$$

# --- Environment ---
source /Users/hh/.zshrc 2>/dev/null || true
export PATH="/Users/hh/.nvm/versions/node/v24.14.0/bin:/Users/hh/.local/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/Users/hh"
cd "$WORK_DIR"

# --- Claude 인증 (헤드리스용 장기 토큰) ---
# 대화형 로그인(키체인 OAuth)은 launchd 컨텍스트에서 401로 거부되므로,
# `claude setup-token`으로 발급한 장기 토큰을 .env(CLAUDE_CODE_OAUTH_TOKEN)에서 주입한다.
if [ -f "$WORK_DIR/.env" ]; then
  TOKEN_LINE=$(grep -E '^CLAUDE_CODE_OAUTH_TOKEN=' "$WORK_DIR/.env" 2>/dev/null | tail -1 || true)
  if [ -n "$TOKEN_LINE" ]; then
    CLAUDE_CODE_OAUTH_TOKEN="${TOKEN_LINE#CLAUDE_CODE_OAUTH_TOKEN=}"
    CLAUDE_CODE_OAUTH_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN%\"}"
    CLAUDE_CODE_OAUTH_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN#\"}"
    export CLAUDE_CODE_OAUTH_TOKEN
  fi
fi

# --- Helpers ---
ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $1" >> "$LOG"; }
err() { echo "[$(ts)] ERROR: $1" >> "$LOG"; echo "[$(ts)] $1" >> "$ERR_LOG"; }

# 프로세스 트리 재귀 kill (자식 → 본체 순서)
kill_tree() {
  local target=$1
  local sig=${2:-TERM}
  local children
  children=$(pgrep -P "$target" 2>/dev/null || true)
  for child in $children; do
    kill_tree "$child" "$sig"
  done
  kill -"$sig" "$target" 2>/dev/null || true
}

# Claude --print 호출 + background watchdog 타임아웃 + JSON 완료 감지
claude_with_timeout() {
  local prompt="$1"
  local output_file="$2"
  local timeout="${3:-$STAGE_TIMEOUT}"

  local prompt_file
  prompt_file=$(mktemp /tmp/aiwiki-prompt-XXXXXX)
  printf '%s' "$prompt" > "$prompt_file"
  $CLAUDE --dangerously-skip-permissions --print -p "$(cat "$prompt_file")" > "$output_file" 2>> "$LOG" &
  local claude_pid=$!
  rm -f "$prompt_file"
  log "Claude 프로세스 시작: PID=$claude_pid, timeout=${timeout}초"

  # 1) Hard timeout watchdog (background — sleep을 bg+wait로 인터럽트 가능하게)
  (
    trap 'kill $sleep_pid 2>/dev/null; exit 0' TERM
    sleep "$timeout" &
    sleep_pid=$!
    wait "$sleep_pid" 2>/dev/null || exit 0
    log "STAGE TIMEOUT: Claude PID=$claude_pid ${timeout}초 초과, 강제 종료"
    kill -TERM "$claude_pid" 2>/dev/null
    sleep 3
    kill -9 "$claude_pid" 2>/dev/null
  ) &
  local watchdog_pid=$!

  # 2) JSON 완료 감지 (background — 유효 JSON 출력 시 즉시 종료)
  local check_file="/tmp/aiwiki-check-$$.json"
  (
    trap 'kill $sleep_pid 2>/dev/null; exit 0' TERM
    while kill -0 "$claude_pid" 2>/dev/null; do
      sleep 5 &
      sleep_pid=$!
      wait "$sleep_pid" 2>/dev/null || exit 0
      if [ -s "$output_file" ] && extract_json "$output_file" "$check_file" 2>/dev/null; then
        log "Claude 출력 완료 감지 (JSON valid), 프로세스 종료 중"
        kill -TERM "$claude_pid" 2>/dev/null
        sleep 2
        kill -9 "$claude_pid" 2>/dev/null
        exit 0
      fi
    done
  ) &
  local detector_pid=$!

  # 3) Claude 종료 대기 (자연 종료 / watchdog kill / detector kill)
  wait "$claude_pid" 2>/dev/null
  local rc=$?

  # 4) 정리 — 서브쉘과 그 자식(sleep) 모두 종료
  kill "$watchdog_pid" "$detector_pid" 2>/dev/null || true
  pkill -P "$watchdog_pid" 2>/dev/null || true
  pkill -P "$detector_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true
  wait "$detector_pid" 2>/dev/null || true
  rm -f "$check_file"

  if [ -s "$output_file" ]; then
    return 0
  fi
  log "Claude 출력 없음 (exit code=$rc)"
  return 1
}

# Claude 출력에서 JSON 배열 추출 (```json 블록 우선, 없으면 전체 파싱)
extract_json() {
  local input_file="$1"
  local output_file="$2"

  # ```json 블록 추출 시도
  if grep -q '```json' "$input_file" 2>/dev/null; then
    node -e "
const fs = require('fs');
const text = fs.readFileSync('$input_file', 'utf8');
const match = text.match(/\`\`\`json\\s*([\\s\\S]*?)\`\`\`/);
if (match) {
  try {
    const parsed = JSON.parse(match[1].trim());
    fs.writeFileSync('$output_file', JSON.stringify(parsed, null, 2));
    process.exit(0);
  } catch(e) { process.exit(1); }
}
process.exit(1);
" 2>> "$LOG" && return 0
  fi

  # 전체 파싱 시도
  node -e "
const fs = require('fs');
const text = fs.readFileSync('$input_file', 'utf8').trim();
try {
  const parsed = JSON.parse(text);
  fs.writeFileSync('$output_file', JSON.stringify(parsed, null, 2));
  process.exit(0);
} catch(e) { process.exit(1); }
" 2>> "$LOG" && return 0

  return 1
}

# --- Lock (prevent concurrent runs) ---
if [ -f "$LOCK" ]; then
  OLD_PID=$(cat "$LOCK" 2>/dev/null)
  if kill -0 "$OLD_PID" 2>/dev/null; then
    err "이전 실행이 아직 진행 중 (PID=$OLD_PID). 스킵."
    exit 1
  else
    log "WARN: stale lock 제거 (PID=$OLD_PID 이미 종료)"
    rm -f "$LOCK"
  fi
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

# --- Start ---
log "========== 스케줄러 시작 =========="

# Claude CLI 확인
if [ ! -x "$CLAUDE" ]; then
  err "Claude CLI 없음: $CLAUDE"
  exit 1
fi

# 실행 디렉토리 생성
RUN_DIR="$WORK_DIR/logs/runs/$(date '+%Y-%m-%d_%H%M')"
mkdir -p "$RUN_DIR"
log "실행 디렉토리: $RUN_DIR"

# TERM/INT 시그널 핸들러 (global watchdog이 보내는 TERM 처리)
trap 'log "TERM 수신, 자식 프로세스 정리 중..."; pkill -9 -P $$ 2>/dev/null || true; rm -f "$LOCK"; exit 1' TERM INT

# 전체 watchdog 시작 (timeout 시 메인 프로세스에 TERM 전송)
(
  trap 'kill $sleep_pid 2>/dev/null; exit 0' TERM INT
  sleep $TIMEOUT_SEC &
  sleep_pid=$!
  wait "$sleep_pid" 2>/dev/null || exit 0
  log "GLOBAL TIMEOUT: ${TIMEOUT_SEC}초 초과, 스케줄러 강제 종료"
  kill -TERM $MAIN_PID 2>/dev/null || true
  sleep 5
  kill -9 $MAIN_PID 2>/dev/null || true
  pkill -9 -P $MAIN_PID 2>/dev/null || true
) &
GLOBAL_WATCHDOG=$!
trap 'kill $GLOBAL_WATCHDOG 2>/dev/null || true; pkill -P $GLOBAL_WATCHDOG 2>/dev/null || true; pkill -9 -P $$ 2>/dev/null || true; rm -f "$LOCK"' EXIT

# 이전 실행에서 남은 temp 파일 정리
rm -f /tmp/aiwiki-prompt-* /tmp/aiwiki-claude-* 2>/dev/null || true

# summary 파일 초기화
SUMMARY_FILE="$RUN_DIR/summary.md"
echo "# Run Summary: $(date '+%Y-%m-%d %H:%M')" > "$SUMMARY_FILE"

# --- Stage 1: 트렌드 수집 (쉘) ---
log "Stage 1: 트렌드 수집"
echo "" >> "$SUMMARY_FILE"
echo "## Stage 1: 트렌드 수집" >> "$SUMMARY_FILE"

if ! node "$WORK_DIR/fetch-trends.js" --save-dir "$RUN_DIR" > "$RUN_DIR/trends.json" 2>> "$LOG"; then
  err "Stage 1 실패: fetch-trends.js 오류"
  echo "- 상태: 실패" >> "$SUMMARY_FILE"
  exit 1
fi

TRENDS_SIZE=$(wc -c < "$RUN_DIR/trends.json" | tr -d ' ')
log "Stage 1 완료: trends.json ${TRENDS_SIZE}B"
echo "- 상태: 완료 (${TRENDS_SIZE}B)" >> "$SUMMARY_FILE"

# --- Stage 1b: 발굴 (D1 OpenRouter 모델 + D2 GitHub 생태계 + D4 Tavily 기능) ---
# 실패해도 trends만으로 계속 진행 (비치명적)
log "Stage 1b: 발굴 (모델·생태계·기능)"
if ! node "$WORK_DIR/fetch-discovery.js" --days 7 --features --save-dir "$RUN_DIR" > /dev/null 2>> "$LOG"; then
  log "WARN: 발굴 실패 (trends만으로 계속)"
fi
if [ ! -f "$RUN_DIR/discovery.json" ]; then
  echo '{"models":[],"repos":[],"features":[]}' > "$RUN_DIR/discovery.json"
fi
DISC_SIZE=$(wc -c < "$RUN_DIR/discovery.json" | tr -d ' ')
log "Stage 1b 완료: discovery.json ${DISC_SIZE}B"
echo "- 발굴: discovery.json ${DISC_SIZE}B" >> "$SUMMARY_FILE"

# --- Stage 2: 키워드 선정 (Claude --print) ---
log "Stage 2: 키워드 선정"
echo "" >> "$SUMMARY_FILE"
echo "## Stage 2: 키워드 선정" >> "$SUMMARY_FILE"

PROMPT_SELECT="$WORK_DIR/.claude/prompts/keyword-select.md"
if [ ! -f "$PROMPT_SELECT" ]; then
  err "Stage 2 실패: 프롬프트 파일 없음: $PROMPT_SELECT"
  exit 1
fi

TRENDS=$(cat "$RUN_DIR/trends.json")
DISCOVERY=$(cat "$RUN_DIR/discovery.json")
EXISTING=""
if [ -f "$WORK_DIR/keywords-index.txt" ]; then
  EXISTING=$(cat "$WORK_DIR/keywords-index.txt")
fi

# 프롬프트 치환 (TRENDS_JSON, DISCOVERY_JSON, KEYWORDS_INDEX)
PROMPT_SELECT_CONTENT=$(cat "$PROMPT_SELECT")
PROMPT_SELECT_CONTENT="${PROMPT_SELECT_CONTENT//\{TRENDS_JSON\}/$TRENDS}"
PROMPT_SELECT_CONTENT="${PROMPT_SELECT_CONTENT//\{DISCOVERY_JSON\}/$DISCOVERY}"
PROMPT_SELECT_CONTENT="${PROMPT_SELECT_CONTENT//\{KEYWORDS_INDEX\}/$EXISTING}"

STAGE2_RAW="$RUN_DIR/keywords-selected-raw.txt"
claude_with_timeout "$PROMPT_SELECT_CONTENT" "$STAGE2_RAW" || \
  log "WARN: Claude 프로세스 비정상 종료 (출력 파일 확인 후 계속)"

if ! extract_json "$STAGE2_RAW" "$RUN_DIR/keywords-selected.json"; then
  err "Stage 2 실패: JSON 파싱 오류"
  cat "$STAGE2_RAW" >> "$LOG"
  echo "- 상태: 실패 (JSON 파싱)" >> "$SUMMARY_FILE"
  exit 1
fi

KEYWORD_COUNT=$(node -p "JSON.parse(require('fs').readFileSync('$RUN_DIR/keywords-selected.json','utf8')).length" 2>> "$LOG")
log "Stage 2 완료: 선정 키워드 ${KEYWORD_COUNT}개"
echo "- 상태: 완료 (${KEYWORD_COUNT}개 선정)" >> "$SUMMARY_FILE"

# 선정된 키워드 없으면 Stage 6으로 점프
if [ "$KEYWORD_COUNT" -eq 0 ]; then
  log "선정된 키워드 없음. Stage 6으로 점프."
  echo "- 선정 없음: Stage 6으로 점프" >> "$SUMMARY_FILE"

  # --- Stage 6 (빠른 경로) ---
  log "Stage 6: 빌드 + 로깅 + 커밋 (키워드 없음)"
  echo "" >> "$SUMMARY_FILE"
  echo "## Stage 6: 빌드 + 로깅 + 커밋" >> "$SUMMARY_FILE"

  if [ -f "$WORK_DIR/build.js" ]; then
    node "$WORK_DIR/build.js" >> "$LOG" 2>&1 || log "WARN: build.js 오류 (무시)"
  fi

  RUN_DATE=$(date '+%Y-%m-%d %H:%M')
  LOG_ENTRY="## $RUN_DATE\n- 추가: (없음)\n- HOT: (없음)\n"
  node -e "
const fs = require('fs');
const logPath = '$WORK_DIR/log.md';
const entry = '$RUN_DATE';
const content = '## ' + entry + '\n- 추가: (없음)\n- HOT: (없음)\n\n';
let existing = '';
try { existing = fs.readFileSync(logPath, 'utf8'); } catch(e) {}
fs.writeFileSync(logPath, content + existing);
" 2>> "$LOG"

  cd "$WORK_DIR"
  git add -A >> "$LOG" 2>&1 || true
  git commit -m "(chore) 일일 스케줄러 실행 — 신규 키워드 없음 $(date '+%Y-%m-%d')" >> "$LOG" 2>&1 || log "WARN: 커밋할 변경사항 없음"
  git push >> "$LOG" 2>&1 || log "WARN: push 실패"

  echo "- 상태: 완료" >> "$SUMMARY_FILE"
  kill $GLOBAL_WATCHDOG 2>/dev/null || true
  log "========== 스케줄러 종료 (키워드 없음) =========="
  exit 0
fi

# --- Stage 3: 소스 수집 (쉘, 키워드별 루프) ---
log "Stage 3: 소스 수집"
echo "" >> "$SUMMARY_FILE"
echo "## Stage 3: 소스 수집" >> "$SUMMARY_FILE"

node -e "
const fs = require('fs');
const items = JSON.parse(fs.readFileSync('$RUN_DIR/keywords-selected.json','utf8'));
items.forEach((item, i) => {
  const line = (item.id||'') + '|' + (item.t||item.keyword||'') + '|' + (item.en||'') + '|' + (item.keyword_ko||item.t||'');
  console.log(line);
});
" 2>> "$LOG" > "$RUN_DIR/keywords-list.txt"

FETCH_ERRORS=0
while IFS='|' read -r KW_ID KW_T KW_EN KW_KO; do
  [ -z "$KW_ID" ] && continue
  log "  소스 수집: $KW_T ($KW_ID)"
  mkdir -p "$RUN_DIR/$KW_ID"
  if ! node "$WORK_DIR/fetch-sources.js" \
    --keyword "$KW_T" \
    --keyword-ko "$KW_KO" \
    --en "$KW_EN" \
    --save-dir "$RUN_DIR/$KW_ID/" >> "$LOG" 2>&1; then
    err "  소스 수집 실패: $KW_T"
    FETCH_ERRORS=$((FETCH_ERRORS + 1))
  fi
done < "$RUN_DIR/keywords-list.txt"

if [ "$FETCH_ERRORS" -gt 0 ]; then
  log "WARN: 소스 수집 ${FETCH_ERRORS}개 실패 (계속 진행)"
fi
log "Stage 3 완료"
echo "- 상태: 완료 (오류 ${FETCH_ERRORS}개)" >> "$SUMMARY_FILE"

# --- Stage 4: 콘텐츠 생성 (Claude --print, 키워드별 개별 호출로 격리) ---
# 한 건 실패(AUP 차단/타임아웃/소켓종료)가 배치 전체를 죽이지 않도록 키워드마다 따로 호출한다.
log "Stage 4: 콘텐츠 생성 (키워드별 개별 호출)"
echo "" >> "$SUMMARY_FILE"
echo "## Stage 4: 콘텐츠 생성" >> "$SUMMARY_FILE"

PROMPT_CONTENT="$WORK_DIR/.claude/prompts/content-generate.md"
if [ ! -f "$PROMPT_CONTENT" ]; then
  err "Stage 4 실패: 프롬프트 파일 없음: $PROMPT_CONTENT"
  exit 1
fi

EXISTING_FOR_CONTENT=""
if [ -f "$WORK_DIR/keywords-index.txt" ]; then
  EXISTING_FOR_CONTENT=$(cat "$WORK_DIR/keywords-index.txt")
fi
PROMPT_CONTENT_TEMPLATE=$(cat "$PROMPT_CONTENT")

CONTENT_OK=0
CONTENT_FAIL=0
FAILED_KEYWORDS=""

while IFS='|' read -r KW_ID KW_T KW_EN KW_KO; do
  [ -z "$KW_ID" ] && continue
  log "  콘텐츠 생성: $KW_T ($KW_ID)"

  # 해당 키워드의 sources.json만 묶어 SOURCES_DATA 구성 (1개짜리 배열)
  SOURCES_DATA=$(node -e "
const fs = require('fs');
const path = require('path');
const sel = JSON.parse(fs.readFileSync('$RUN_DIR/keywords-selected.json','utf8'));
const item = sel.find(k => (k.id||'') === '$KW_ID');
if (!item) { console.log('[]'); process.exit(0); }
let sources = {};
try { sources = JSON.parse(fs.readFileSync(path.join('$RUN_DIR', '$KW_ID', 'sources.json'),'utf8')); } catch(e) {}
console.log(JSON.stringify([{ keyword: item, sources }], null, 2));
" 2>> "$LOG")

  PROMPT_ONE="$PROMPT_CONTENT_TEMPLATE"
  PROMPT_ONE="${PROMPT_ONE//\{KEYWORDS_INDEX\}/$EXISTING_FOR_CONTENT}"
  PROMPT_ONE="${PROMPT_ONE//\{SOURCES_DATA\}/$SOURCES_DATA}"

  KW_RAW="$RUN_DIR/$KW_ID/content-raw.txt"
  KW_JSON="$RUN_DIR/$KW_ID/content.json"
  claude_with_timeout "$PROMPT_ONE" "$KW_RAW" || \
    log "  WARN: Claude 비정상 종료 ($KW_ID, 출력 확인 후 계속)"

  if extract_json "$KW_RAW" "$KW_JSON"; then
    CONTENT_OK=$((CONTENT_OK + 1))
    log "  완료: $KW_ID"
  else
    CONTENT_FAIL=$((CONTENT_FAIL + 1))
    FAILED_KEYWORDS="$FAILED_KEYWORDS $KW_ID"
    err "  콘텐츠 생성 실패: $KW_T ($KW_ID) — 건너뜀 (AUP 차단/타임아웃 가능)"
  fi
done < "$RUN_DIR/keywords-list.txt"

# 키워드별 결과 병합 → content.json (Stage 5 호환 포맷)
node -e "
const fs = require('fs');
const path = require('path');
const list = fs.readFileSync('$RUN_DIR/keywords-list.txt','utf8').split('\n').filter(Boolean);
const merged = [];
for (const line of list) {
  const id = line.split('|')[0];
  if (!id) continue;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join('$RUN_DIR', id, 'content.json'),'utf8'));
    if (Array.isArray(parsed)) merged.push(...parsed);
    else if (parsed && typeof parsed === 'object') merged.push(parsed);
  } catch(e) {}
}
fs.writeFileSync('$RUN_DIR/content.json', JSON.stringify(merged, null, 2));
" 2>> "$LOG"

CONTENT_COUNT=$(node -p "JSON.parse(require('fs').readFileSync('$RUN_DIR/content.json','utf8')).length" 2>> "$LOG" || echo 0)
log "Stage 4 완료: 성공 ${CONTENT_OK}개 / 실패 ${CONTENT_FAIL}개 (병합 ${CONTENT_COUNT}개)"
echo "- 상태: 완료 (성공 ${CONTENT_OK} / 실패 ${CONTENT_FAIL})" >> "$SUMMARY_FILE"
[ -n "$FAILED_KEYWORDS" ] && echo "- 실패 키워드:$FAILED_KEYWORDS" >> "$SUMMARY_FILE"

# 생성된 항목이 하나도 없으면 신규 키워드 없음으로 커밋하고 종료
if [ "$CONTENT_COUNT" -eq 0 ]; then
  log "생성된 콘텐츠 없음 (전부 실패/차단). 신규 키워드 없음으로 커밋."
  echo "- 생성 0개: 신규 키워드 없음 처리" >> "$SUMMARY_FILE"
  if [ -f "$WORK_DIR/build.js" ]; then
    node "$WORK_DIR/build.js" >> "$LOG" 2>&1 || log "WARN: build.js 오류 (무시)"
  fi
  node -e "
const fs = require('fs');
const logPath = '$WORK_DIR/log.md';
const content = '## $(date '+%Y-%m-%d %H:%M')\n- 추가: (없음)\n- HOT: (없음)\n\n';
let existing = '';
try { existing = fs.readFileSync(logPath, 'utf8'); } catch(e) {}
fs.writeFileSync(logPath, content + existing);
" 2>> "$LOG"
  cd "$WORK_DIR"
  git add -A >> "$LOG" 2>&1 || true
  git commit -m "(chore) 일일 스케줄러 실행 — 신규 키워드 없음 $(date '+%Y-%m-%d')" >> "$LOG" 2>&1 || log "WARN: 커밋할 변경사항 없음"
  git push >> "$LOG" 2>&1 || log "WARN: push 실패"
  kill $GLOBAL_WATCHDOG 2>/dev/null || true
  log "========== 스케줄러 종료 (생성 0개) =========="
  exit 0
fi

# --- Stage 5: data.js 반영 (쉘) ---
log "Stage 5: data.js 반영"
echo "" >> "$SUMMARY_FILE"
echo "## Stage 5: data.js 반영" >> "$SUMMARY_FILE"

if ! node "$WORK_DIR/apply-entries.js" "$RUN_DIR/content.json" >> "$LOG" 2>&1; then
  err "Stage 5 실패: apply-entries.js 오류"
  echo "- 상태: 실패" >> "$SUMMARY_FILE"
  exit 1
fi

log "Stage 5 완료"
echo "- 상태: 완료" >> "$SUMMARY_FILE"

# --- Stage 6: 빌드 + 로깅 + 커밋 (쉘) ---
log "Stage 6: 빌드 + 로깅 + 커밋"
echo "" >> "$SUMMARY_FILE"
echo "## Stage 6: 빌드 + 로깅 + 커밋" >> "$SUMMARY_FILE"

if [ -f "$WORK_DIR/build.js" ]; then
  if ! node "$WORK_DIR/build.js" >> "$LOG" 2>&1; then
    log "WARN: build.js 오류 (계속 진행)"
  fi
fi

# 추가된 ID 목록 수집
ADDED_IDS=$(node -p "
JSON.parse(require('fs').readFileSync('$RUN_DIR/content.json','utf8')).map(i=>i.id).join(', ')
" 2>> "$LOG" || echo "(알 수 없음)")

# HOT IDs 수집 (index.html에서 파싱)
HOT_IDS=$(node -e "
const fs = require('fs');
try {
  const html = fs.readFileSync('$WORK_DIR/index.html','utf8');
  const match = html.match(/const HOT_IDS\s*=\s*\[([^\]]*)\]/);
  if (match) {
    const ids = match[1].split(',').map(s=>s.trim().replace(/['\"\`]/g,'')).filter(Boolean);
    console.log(ids.join(', '));
  } else { console.log('(없음)'); }
} catch(e) { console.log('(없음)'); }
" 2>> "$LOG")

# log.md 맨 위에 실행 결과 추가
RUN_DATE=$(date '+%Y-%m-%d %H:%M')
node -e "
const fs = require('fs');
const logPath = '$WORK_DIR/log.md';
const content = '## $RUN_DATE\n- 추가: $ADDED_IDS\n- HOT: $HOT_IDS\n\n';
let existing = '';
try { existing = fs.readFileSync(logPath, 'utf8'); } catch(e) {}
fs.writeFileSync(logPath, content + existing);
" 2>> "$LOG"

# git 커밋 + 푸시
cd "$WORK_DIR"
git add -A >> "$LOG" 2>&1 || true
git commit -m "(feat) 일일 키워드 추가: $ADDED_IDS ($(date '+%Y-%m-%d'))" >> "$LOG" 2>&1 || log "WARN: 커밋할 변경사항 없음"
git push >> "$LOG" 2>&1 || log "WARN: push 실패"

echo "- 상태: 완료" >> "$SUMMARY_FILE"
echo "- 추가: $ADDED_IDS" >> "$SUMMARY_FILE"
echo "- HOT: $HOT_IDS" >> "$SUMMARY_FILE"

# --- 정리 ---
kill $GLOBAL_WATCHDOG 2>/dev/null || true
log "========== 스케줄러 종료 (정상) =========="
exit 0
