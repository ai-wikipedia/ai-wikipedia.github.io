# 스케줄러 상태 & 점검

AI Wiki 일일 자동 업데이트 스케줄러(launchd)의 설정·상태·점검 방법.
워크플로우 내용은 [auto-update-plan.md](./auto-update-plan.md) 참조.

---

## 현재 설정 상태 (점검: 2026-06-08)

| 항목 | 상태 |
|------|------|
| launchd 등록 | ✅ `com.aiwiki.daily` 등록됨, LastExitStatus=0 (직전 실행 성공) |
| 스크립트 경로 | ✅ plist → `scripts/run-daily.sh` (레포 내, 버전관리) |
| 실행 권한 | ✅ `-rwxr-xr-x` (실행가능) |
| WORK_DIR | ✅ `~/Desktop/dev/ai-wikipedia.github.io` (정본 레포) |
| 스케줄 | ✅ 매일 08:00 KST (plist `Hour`=8) |
| 자동 기상 | ✅ pmset wake 07:59 (스케줄 1분 전) |
| 실행 바이너리 | ✅ claude(2.1.168) + node(v24.14.0) 존재 |
| 의존 파일 | ✅ fetch-trends/discovery/sources.js, 프롬프트, keywords-index, `.env` 전부 존재 |
| lock | ✅ 없음 (멈춰있지 않음) |
| 마지막 실행 | ✅ 2026-06-07 23:11 정상 종료 |

---

## 항목별 점검 명령 (재현용)

```bash
# launchd 등록 + 직전 종료코드
launchctl list com.aiwiki.daily | grep -E "Label|LastExitStatus|OnDemand"

# plist가 가리키는 스크립트 경로
grep run-daily ~/Library/LaunchAgents/com.aiwiki.daily.plist

# 스크립트 실행권한·WORK_DIR
ls -l scripts/run-daily.sh
grep -m1 'WORK_DIR=' scripts/run-daily.sh

# 스케줄 시각
grep -A4 StartCalendarInterval ~/Library/LaunchAgents/com.aiwiki.daily.plist

# 자동 기상 설정
pmset -g sched

# 실행 바이너리
ls -l ~/.local/bin/claude; ls -d ~/.nvm/versions/node/v24.14.0/bin/node

# 의존 파일 일괄 확인
for f in fetch-trends.js fetch-discovery.js fetch-sources.js apply-entries.js build.js \
  .claude/prompts/keyword-select.md .claude/prompts/content-generate.md keywords-index.txt .env; do
  [ -f "$f" ] && echo "OK  $f" || echo "없음 $f"; done

# 실행 중 여부 (lock) + 최근 로그
ls /tmp/aiwiki-daily.lock 2>/dev/null && echo "실행 중" || echo "유휴"
tail -5 logs/daily.log
```

---

## 관리 명령

```bash
launchctl list com.aiwiki.daily          # 등록 확인
launchctl start com.aiwiki.daily          # 수동 즉시 실행 (프로덕션 커밋·푸시 발생)
launchctl unload ~/Library/LaunchAgents/com.aiwiki.daily.plist  # 비활성
launchctl load   ~/Library/LaunchAgents/com.aiwiki.daily.plist  # 활성/재로드 (plist 수정 후)

# 시간 변경: plist의 Hour/Minute 수정 → unload → load
# wake 변경: sudo pmset repeat wakeorpoweron MTWRFSU HH:MM:00
pmset -g sched                            # wake 확인
```

---

## 주의사항

1. **커밋 sharp edge** — `scripts/run-daily.sh` Stage 6은 `git add -A`라 실행 시점의 **워킹트리 미커밋 변경을 자동 커밋에 흡수**한다. 수동 작업 중 스케줄러가 돌면 무관한 변경이 키워드 커밋에 섞이므로, 작업 후엔 커밋해두는 게 안전.
2. **스크립트는 워킹트리 기준 실행** — launchd는 git이 아니라 파일을 직접 실행. 즉 미커밋이어도 최신 파일로 돌지만, 위 1번 때문에 커밋 권장.
3. **전제** — 맥북 잠자기 OK(pmset이 깨움), 전원 꺼짐은 불가.
4. **실행 기록** — 단계별 원본 `logs/runs/{날짜}/`, 요약 `log.md`, 로그 `logs/daily.log`.
