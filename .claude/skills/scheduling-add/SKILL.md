---
name: scheduling-add
description: AI Wiki 키워드 일일 자동 업데이트 (트렌드 수집 → 키워드 추가 → HOT 표식 → 로깅 → 커밋)
---

# /scheduling-add

AI Wiki 키워드 일일 자동 업데이트. 수동 실행과 스케줄러 공용.

## 데이터 수집 (스크립트가 담당, WebSearch 금지)
- 트렌드: `node fetch-trends.js` — HN + Tavily(Reddit) + GeekNews
- 발굴: `node fetch-discovery.js --days 7 --features` — OpenRouter 신규 모델 + GitHub 신규 생태계 레포 + Tavily 기능 요약
- 소스: `node fetch-sources.js` — 키워드별 Tavily(웹) + YouTube

## 실행 모드

- **자동 (스케줄러)**: launchd → `scripts/run-daily.sh` (6-stage). 프롬프트는 `.claude/prompts/keyword-select.md`(선정) + `content-generate.md`(생성). 매일 08:00 KST.
- **대화형** (`/scheduling-add`): 아래 순서를 직접 수행. 수집은 위 스크립트를 동일하게 사용.

## 실행 순서

1. 트렌드·발굴 데이터를 스크립트로 수집한다:
   - `node fetch-trends.js`  (커뮤니티 화제)
   - `node fetch-discovery.js --days 7 --features`  (신규 모델·플러그인·기능)

2. data.js의 D 배열과 대조하여 아직 없는 키워드를 선정한다.
   - 선정 기준:
     1. **독립된 개념인가** — 특정 제품의 하위 기능이 아니라 AI 분야에서 독립적으로 설명할 수 있는 기술·도구·패턴이어야 한다.
     2. **위키에 없는가** — 기존 키워드와 중복되지 않아야 한다.
     3. **커뮤니티에서 화제인가** — 수집한 소스에서 실제로 언급되었어야 한다.
   - 주의:
     - 특정 제품의 기능이라도, 그 기능이 독립된 기술 패턴으로 확산되고 있다면 추가한다.
     - 등장 시점이 오래됐더라도 최근 커뮤니티에서 재조명되고 있다면 추가 대상이다.
     - "너무 세부적"이라는 이유로 쉽게 제외하지 않는다. 커뮤니티에서 언급될 정도면 충분히 중요하다.
   - 개수 제한 없음 — 기준에 부합하는 키워드는 전부 추가
   - 새로 다룰 만한 키워드가 없으면 기존 항목 중 det이 부실한 것을 보강

3. 선정된 키워드마다:
   - 먼저 `node fetch-sources.js --keyword "{english}" --keyword-ko "{한국어}" --en "{English Name}"` 실행하여 소스 데이터 수집
   - 수집된 데이터(`web` + `youtube`)를 researcher 에이전트와 reference-collector 에이전트에 전달하여 콘텐츠 작성 + 레퍼런스/영상 채택 + 번역 처리
   - 대화형이든 스케줄러든 fetch-sources.js를 동일하게 사용한다
   - **refs**: 공식 자료 우선 (공식문서 > 공식블로그 > 논문 > 튜토리얼)
   - **videos**: 영어 2개 + 한국어 1개 = 총 3개 고정
   - 기존 항목 수정 시 이미 있는 refs/videos는 유지하고 누락분만 추가

4. HOT_IDS 및 LAST_UPDATED 갱신
   - data.js의 `const HOT_IDS = [...]` 배열을 **전체 비우고** 이번 배치에서 트렌딩으로 식별된 키워드 ID로 교체
   - 새로 추가된 키워드 + 기존 키워드 중 이번 수집에서 화제였던 것 모두 포함
   - `const LAST_UPDATED = '...';` 값을 현재 실행 시각(UTC ISO 형식)으로 갱신

5. `node build.js` 실행하여 키워드 독립 페이지(/k/)와 sitemap.xml 재생성

6. 로깅 — log.md 맨 위에 추가 (현재 시각을 분 단위까지 확인):
   ## YYYY-MM-DD HH:MM
   - 추가: keyword-id-1, keyword-id-2, ...
   - HOT: hot-id-1, hot-id-2, ...
   - 보강: (있으면 기재, 없으면 "없음")

7. 변경 파일을 git add + 한국어 커밋 메시지 + git push
