# AI Wiki - AI 기술 키워드 카드

## 프로젝트 개요
AI 기술 키워드들을 **심플한 카드 UI**로 격자 배열하여 한눈에 파악할 수 있는 위키 사이트.
정적 파일(index.html + data.js), 서버 불필요.

- 위치: `~/dev/ai-wiki/`
- 진입점: `index.html`

---

## 핵심 컨셉

**Simple.** 요소를 최소화하고 키워드 자체가 주인공이 되는 카드 디자인.

### 플랜 원칙

- 각 항목은 `- 한 줄` 형식으로만 작성한다. 제목·부가 정보 없음.
- 구체적 구현 계획은 `/start-phase`로 시작한 뒤 PLAN-CURRENT.md에서 진행.
- 완료 내용은 PLAN-DONW.md에서 관리한다.
- 설명에는 "무엇을 구현할지"가 아니라 구현 방법이 아니라 생각해야 할 문제를 적는다.
- 구체적 구현 체크리스트는 PLAN-CURRENT.md에서 관리.


### 콘텐츠 원칙: "복잡한 AI 기술을 쉽게 이해"

이 사이트의 목적은 AI 기술을 **비전공자도 이해할 수 있도록** 쉽게 풀어내는 것이다.

- **한눈에 핵심만.** 길게 풀어쓰지 않는다. 핵심을 먼저, 꼭 필요한 내용만, 쉬운 말로. 비교·숫자는 표나 막대그래프로 보여준다. 글머리표 나열 대신 표.
- **실제로 어디에 쓰이는지 보여주기.** 기업명/수치 나열이 아니라, 이 기술이 실제로 어떤 상황에서 어떻게 동작하는지 구체적으로 묘사.
  - BAD: "Salesforce는 Agentforce로 100만 건의 지원 요청을 93% 정확도로 처리했다."
  - GOOD: "고객 문의가 들어오면 AI가 주문 내역을 찾아보고, 환불 규정을 확인하고, 답변까지 작성하는 것 — 이 전체 과정을 사람 없이 처리하는 게 AI 에이전트다."
- **개념 이해가 우선.** 해당 기술이 왜 필요하고, 어떤 문제를 해결하며, 실제로 많이 쓰이는 대표적인 활용 예시를 들어 설명. 기업 도입 사례나 시장 규모 나열은 지양.
- **친구에게 설명하듯.** 논문 요약이 아니라, 이 기술을 처음 듣는 사람에게 말로 풀어주는 톤.

### 콘텐츠 작성 컨벤션

#### sum (요약)
- 1~2문장, 짧고 쉽게. 이 기술이 뭔지 + 언제 쓰는지를 한번에 전달.
- 시장 규모, 사용자 수 같은 수치로 시작하지 않는다.
  - BAD: "GitHub Copilot은 2,000만 명 이상이 사용하며 Fortune 100의 90%가 도입했다."
  - GOOD: "여러 AI 에이전트가 역할을 나눠 하나의 작업을 함께 처리하는 시스템."

#### det (상세) 구조 (2026-10 개편 — 기준 문서: `gpt-6-sol`)

1. **`<h4>한눈에 보기</h4>`** — 유일한 고정 섹션. 무엇이고 언제 쓰는지 2~3문장 + 가능하면 비교표(등급·대안과의 차이).
2. **나머지 2~4개 섹션은 키워드마다 중요한 것으로** — 사용법(어디서·어떻게·언제)은 반드시 포함, 그 외 가격·이전 버전과의 차이·함께 쓰는 방식 등 그 키워드에서 독자에게 중요한 것.
3. **주의 섹션은 구체적 함정이 있을 때만** — 기본으로 붙이지 않는다.

- **섹션 제목은 요점을 말하는 짧은 문장** (예: "ChatGPT는 자동, API는 강도 조절", "temperature를 바꿀 수 없다"). "이렇게 쓴다", "주의할 점", "특징" 같은 일반 제목 금지 — 모든 문서가 같은 골격이면 저품질 대량 생성 신호.
- 섹션 3~5개, 문단 2~3문장, 본문(표 포함 텍스트) **1,100~1,500자** (1,000자 미만은 build.js 게이트로 비공개).
- **넣지 않는 것**: 학술 설명(아키텍처 세부·논문 용어), 관련 모델명 나열, 벤치마크 점수·통계 나열. 숫자는 선택에 영향을 주는 것만 최대 3~4개, 표·그래프로.

#### det 사용 예시 작성 규칙

- **개발자가 직접 쓰는 관점**으로 적는다. "고객 서비스에서 활용된다" 같은 산업 사례가 아니라, "Claude Code에서 ~하면 ~가 된다" 같은 실제 사용법.
- **사용법(어떻게)과 사용처(언제)를 같이** 적는다.
  - BAD: "대규모 리팩토링에서 효과적이다." (개괄적)
  - GOOD: "대규모 리팩토링에서는 파일 탐색과 수정을 여러 에이전트가 나눠 처리해서 컨텍스트 한계를 우회할 수 있다." (구체적)
- **관련 핫 기술과의 접목**을 적되, 해당 키워드 관점에서 적는다. 다른 기술의 독립 설명이 되면 안 됨.
  - BAD: "MCP는 AI 모델과 외부 시스템을 연결하는 프로토콜이다." (MCP 설명이 됨)
  - GOOD: "한 에이전트는 MCP로 GitHub 이슈를 읽고, 다른 에이전트는 MCP로 DB 스키마를 조회하고..." (멀티에이전트 관점 유지)

#### det HTML 규칙

- `<h4>` 섹션, `<p>` 짧은 문단, `<strong>`은 핵심 한두 곳, `<code>`는 실제 모델 ID·명령어·설정값에만.
- **표**: `<div class="tbl"><table><tr><th>…</th></tr><tr><td>…</td></tr></table></div>` — 열 2~4, 행 2~5, 강조 칸은 `<strong>`.
- **막대그래프**: `<div class="bars"><div class="bar"><span class="bar-label">이름</span><span class="bar-track"><span class="bar-fill" style="width:NN%"></span></span><span class="bar-val">값</span></div>…</div>` — 최댓값 100% 기준.
- **주석**: `<p class="note">단위·기준 설명</p>`
- 스타일은 build.js(k/ 페이지 `.body`)와 index.html(모달 `.modal-body`)에 정의되어 있다. 새 요소를 쓰면 두 곳 모두 추가할 것.
- 글머리표(ul/li) 금지 — 나열이 필요하면 표.

#### tags
- 2~4개. 검색에 실제로 도움 되는 키워드만.
- 해당 기술의 핵심 속성이나 관련 도구명.

#### 모범 사례: GPT-6 솔 카드
det 작성 시 `gpt-6-sol` 항목을 구조·밀도·표 사용 방식의 기준으로 참고한다 (스케줄러 프롬프트에도 EXAMPLE_DET로 자동 주입). 기존 문서 대부분은 아직 옛 줄글 형식이다.

---

## 카드 디자인

### 카드 구성 (3개 요소)
1. **카테고리 라벨** — 좌상단, 11px, 회색 텍스트
2. **키워드** — 카드 정중앙, 24px, font-weight 900, 진한 색
3. **서브텍스트** — 키워드 바로 아래, 11px, 회색. `en`이 `t`와 다를 때만 표시
   - 한글 키워드 → 영문명 표시 (하네스 엔지니어링 → Harness Engineering)
   - 영문 약어 → 풀네임 표시 (MCP → Model Context Protocol)

카드 안에 설명, 태그 등은 넣지 않는다. 모달에서만 표시.

### 카드 스타일
- 배경: `#fff` (흰색)
- 테두리: `1px solid #e4dfd8`
- 모서리: `border-radius: 14px`
- 최소 높이: `200px` (세로로 넉넉하게)
- 그리드: `minmax(280px, 1fr)`, gap 14px
- 호버: 배경 `#fdfcfa`, 테두리 약간 진해짐 — **모션(transform) 없음**

---

## 색상 체계 (클로드 라이트 테마)

| 용도 | 색상 | 코드 |
|------|------|------|
| 페이지 배경 | 따뜻한 베이지 | `#F3F0EB` |
| 카드 배경 | 흰색 | `#fff` |
| 카드 테두리 | 연한 베이지 | `#e4dfd8` |
| 키워드 텍스트 | 진한 브라운 | `#2d2a26` |
| 카테고리/보조 텍스트 | 회색 | `#a09888` |
| 액센트 (로고, 코드) | 클로드 오렌지 | `#C4613A` |
| 모달 본문 텍스트 | 중간 브라운 | `#5a5550` |
| 헤더 테두리 | 연한 베이지 | `#ddd8d0` |
| 코드 블록 배경 | 페이지 배경과 동일 | `#F3F0EB` |
| 필터 활성 | 오렌지 테두리+텍스트 | `#C4613A` |

---

## 모달 (상세보기)

카드 클릭 시 중앙 팝업 모달:
- 배경: `#fff`, 모서리 16px
- 구성: 카테고리 → 키워드(30px) → 영문명 → 본문 → 태그 → 관련 키워드
- 오버레이: 반투명 베이지 blur
- ESC 또는 오버레이 클릭으로 닫기

---

## 카테고리

| 키 | 이름 | 포함 키워드 예시 |
|----|------|----------------|
| prompting | 프롬프팅 | 프롬프트 엔지니어링, CoT, 시스템 프롬프트, 하네스 엔지니어링 |
| model | 모델 | LLM, Transformer, 파인튜닝, RLHF, 멀티모달 |
| tooling | 도구 | MCP, Claude Code, LangChain, 스킬, 훅, CLAUDE.md |
| data | 데이터 | RAG, 임베딩, 벡터DB, 청킹 |
| agent | 에이전트 | AI 에이전트, 멀티에이전트, ReAct, 에이전트 프레임워크 |
| infra | 인프라 | 컨텍스트 윈도우, API 게이트웨이, Eval |
| safety | 안전 | 환각, 가드레일, 프롬프트 인젝션 |
| application | 응용 | AI 코딩, 챗봇, AI 검색, 워크플로우 |

---

## 글(항목) 데이터 구조

JS 배열 `D`의 각 항목:

```js
{
  id: 'mcp',                          // 고유 ID (영문 kebab-case)
  t: 'MCP',                           // 한국어 키워드 (카드에 표시)
  en: 'Model Context Protocol',       // 영문명 (모달에서 표시)
  c: 'tooling',                        // 카테고리 키
  h: 5,                                // (미사용, 레거시)
  tags: ['프로토콜', 'Anthropic'],      // 태그 (검색용, 모달 하단)
  sum: '한 줄 요약',                    // 요약 (모달 본문 첫 문단)
  det: '<h4>...</h4><ul>...</ul>',     // 상세 HTML (모달 본문)
  rel: ['tool-use', 'claude-code'],    // 관련 항목 ID 배열
  refs: [                              // 레퍼런스 — det 작성 시 실제 참고한 출처만
    {title: '제목', url: 'https://...', type: 'official|blog|paper|tutorial'}
  ],
  videos: [                            // YouTube 영상 — 정확히 3개: 영어 2개 + 한국어 1개
    {title: '영상 제목', id: 'youtube_id', lang: 'ko|en'}
  ],
  added: '2026-04-01',                  // 위키 추가 날짜
  updated: '2026-04-01'               // 마지막 업데이트 날짜
}
```

### 항목 추가/수정 시
- 수동: `D` 배열에 객체 추가
- 자동: `/add-keyword` 스킬 사용 (서브에이전트가 리서치+검증+수집 처리)
- 자동/대량: `/scheduling-add` 스킬 사용
- **기존 데이터 보존**: 이미 refs/videos가 있으면 누락분만 채운다. 기존 항목을 덮어쓰지 않는다
- **refs = det 작성 시 실제 참고한 출처만**: det에서 정보를 가져오지 않은 URL은 넣지 않는다
- **videos 구성**: 영어 2개 + 한국어 1개 = 총 3개 고정

---

## 콘텐츠 작업 규칙

키워드 추가·수정·조사 등 모든 콘텐츠 작업 시 `.claude/agents/`의 서브에이전트 3개를 **반드시 병렬 실행**한다. 직접 처리 금지.

| 작업 | 사용 에이전트 |
|------|-------------|
| 키워드 추가 | researcher(콘텐츠+refs) + reference-collector(videos만) |
| 기존 항목 수정 | researcher(검증+refs) + reference-collector(videos 보충) |
| 트렌드 조사 | researcher |

에이전트 실행 후 메인에서 결과를 종합·검증하고 index.html에 반영한다.

### 트렌드 키워드 선정 기준

긱뉴스(GeekNews) 등 기술 커뮤니티를 기반으로 트렌드 키워드를 발굴할 때의 선정 기준:

1. **독립된 개념인가** — 특정 제품의 하위 기능이 아니라 AI 분야에서 독립적으로 설명할 수 있는 기술·도구·패턴이어야 한다.
2. **위키에 없는가** — 기존 키워드와 중복되지 않아야 한다.
3. **커뮤니티에서 화제인가** — 긱뉴스 top/new 글, 주간 뉴스에서 실제로 언급되었어야 한다.

선정 시 주의:
- 특정 제품의 기능(예: "Claude의 X 기능")이라도, 그 기능이 독립된 기술 패턴으로 확산되고 있다면 추가한다 (예: Claude Dispatch → 에이전트 디스패칭 패턴).
- 등장 시점이 오래됐더라도(예: 2022년) 최근 커뮤니티에서 재조명되고 있다면 추가 대상이다.
- "너무 세부적"이라는 이유로 쉽게 제외하지 않는다. 커뮤니티에서 언급될 정도면 충분히 중요하다.

---

## 자동화 구조 (스킬 + 에이전트 + 훅)

### 파일 구조
```
.claude/
├── agents/                        # 서브에이전트 정의 (대화형 /add-keyword용)
│   ├── researcher.md              # 제공된 검색 결과에서 콘텐츠 작성
│   └── reference-collector.md     # 제공된 검색 결과에서 refs/videos 채택
├── hooks/
│   ├── sync-claude-md.sh          # Edit/Write 후 CLAUDE.md 동기화 알림
│   └── check-plan-update.sh       # Stop 시 PLAN-CURRENT.md 업데이트 알림
├── prompts/                       # --print 모드 프롬프트 (스케줄러용)
│   ├── keyword-select.md          # Stage 2 키워드 선정 (TRENDS_JSON + DISCOVERY_JSON)
│   ├── content-generate.md        # Stage 4 본문 생성 (키워드별 격리, EXAMPLE_DET 모범 예시 주입)
│   └── translate.md               # Stage 4 번역 (EN/ZH/JA, 경량 모델)
├── skills/                        # 스킬 (슬래시 커맨드)
│   ├── add-keyword/SKILL.md       # /add-keyword — 키워드 1개 추가
│   ├── scheduling-add/SKILL.md     # /scheduling-add — 일일 자동 키워드 업데이트
│   ├── commit/SKILL.md            # /commit — 기능 단위 커밋+푸시
│   ├── start-phase/SKILL.md       # /start-phase — 플랜 항목 시작
│   ├── complete-phase/SKILL.md    # /complete-phase — 플랜 항목 완료
│   └── validate-plan/SKILL.md     # /validate-plan — 현재 플랜 검증
scripts/run-daily.sh               # 스케줄러 6-stage 파이프라인 (launchd가 실행)
scripts/llm-stage.js               # Stage 2·4 LLM 실행기 (구조화 출력·병렬·재시도·품질 게이트)
fetch-trends.js                    # D3 트렌드 수집 (HN + Tavily Reddit + GeekNews)
fetch-discovery.js                 # D1·D2·D4 발굴 (OpenRouter 모델 + GitHub 생태계 + Tavily 기능)
fetch-sources.js                   # 키워드별 웹+영상 검색 (Tavily + YouTube API)
.env                               # API 키 (TAVILY_API_KEY, YOUTUBE_API_KEY, GITHUB_TOKEN 선택)
```

### 데이터 수집 파이프라인

에이전트는 검색(API 호출)을 하지 않는다. 스크립트가 데이터를 수집하고, 에이전트는 수집된 데이터로 글쓰기/채택만 한다.

#### /scheduling-add 전체 흐름 (run-daily.sh 6-stage 파이프라인)

| Stage | 작업 | 실행 주체 | 비고 |
|-------|------|----------|------|
| 1 | 트렌드 수집 | `node fetch-trends.js` | HN API + Tavily (Reddit) + GeekNews /new 10개 + GeekNews 주간뉴스 |
| 1b | 발굴 | `node fetch-discovery.js --days 7 --features` | OpenRouter 신규 모델 + GitHub 신규 생태계 레포(토픽+생성일) + Tavily 기능 요약 (비치명적) |
| 2 | 키워드 선정 | `node scripts/llm-stage.js select` | 트렌드 + 발굴 + 기존 키워드 대조 → 중요도순 선정, 상한 `AIWIKI_MAX_KEYWORDS` |
| 3 | 소스 수집 | `node fetch-sources.js` | 키워드별 Tavily (웹 EN/KO) + YouTube API (EN/KO) |
| 4 | 콘텐츠 생성 | `node scripts/llm-stage.js content` | 본문(opus) → 번역(sonnet), 키워드별 병렬. det 1000자 미만은 반영 안 함 |
| 5 | data.js 반영 | `node apply-entries.js` | 중복 확인, 항목 추가 |
| 6 | 빌드 + 커밋 | `node build.js` + git | SEO 페이지 + sitemap + log.md + git push |

**build.js 품질 게이트 (AdSense 대응)**: 본문(det) 텍스트 1000자 미만 항목은 k/ 페이지를 **생성하지 않고(기존 파일 삭제 → 404)** sitemap·홈 그리드·카테고리 허브·관련 키워드 링크 어디에도 노출하지 않는다 (noindex만으로는 AdSense 심사 대상에서 빠지지 않음). index.html도 클라이언트에서 같은 기준으로 D를 필터링한다. det를 1000자 이상으로 보강하면 다음 빌드에서 자동 공개된다.

**LLM 호출 방식 (llm-stage.js)**: `claude --print --tools "" --setting-sources "" --strict-mcp-config`를 레포 밖 빈 디렉토리에서 실행해 도구·훅·플러그인·CLAUDE.md를 로드하지 않고, `--json-schema` 구조화 출력으로 JSON 깨짐을 막는다. 2026-10 최적화 전에는 풀 에이전트 모드라 실행 30분·실패율 70%였고, 이후 10개 키워드 5분·성공률 100%.

**실행 옵션 (환경변수)**: `AIWIKI_DISCOVERY_DAYS`(기본 7, 밀린 업데이트 시 확대) · `AIWIKI_MAX_KEYWORDS`(기본 5) · `AIWIKI_MAX_MODEL_KEYWORDS`(기본 1 — 모델 출시 카드 상한, 나머지는 개념·도구·패턴) · `AIWIKI_PARALLEL`(기본 3) · `AIWIKI_PUSH`(기본 1, 0이면 커밋만 하고 검토 대기) · `AIWIKI_TIMEOUT`(기본 1800초) · `AIWIKI_{SELECT,CONTENT,TRANSLATE}_MODEL/_EFFORT`. 커밋은 생성물(data.js·k·c·sitemap 등)만 `git add`한다.

- GeekNews /new는 10개만 수집 (하루 게시글 2~3건 수준의 소규모 커뮤니티)
- 키워드 0개 선정 시 Stage 3~5 건너뛰고 Stage 6으로 점프
- Stage 2, 4는 구조화 출력 실패 시 1회 재시도, 결과 JSON 출력 후 프로세스가 안 끝나면 즉시 정리
- 키워드 직접 지정 실행: `AIWIKI_KEYWORDS_FILE=list.json bash scripts/run-daily.sh` (LLM 선정 생략, 예: 이전 실패 후보 재시도)
- 기존 항목 번역만 재생성: `node scripts/llm-stage.js translate --ids a,b --out DIR` → `node apply-updates.js DIR` (apply-updates는 det·sum·refs·translations 중 있는 것만 교체, 구문 검증 통과 시에만 저장)
- 기존 글을 현재 작성 기준으로 변환: `node scripts/llm-stage.js restyle --ids a,b --out DIR` → `node apply-updates.js DIR` (기존 본문의 사실만 사용, 1,000자 미만·첫 섹션 불일치·글머리표면 반영 안 함). 본문 작성 기준은 `.claude/prompts/det-style.md` 한 곳에서 새 글(content-generate)과 변환(restyle)이 공유한다.
- **번역 동기화 (자동)**: `i18n-meta.json`에 번역 당시 한국어 sum+det 해시를 기록한다(apply-entries·apply-updates가 기록, `scripts/i18n-meta.js`). 매 실행의 빌드 직전에 `translate --stale`이 공개 항목 중 번역이 없거나 해시가 달라진 것만 다시 번역한다. 본문을 직접 심화한 뒤에도 다음 실행에서 번역이 자동으로 따라온다. 평소엔 0건.

#### /add-keyword 흐름

| 단계 | 작업 | 실행 주체 | 비고 |
|------|------|----------|------|
| 1 | 자료 수집 | `node fetch-sources.js` | Tavily (웹 EN/KO) + YouTube API (EN/KO) |
| 2 | 콘텐츠 작성 | **에이전트** (researcher) | 수집된 web 결과 기반 |
| 3 | refs/videos 채택 | **에이전트** (reference-collector) | 수집된 web+youtube에서 선정 |
| 4 | 검증 + data.js 반영 | 메인 컨텍스트 | |
| 5 | 번역 | **에이전트** | EN/ZH/JA |
| 6 | 빌드 | `node build.js` | SEO 페이지 + sitemap |

#### API 사용량

| API | 호출 수 | 무료 한도 |
|-----|---------|----------|
| Tavily (트렌드) | 1회/실행 (Reddit 검색) | 1,000/월 |
| Tavily (소스) | 2회/키워드 (EN/KO 검색) | (합산) |
| YouTube search.list | 2회/키워드 (EN/KO) | 10,000 units/일 |
| YouTube videos.list | 1회/키워드 (조회수) | (search와 합산) |
| GeekNews | 2회/실행 (/new + /weekly) | 무료 (HTML 스크래핑) |
| HN API | 31회/실행 (top + 개별) | 무료 |

### HOT 키워드 표식

카드 우측상단에 `▲` 표식으로 트렌딩 키워드를 표시한다.

- **데이터**: `index.html`의 `const HOT_IDS = [...]` 배열에 키워드 ID 나열
- **갱신 주체**: `/scheduling-add` 스킬
- **갱신 규칙**: 매 실행 시 HOT_IDS를 **전체 비우고** 해당 배치 기준으로 재설정
- **대상**: 해당 배치에서 트렌딩으로 식별된 키워드 (신규 + 기존 모두)

### 로컬 스케줄러 (launchd + pmset)

> **현재 상태 (2026-10-10): 매일 08:00 자동 발행으로 재가동.** (2026-08-30~10-09 AdSense 재심사 대응으로 중단했었음)
> 기본값: 최대 5개, 생성 후 바로 push. 본문 1000자 미만은 build.js 게이트로 자동 비공개.
> 중단: `launchctl bootout gui/$UID/com.aiwiki.daily && launchctl disable gui/$UID/com.aiwiki.daily` (unload만 하면 재부팅 시 되살아남)
> 재개: `launchctl enable gui/$UID/com.aiwiki.daily && launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.aiwiki.daily.plist`

- **스케줄**: 매일 08:00 KST (plist `Hour`/`Minute`로 조정)
- **자동 기상**: `pmset repeat wakeorpoweron MTWRFSU 07:59:00` — 잠자기 상태에서 스케줄 1분 전 자동 wake
- **방식**: macOS launchd → `scripts/run-daily.sh` → 6-stage 파이프라인
- **plist**: `~/Library/LaunchAgents/com.aiwiki.daily.plist` (→ `scripts/run-daily.sh` 실행)
- **스크립트**: `scripts/run-daily.sh` (레포 내, 버전관리)

#### 파이프라인 구조 (run-daily.sh)

| Stage | 실행 주체 | 동작 | timeout |
|-------|----------|------|---------|
| 1 | `node fetch-trends.js` | HN API + Tavily (Reddit) + GeekNews 수집 | - |
| 2 | `llm-stage.js select` | 키워드 선정 (구조화 출력) | 5분 |
| 3 | `node fetch-sources.js` | 키워드별 Tavily + YouTube API | - |
| 4 | `llm-stage.js content` | 본문 + refs/videos 채택 → 번역 (병렬) | 본문 10분·번역 5분 |
| 5 | `node apply-entries.js` | data.js에 반영 | - |
| 6 | 쉘 | build.js + log.md + git commit/push | - |

- **전체 timeout**: 30분
- **로그**: `logs/daily.log`, `logs/daily-err.log`
- **실행 기록**: `logs/runs/YYYY-MM-DD_HHMM/` (단계별 원본 데이터 + 결과)
- **실행 기록 요약**: `log.md` (날짜+시간별 추가/HOT/보강 키워드)
- **전제**: 맥북 잠자기 OK (pmset이 깨움), 전원 꺼짐은 불가
- **관리 명령**:
  - 등록 확인: `launchctl list com.aiwiki.daily`
  - 수동 실행: `launchctl start com.aiwiki.daily`
  - 시간 변경: plist의 `Hour`/`Minute` 수정 후 unload → load
  - wake 확인: `pmset -g sched`
  - wake 변경: `sudo pmset repeat wakeorpoweron MTWRFSU HH:MM:00`

### 키워드 추가 흐름
```
/add-keyword "Agentic RAG"
  │
  ├─ [스크립트] node fetch-sources.js     → 웹 20개 + 영상 20개 수집
  │
  ├─ [병렬] Agent(researcher.md)          → 수집 데이터로 콘텐츠 작성
  ├─ [병렬] Agent(reference-collector.md) → 수집 데이터에서 refs/videos 채택
  │
  └─ 메인: 결과 종합 → 검증 → data.js 수정
```

### 플랜 관리 흐름

플랜 파일 3종:
- `PLAN.md` — 마스터 백로그 (전체 구현 계획)
- `PLAN-CURRENT.md` — 현재 진행 중인 항목 (체크리스트 + 진행 로그)
- `PLAN-DONE.md` — 완료된 항목 아카이브

```
/start-phase 2-1
  │  PLAN.md에서 해당 항목 추출
  │  → PLAN-CURRENT.md에 체크리스트 생성
  │  → PLAN.md에 (진행 중) 표시
  │
  ▼  구현 작업 진행
  │
  │  [자동] Stop 훅 — 매 턴 종료 시
  │  index.html 변경 감지 → PLAN-CURRENT.md 업데이트 알림
  │
  ▼  모든 체크리스트 완료
  │
/complete-phase
     PLAN-CURRENT.md → PLAN-DONE.md에 아카이빙
     → PLAN.md에 [x] 체크 + 완료 날짜
     → PLAN-CURRENT.md 초기화
```

### 훅
| 이벤트 | 대상 | 동작 |
|--------|------|------|
| `PostToolUse` | `Edit\|Write` | CLAUDE.md 동기화 알림 |
| `Stop` | 전체 | PLAN-CURRENT.md 진행 상황 업데이트 알림 |

---

## 레이아웃 구조

```
┌─ header (sticky) ──────────────────────────────┐
│  [AI Wiki 로고]  [검색 input]  [필터 버튼들]     │
└────────────────────────────────────────────────┘
┌─ grid ─────────────────────────────────────────┐
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌──────┐ │
│  │카테고리  도트│  │        │  │        │  │      │ │
│  │        │  │        │  │        │  │      │ │
│  │ 키워드  │  │ 키워드  │  │ 키워드  │  │키워드│ │
│  │        │  │        │  │        │  │      │ │
│  └────────┘  └────────┘  └────────┘  └──────┘ │
│  ...                                           │
└────────────────────────────────────────────────┘
```

---

## 기술 스택

- Vanilla HTML/CSS/JS (프레임워크 없음)
- 폰트: Noto Sans KR (Google Fonts CDN)
- `index.html` (UI/로직) + `data.js` (HOT_IDS, D배열, I18N_CONTENT)

---

## 작업 규칙

- 정적 파일 구조 유지 (index.html + data.js)
- 외부 라이브러리 쓰지 않음 (CDN 폰트만 허용)
- 한국어 중심, 영문명은 모달에서만
- 디자인은 **심플** — 요소 최소화, 모션 최소화
- 호버에 transform(이동, 확대) 사용 금지
- 이모지 아이콘 사용 금지 (UI 요소로서)
