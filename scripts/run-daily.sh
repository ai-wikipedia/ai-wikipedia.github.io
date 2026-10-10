#!/bin/bash
# AI Wiki daily scheduler — 2-stage pipeline (shell + Claude --print)
# Called by launchd: ~/Library/LaunchAgents/com.aiwiki.daily.plist

set -euo pipefail

# --- 시스템 슬립 방지 (caffeinate 재실행) ---
# launchd 예약 실행 중 맥북이 maintenance sleep에 빠지면 `sleep` 타이머와 네트워크가
# 멈춰 Claude 단계가 수 시간 hang하다 "Request timed out"으로 죽는다(워치독도 무력화).
# 실행 내내 깨어있도록 caffeinate로 자신을 한 번 재실행한다.
#   -i 유휴 슬립 방지 · -m 디스크 슬립 방지 · -s AC 전원 시 시스템 슬립 방지
if [ -z "${AIWIKI_CAFFEINATED:-}" ] && [ -x /usr/bin/caffeinate ]; then
  export AIWIKI_CAFFEINATED=1
  exec /usr/bin/caffeinate -ims /bin/bash "$0" "$@"
fi

# --- Config ---
# 스크립트 위치 기준 레포 경로 (git worktree에서도 그대로 동작)
WORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$WORK_DIR/logs/daily.log"
ERR_LOG="$WORK_DIR/logs/daily-err.log"
LOCK="/tmp/aiwiki-daily-$(basename "$WORK_DIR").lock"
CLAUDE="/Users/hh/.local/bin/claude"
MAIN_PID=$$

# 실행 옵션 (환경변수로 조정)
#   AIWIKI_DISCOVERY_DAYS  발굴 기간(일). 밀린 업데이트 따라잡기 시 늘린다 (기본 7)
#   AIWIKI_MAX_MODELS      발굴할 신규 모델 최대 수 (기본 40). 기간을 늘리면 같이 늘린다
#   AIWIKI_MAX_KEYWORDS    1회 최대 신규 키워드 수 — 하루 대량 발행은 scaled content 신호 (기본 5)
#   AIWIKI_MAX_MODEL_KEYWORDS 그중 AI 모델 출시 카드 최대 수 (기본 1) — 나머지는 개념·도구·패턴
#   AIWIKI_PARALLEL        콘텐츠 생성 동시 실행 수 (기본 3)
#   AIWIKI_PUSH            1이면 커밋 후 push, 0이면 커밋만 하고 검토 대기 (기본 1)
#   AIWIKI_TIMEOUT         전체 watchdog 초 (기본 1800)
#   AIWIKI_BACKLOG_FILE    이전에 생성 실패한 후보 JSON — 선정 단계에서 함께 재검토
#   AIWIKI_KEYWORDS_FILE   키워드 목록 JSON([{id,keyword,keywordKo,en}]) — LLM 선정을 건너뛰고 이 목록으로 생성
DISCOVERY_DAYS="${AIWIKI_DISCOVERY_DAYS:-7}"
MAX_MODELS="${AIWIKI_MAX_MODELS:-40}"
MAX_KEYWORDS="${AIWIKI_MAX_KEYWORDS:-5}"
PARALLEL="${AIWIKI_PARALLEL:-3}"
AUTO_PUSH="${AIWIKI_PUSH:-1}"
TIMEOUT_SEC="${AIWIKI_TIMEOUT:-1800}"

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

# 변경 파일만 골라 커밋 (git add -A는 .DS_Store·내보내기 폴더까지 커밋하므로 사용하지 않음)
git_publish() {
  cd "$WORK_DIR"
  git add -- data.js index.html k c sitemap.xml keywords-index.txt log.md updates.html i18n-meta.json >> "$LOG" 2>&1 || true
  git commit -m "$1" >> "$LOG" 2>&1 || log "WARN: 커밋할 변경사항 없음"
  if [ "$AUTO_PUSH" = "1" ]; then
    git push >> "$LOG" 2>&1 || log "WARN: push 실패"
  else
    log "AIWIKI_PUSH=0: push 생략 (검토 후 수동 push)"
  fi
}

# 번역 동기화: 공개 항목 중 번역이 없거나 한국어 본문이 바뀐 것만 다시 번역 (평소엔 0건)
# (본문 심화 후 번역이 낡거나, 번역 단계만 실패한 경우를 다음 실행에서 자동 복구)
sync_translations() {
  local out="$RUN_DIR/i18n-sync"
  local stat
  stat=$(node "$WORK_DIR/scripts/llm-stage.js" translate --stale --out "$out" --parallel "$PARALLEL" 2>> "$LOG" || echo '{}')
  log "번역 동기화: $stat"
  if [ -d "$out" ] && [ -n "$(ls -A "$out" 2>/dev/null)" ]; then
    node "$WORK_DIR/apply-updates.js" "$out" >> "$LOG" 2>&1 || log "WARN: 번역 반영 실패"
  fi
}

# LLM 단계 실행기에 넘길 환경
export AIWIKI_CLAUDE="$CLAUDE"
export AIWIKI_LOG="$LOG"

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
if ! node "$WORK_DIR/fetch-discovery.js" --days "$DISCOVERY_DAYS" --max-models "$MAX_MODELS" --features --save-dir "$RUN_DIR" > /dev/null 2>> "$LOG"; then
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

# 구조화 출력 + 중복/형식 필터 + 상한 적용 → keywords-selected.json, keywords-list.txt
if ! KEYWORD_COUNT=$(node "$WORK_DIR/scripts/llm-stage.js" select --run-dir "$RUN_DIR" --max "$MAX_KEYWORDS" 2>> "$LOG"); then
  err "Stage 2 실패: 키워드 선정 호출 오류"
  echo "- 상태: 실패" >> "$SUMMARY_FILE"
  exit 1
fi
log "Stage 2 완료: 선정 키워드 ${KEYWORD_COUNT}개 (상한 ${MAX_KEYWORDS})"
echo "- 상태: 완료 (${KEYWORD_COUNT}개 선정)" >> "$SUMMARY_FILE"

# 선정된 키워드 없으면 Stage 6으로 점프
if [ "$KEYWORD_COUNT" -eq 0 ]; then
  log "선정된 키워드 없음. Stage 6으로 점프."
  echo "- 선정 없음: Stage 6으로 점프" >> "$SUMMARY_FILE"

  # --- Stage 6 (빠른 경로) ---
  log "Stage 6: 빌드 + 로깅 + 커밋 (키워드 없음)"
  echo "" >> "$SUMMARY_FILE"
  echo "## Stage 6: 빌드 + 로깅 + 커밋" >> "$SUMMARY_FILE"

  sync_translations

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

  git_publish "(chore) 일일 스케줄러 실행 — 신규 키워드 없음 $(date '+%Y-%m-%d')"

  echo "- 상태: 완료" >> "$SUMMARY_FILE"
  kill $GLOBAL_WATCHDOG 2>/dev/null || true
  log "========== 스케줄러 종료 (키워드 없음) =========="
  exit 0
fi

# --- Stage 3: 소스 수집 (쉘, 키워드별 루프) ---
log "Stage 3: 소스 수집"
echo "" >> "$SUMMARY_FILE"
echo "## Stage 3: 소스 수집" >> "$SUMMARY_FILE"

# keywords-list.txt(id|t|en|ko)는 Stage 2(llm-stage.js select)가 생성한다

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

# --- Stage 4: 콘텐츠 생성 + 번역 (llm-stage.js — 키워드별 병렬, 구조화 출력, 품질 게이트) ---
log "Stage 4: 콘텐츠 생성 (병렬 ${PARALLEL})"
echo "" >> "$SUMMARY_FILE"
echo "## Stage 4: 콘텐츠 생성" >> "$SUMMARY_FILE"

STAGE4_STAT=$(node "$WORK_DIR/scripts/llm-stage.js" content --run-dir "$RUN_DIR" --parallel "$PARALLEL" 2>> "$LOG" || echo '{}')
CONTENT_COUNT=$(node -p "JSON.parse(require('fs').readFileSync('$RUN_DIR/content.json','utf8')).length" 2>> "$LOG" || echo 0)
log "Stage 4 완료: $STAGE4_STAT (반영 대상 ${CONTENT_COUNT}개)"
echo "- 상태: 완료 $STAGE4_STAT" >> "$SUMMARY_FILE"

# 생성된 항목이 하나도 없으면 신규 키워드 없음으로 커밋하고 종료
if [ "$CONTENT_COUNT" -eq 0 ]; then
  log "생성된 콘텐츠 없음 (전부 실패/차단). 신규 키워드 없음으로 커밋."
  echo "- 생성 0개: 신규 키워드 없음 처리" >> "$SUMMARY_FILE"
  sync_translations
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
  git_publish "(chore) 일일 스케줄러 실행 — 신규 키워드 없음 $(date '+%Y-%m-%d')"
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

sync_translations

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
  const html = fs.readFileSync('$WORK_DIR/data.js','utf8');
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

# git 커밋 (+ AIWIKI_PUSH=1이면 push)
git_publish "(feat) 일일 키워드 추가: $ADDED_IDS ($(date '+%Y-%m-%d'))"

echo "- 상태: 완료" >> "$SUMMARY_FILE"
echo "- 추가: $ADDED_IDS" >> "$SUMMARY_FILE"
echo "- HOT: $HOT_IDS" >> "$SUMMARY_FILE"

# --- 정리 ---
kill $GLOBAL_WATCHDOG 2>/dev/null || true
log "========== 스케줄러 종료 (정상) =========="
exit 0
