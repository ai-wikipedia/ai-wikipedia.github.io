# AI Wiki 자동 업데이트 — 워크플로우 & API 호출 정리

맥북 launchd 스케줄러(매일 08:00 KST) + Claude Code CLI로 키워드를 자동 발굴·작성·반영하는 구조.
구독 내 사용이라 LLM 추가 비용 없음. 외부 API는 전부 무료 등급.

---

## 마스터 워크플로우 — API 호출 단위 (한 표)

> **서로 다른 API는 각각 한 줄.** 같은 API라도 단계·목적이 다르면 따로 적음(예: Tavily는 D3·D4·C1 3곳에서 다른 정보를 가져옴).

| 단계 | # | API (구분) | 엔드포인트 / 명령 | **가져오는 정보** | 실제 예시 | 호출수 | 키 |
|------|---|-----------|-------------------|-------------------|-----------|--------|----|
| **D1** 모델 발굴 | 1 | OpenRouter | `GET openrouter.ai/api/v1/models` | 전 제공사 **모델 목록** (id, name, created일) | ex) `2026-05-27 anthropic/claude-opus-4.8`, `2026-04-30 x-ai/grok-4.3` | 1 | 무키 |
| **D2** 생태계 발굴 | 1 | GitHub Search | `GET api.github.com/search/repositories?q=topic:{6개}+created:>{60d}&sort=stars` | **레포** (이름, 설명, stars, 생성일) | ex) `★69k JuliusBrussee/caveman — 토큰 절약`, `★61k graphify` | 토픽수(~6) | 무키 |
| **D3** 버즈 발굴 | 1 | HN Firebase | `GET hacker-news.firebaseio.com/v0/topstories.json` + `item/{id}.json` | **HN top 스토리** (제목, 점수, URL) | ex) `899pt How LLMs work`, `280pt DeepSeek-V4-Flash` | 1+30 | 무키 |
| | 2 | Tavily Search | `POST api.tavily.com/search` (q=Reddit AI) | **Reddit 글** (제목, 스니펫, URL) | ex) `What are your top LLM picks in 2026? r/artificial` | 1 | Tavily |
| | 3 | GeekNews | `GET news.hada.io/new` + `/weekly` (스크래핑) | **긱뉴스 글** (제목, URL, 포인트) | ex) `Postgres에서 내구성 워크플로 구축`, `dynamic workflows in Claude Code` | 2 | 무키 |
| **D4** 기능 추출 | 1 | Tavily Search | `POST api.tavily.com/search` (q="{모델} new features", include_answer) | **모델/제품 기능 요약** (answer + 출처) | ex) Claude 4.8 → `dynamic workflows · fast mode · effort control`; Grok 4.3 → `native video input` | 후보수 | Tavily |
| **S1** 키워드 선정 | — | Claude CLI *(API아님)* | `claude --print` + keyword-select.md | (입력 종합→ **확정 키워드 JSON**) | ex) `[{id:'durable-execution',keyword:'Durable Execution',...}]` | 1 | 구독 |
| **C1** 소스 수집 | 1 | Tavily Search | `POST api.tavily.com/search` (웹 EN, 웹 KO) | **웹 출처** (제목, URL, 본문) EN/KO | ex) `What is Retrieval-Augmented Generation — aws.amazon.com` | 2/키워드 | Tavily |
| | 2 | YouTube `search.list` | `GET googleapis.com/youtube/v3/search` (EN, KO) | **영상 후보** (id, 제목, 채널, 게시일) | ex) `dQw…  "What is RAG?" · IBM Technology · 2024-05` | 2/키워드 | YouTube |
| | 3 | YouTube `videos.list` | `GET googleapis.com/youtube/v3/videos` | **영상 조회수** | ex) `videoId dQw… → viewCount 1,850,182` | 1/키워드 | YouTube |
| **C2** 콘텐츠 생성 | — | Claude CLI *(API아님)* | `claude --print` + content-generate.md **(키워드별 격리)** | sum/det/번역/refs/videos → **content.json** | ex) `{id:'world-model', sum:'AI가 세상을…', det:'<h4>…', translations:{en,zh,ja}}` | 키워드수 | 구독 |
| **C3** 반영 | — | node *(API아님)* | `node apply-entries.js` | → **data.js** (D배열·I18N·rel 삽입) | ex) `Added 1 keyword(s): world-model` | — | — |
| **C4** 빌드 | — | node *(API아님)* | `node build.js` | → **k/*.html, sitemap, index** | ex) `251개 키워드 페이지 + sitemap(252 URL)` | — | — |
| **C5** 커밋 | — | git *(API아님)* | `git add/commit/push` | → GitHub Pages | ex) `(feat) 일일 키워드 추가: world-model` | — | — |

### 단계별 외부 API 종류 수

| 단계 | 외부 API 종류 | 어떤 API |
|------|:---:|----------|
| D1 | **1** | OpenRouter |
| D2 | **1** | GitHub Search |
| D3 | **3** | HN Firebase · Tavily · GeekNews |
| D4 | **1** | Tavily |
| S1 | 0 | (Claude CLI) |
| C1 | **3** | Tavily · YouTube search · YouTube videos |
| C2 | 0 | (Claude CLI) |
| C3~C5 | 0 | (node / git) |

> 외부 API 총 **6종**: OpenRouter · GitHub · HN Firebase · Tavily · GeekNews · YouTube(2 엔드포인트).
> 그중 키 필요: **Tavily, YouTube** (`.env`). 나머지 무키. GitHub은 무키(60req/h), `GITHUB_TOKEN` 설정 시 5000req/h.
> 발굴 레이어(D1·D2·D4)는 `fetch-discovery.js`로 구현됨. 스케줄러 Stage 1b에서 `--days 7 --features`로 자동 실행. D3·S1·C1~C5는 기존 파이프라인.

---

## 오케스트레이션

| 항목 | 값 |
|------|-----|
| 스케줄러 | macOS launchd `~/Library/LaunchAgents/com.aiwiki.daily.plist` (매일 08:00 KST) |
| 실행 스크립트 | `~/run-daily.sh` (레포 밖, WORK_DIR=정본 레포) |
| 자동 기상 | `pmset repeat wakeorpoweron` (스케줄 1분 전) |
| 전체 timeout | 30분 / Claude --print 단계별 10분 |
| 로그 | `logs/daily.log`, 단계별 원본 `logs/runs/{날짜}/`, 요약 `log.md` |
| 키워드 0개 시 | C단계 건너뛰고 "신규 키워드 없음" 커밋 |
| 콘텐츠 0개 시 | 전부 실패/차단 → "신규 키워드 없음" 커밋 |

---

## API 호출 요약

| API | 호출 단계 | 인증 | 무료 한도 | 비고 |
|-----|-----------|------|-----------|------|
| **OpenRouter** `/v1/models` | D1 | 무키 | 무제한(목록) | 전 제공사 모델 버전·출시일 |
| **GitHub Search** `/search/repositories` | D2 | 무키 60req/h (토큰 5000/h) | - | `topic:+created:>` 단일 모드 |
| **HN** firebase `topstories`+`item` | D3 | 무키 | 무제한 | top30 AI 필터 |
| **HN Algolia** `/search` | (보조) | 무키 | 무제한 | `created_at_i` 날짜범위 소급 가능 |
| **Tavily** `/search` | D3·D4·C1 | API 키(.env) | 1,000/월 | 웹 검색 + include_answer |
| **YouTube Data v3** `search`+`videos` | C1 | API 키(.env) | 10,000 units/일 | 키워드당 search×2 + videos×1 |
| **GeekNews** `/new`·`/weekly` | D3 | 무키 | - | HTML 스크래핑 |
| **Claude Code CLI** `--print` | S1·C2 | 구독 | - | 단계별 10분 timeout, 키워드별 격리 |

---

## 발굴 소스 — 레이어별 역할

| 레이어 | 소스 | 잡는 것 | 한계 |
|--------|------|---------|------|
| 모델 | OpenRouter | 신규 모델·버전 | 모델만(제품·플러그인 X) |
| 생태계·플러그인 | GitHub `topic:+created:>` | 신규 도구·플러그인 (caveman …) | `created:>`라 **오래된 유명 플러그인(OMC 등)은 제외** = catch-up 취지에 부합 |
| 버즈·개념 | GeekNews + HN + Reddit | 패턴·슬랭·화제 | GeekNews 소규모·KR 편중 |
| 기능·디테일 | Tavily | 위 항목들의 기능 | 제목→요약, LLM 추출 필요 |

### 선정 필터 (S1, keyword-select.md)
- **제외**: ① awesome/roadmap **메타리스트** ② 인기 없는 **무명 단발 skill** ③ 공격용 악성 AI 도구(WormGPT 등) ④ 기존 251개 중복
- **채택**: 독립 개념·확산 패턴 + **유명 named 플러그인은 이름 그대로**(별·교차언급으로 인기 판단; caveman·Superpowers처럼)

---

## 품질·복구

| 항목 | 방법 |
|------|------|
| 글 톤·구조 | CLAUDE.md 콘텐츠 컨벤션 자동 로드 |
| 검증 | C1 소스 품질이 곧 검증(쓰레기 소스 = 약한 키워드) + 키워드별 격리로 실패 1건이 배치 안 죽임 |
| 이상 감지 | `logs/runs/{날짜}/summary.md` 단계별 상태 |
| 롤백 | 매 실행 별도 커밋 → `git revert` |
| HOT 표식 | 매 실행 `HOT_IDS` 전체 재설정 (해당 배치 트렌딩 기준) |

---

## 관련 파일

```
scripts/run-daily.sh                  # launchd가 실행하는 6-stage 파이프라인 (레포 내, 버전관리)
~/Library/LaunchAgents/com.aiwiki.daily.plist  # → scripts/run-daily.sh 실행
fetch-trends.js                       # D3 트렌드 수집
fetch-discovery.js                    # D1·D2·D4 발굴 (모델·생태계·기능)
fetch-sources.js                      # C1 키워드별 소스
apply-entries.js / build.js           # C3 / C4
.claude/prompts/keyword-select.md     # S1 (TRENDS_JSON + DISCOVERY_JSON 입력)
.claude/prompts/content-generate.md   # C2
.env                                  # TAVILY_API_KEY, YOUTUBE_API_KEY, (GITHUB_TOKEN 선택)
```

> **백필**: 2개월 소급은 `node fetch-discovery.js --days 60 --features` 수동 실행.
