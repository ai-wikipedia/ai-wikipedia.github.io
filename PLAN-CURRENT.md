# 현재 진행 중인 플랜

> 시작: 2026-06-07
> 항목: 스케줄러 신뢰성 복구 (레포 이전 + Stage 4 견고화)

---

## 목표

매일 정상 실행되던 스케줄러가 5일 연속(06-03~07) Stage 4(콘텐츠 생성)에서만 죽어 "신규 키워드 없음"으로 커밋돼 왔다. 검색·키워드 선정은 정상. 두 갈래 원인을 함께 잡는다.

1. **레포 불일치** — `~/run-daily.sh`의 `WORK_DIR`이 옛 클론(`~/dev/ai-wiki`)을 가리킨다. 정본을 새 레포(`~/Desktop/dev/ai-wikipedia.github.io`)로 이전한다.
2. **Stage 4 배치 취약성** — 선정 키워드 전부를 한 번의 `claude --print`로 처리해서, ① 사이버 콘텐츠 1건(WormGPT 등)이 AUP에 걸리면 배치 전체 무산(06-06, 06-07), ② 대형 단일 프롬프트로 타임아웃·소켓 종료(06-03~05). 키워드별 분리 호출로 격리하고, 선정 단계에 악성코드류 제외 기준을 둔다.

## 결정 사항 (확정)
- 정본 레포 = `~/Desktop/dev/ai-wikipedia.github.io` (옛 `~/dev/ai-wiki`는 은퇴)
- Stage 4 = 키워드별 개별 호출로 격리 (한 건 실패가 전체를 죽이지 않게)
- 키워드 선정 = 악성코드·사이버웨폰류(WormGPT, 자율 AI 웜 등) 제외 기준 추가

## 체크리스트

### A. 레포 이전
- [x] `~/run-daily.sh`의 `WORK_DIR`을 새 레포 경로로 변경 (2026-06-07)
- [x] 새 레포에 `keywords-index.txt`·`log.md` 최신본 반영 확인 — 옛 레포와 내용 동일(동기화 불필요)
- [x] 옛 레포(`~/dev/ai-wiki`) 삭제 — origin 완전 동기화 확인 후 rm. logs/runs 63개는 새 레포로 보존 이동
- [x] launchd plist 확인 — `~/run-daily.sh` 가리킴, WORK_DIR은 런타임 로드라 reload 불필요
- [x] **`.env` 재생성** — 옛 레포 삭제 시 동반 삭제됐던 `.env` 새로 작성, 키 재입력. fetch-sources.js로 Tavily·YouTube 양쪽 실호출 정상 확인 (2026-06-07)
- [ ] run-daily.sh·plist를 레포에 넣어 버전관리할지 — 보류(현재 ~/에 유지, WORK_DIR만 새 레포)

### B. Stage 4 키워드별 격리
- [x] Stage 4를 선정 키워드별 개별 `claude --print` 루프로 재작성 (run-daily.sh:318~)
- [x] 키워드 1건 실패 시 해당 건만 건너뛰고 나머지 진행 (`|| log` + `if extract_json`, 루프 내 exit 없음)
- [x] 키워드별 결과를 합쳐 `content.json` 병합 — 기존 배열 포맷 유지(Stage 5 호환)
- [x] 전부 실패(생성 0개) 시 "신규 키워드 없음"으로 깔끔히 커밋·종료하는 경로 추가

### C. 악성코드류 키워드 제외
- [x] `keyword-select.md`에 제외 기준 추가 (WormGPT/FraudGPT·자율 AI 웜·공격 자동화 도구)
- [x] 방어·교육 보안 개념(프롬프트 인젝션·가드레일·jailbreak·레드팀)은 정상 선정되도록 명시 보존

### D. 검증
- [x] 06-07 ai-worm 차단 배치 재현(결정적 테스트) — ai-worm 격리·continual-learning 생존·병합 1건 PASS
- [x] 셸 문법 검증 `bash -n` 통과
- [ ] (보류) 수동 라이브 end-to-end 1회 — 프로덕션 커밋·푸시 발생 + `claude --dangerously-skip-permissions` 권한 필요. 사용자 승인 후 진행

## 진행 로그
| 시간 | 작업 내용 |
|------|----------|
| 2026-06-07 | 진단 완료 — Stage 4만 5일 연속 실패(AUP 차단·타임아웃), 레포 불일치 확인. phase 시작 |
| 2026-06-07 | A 완료 — WORK_DIR 새 레포로 변경, 옛 레포 삭제(로그 보존 이동), 옛 .env 동반삭제→재생성 후 API 실호출 검증 |
| 2026-06-07 | B 완료 — Stage 4 키워드별 개별 호출 루프로 재작성 + 실패 격리 + 병합 + 생성0개 처리 |
| 2026-06-07 | C 완료 — keyword-select.md에 공격용 악성 AI 도구 제외 기준 추가(방어 보안 개념은 보존) |
| 2026-06-07 | D 부분완료 — 격리 결정적 테스트 PASS, bash -n 통과. 라이브 end-to-end는 사용자 승인 대기 |
