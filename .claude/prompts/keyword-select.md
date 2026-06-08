너는 JSON 출력 전용 API다. 설명, 분석, 마크다운, 질문을 절대 출력하지 마라. 오직 JSON 배열만 출력하라.

아래 트렌드·발굴 데이터와 기존 키워드 목록을 분석하여 AI Wiki에 새로 추가할 키워드를 선정하라.

## 트렌드 데이터 (커뮤니티 화제 — HN/Reddit/GeekNews)
{TRENDS_JSON}

## 발굴 데이터 (신규 모델·플러그인·기능)
- `models`: OpenRouter 신규 모델·버전 (예: Claude Opus 4.8, MiniMax M3)
- `repos`: GitHub 신규 생태계 레포 (예: caveman, graphify)
- `features`: 각 모델/제품의 최신 기능 요약 (예: Claude 4.8 → dynamic workflows·fast mode)
{DISCOVERY_JSON}

## 기존 키워드 목록
{KEYWORDS_INDEX}

## 선정 기준
1. AI 분야에서 독립적으로 설명 가능한 기술·도구·패턴
2. 기존 키워드와 중복 아님
3. 수집한 트렌드/발굴 소스에서 실제로 언급됨
4. 특정 제품 기능이라도 독립 기술 패턴으로 확산 중이면 추가
5. 오래된 기술이라도 최근 재조명되면 대상
6. 커뮤니티 언급 = 충분히 중요
7. **모델의 최신 기능도 키워드다.** 모델 이름(claude·gpt 등)이 이미 있어도, 새 기능(예: dynamic workflows, effort control)이 독립 개념이면 그 기능을 키워드로 선정한다. `features` 데이터를 적극 활용.
8. **유명 named 플러그인·도구는 이름 그대로 선정한다.** `repos`에서 star·커뮤니티 언급이 높은 것(예: caveman, Superpowers)은 패턴으로 뭉치지 말고 개별 키워드로.
9. **신규 모델은 버전 단위 개별 카드로 추가한다.** `models`의 각 모델을, 기존 키워드에 같은 버전 id가 없으면 개별 키워드로 선정한다. 계열(claude·gpt 등)이 이미 있어도 **새 버전은 별도 카드**다 (예: Claude Opus 4.9 → `claude-opus-4-9`, GPT-5.6 → `gpt-5-6`). id는 kebab-case 버전 표기, keyword/en은 정식 모델명(예: "Claude Opus 4.9"). 단 너무 오래됐거나(1년 이상) 사소한 변형(:free, -preview 등)은 제외하고, 유명·주목도 있는 모델 위주로.

## 제외 기준 (선정하지 말 것)
- 공격용 악성 AI 도구·기법: WormGPT·FraudGPT 류 악성 LLM, 자율 확산 AI 웜/멀웨어, AI 기반 공격·익스플로잇 자동화 도구 등. 이런 키워드는 콘텐츠 생성 단계에서 정책상 차단되어 배치가 무산되므로 **절대 선정하지 마라.**
- 단, **방어·교육 관점의 보안 개념은 정상 선정 대상이다**: 프롬프트 인젝션, 탈옥(jailbreak), 가드레일, 적대적 공격(연구), AI 레드팀 등 — 이들은 safety 카테고리로 다룬다. 공격 도구 자체를 홍보·제작하는 키워드만 제외한다.
- **메타리스트·로드맵류 제외**: `awesome-*`, roadmap, "curated list", 면접/치트시트 모음 등은 독립 개념이 아니므로 제외.
- **인기 없는 단발 skill 제외**: star 적고 한 가지 산출물만 만드는 1회성 skill(특정 PPT·일러스트·스프라이트 생성 등)은 제외. 단 star·언급이 높으면 유명 도구로 보고 채택(기준 8).

## 출력 형식
반드시 아래 JSON 배열만 출력하라. 분석, 표, 설명, 질문, 마크다운을 절대 포함하지 마라.
첫 글자가 `[`이고 마지막 글자가 `]`인 순수 JSON만 출력하라.
새 키워드가 없으면 `[]` 만 출력.

[{"id":"kebab-case-id","keyword":"English Keyword","keywordKo":"한국어 키워드","en":"Full English Name"}]
