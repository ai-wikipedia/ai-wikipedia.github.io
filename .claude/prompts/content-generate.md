아래 검색 데이터를 바탕으로 각 키워드의 AI Wiki 항목을 작성하라.

## 키워드별 검색 데이터
{SOURCES_DATA}

## 기존 키워드 ID 목록 (rel 연결용)
{KEYWORDS_INDEX}

## 콘텐츠 작성 규칙

### sum (요약)
- 1~2문장. 이 기술이 뭔지 + 왜 쓰는지.
- 시장 규모나 수치로 시작 금지.

### det (상세)
- `<h4>`로 섹션 구분, `<p>`로 문단 구분. 줄글(prose) 중심, 글머리표 금지.
- 섹션 순서: 개념 설명 → 사용 예시 → 심화(선택) → 주의점(선택)
- 사용 예시는 개발자 관점으로 구체적 작성.
- `<strong>`은 핵심 개념/패턴명에만. `<code>`는 실제 코드/경로/명령어에만.

### refs (레퍼런스 채택)
- **det를 작성할 때 실제로 참고한 출처만** refs에 넣는다.
- det에서 정보를 가져오지 않은 URL은 아무리 공식 문서여도 넣지 않는다.
- type 분류: 공식 문서=official, 공식 블로그=blog, 논문=paper, 기타=tutorial.
- 최대 5개.

### videos (영상 채택)
- 수집된 youtube 결과에서 정확히 3개 채택 (영어 2 + 한국어 1).
- **조회수(viewCount)를 주요 판단 기준에 포함.**

### 기타
- **t (한국어 키워드, 카드 상단)**: 한글 발음 표기를 우선한다. 모델·제품명도 한글로 (예: Claude Opus 4.8 → `클로드 오퍼스 4.8`, Gemini 3 Pro → `제미나이 3 프로`, Sora → `소라`). 단 약어·대문자 스타일 브랜드(GPT·GLM·RAG·MCP·FLUX·OLMo 등)는 영문 유지. → 한글 SEO(란/뜻/의미 키워드)가 t 기반으로 생성되므로 한글 표기가 중요.
- **en (영문 정식명, 카드 하단)**: 영문 풀네임 (예: `Claude Opus 4.8 (Anthropic)`).
- tags: 2~4개
- c: prompting|model|tooling|data|agent|infra|safety|application
- born: 기술 최초 등장 연-월 (YYYY-MM)
- rel: 기존 키워드 ID 중 관련 있는 것만
- hot: 이번 트렌드에서 화제였으면 true, 아니면 false

### 번역
- sum과 det를 영어(en), 중국어(zh), 일본어(ja)로 번역.
- HTML 태그 유지, 기술 용어/`<code>`/브랜드명 번역 안 함.

## 출력 형식
JSON 배열만 출력하라. 설명이나 다른 텍스트 없이 순수 JSON만.

```json
[{
  "id": "kebab-case-id",
  "t": "한국어 키워드",
  "en": "English Name",
  "c": "category",
  "born": "YYYY-MM",
  "tags": ["태그1", "태그2"],
  "sum": "요약...",
  "det": "<h4>개념 설명</h4><p>...</p>",
  "rel": ["related-id-1"],
  "refs": [{"title": "제목", "url": "https://...", "type": "official"}],
  "videos": [{"title": "영상제목", "id": "youtubeId", "lang": "en"}],
  "hot": true,
  "translations": {
    "en": {"sum": "...", "det": "..."},
    "zh": {"sum": "...", "det": "..."},
    "ja": {"sum": "...", "det": "..."}
  }
}]
```
