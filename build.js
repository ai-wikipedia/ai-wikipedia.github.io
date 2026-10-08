#!/usr/bin/env node
// 키워드별 독립 SEO 페이지 생성 + sitemap 갱신
// 사용법: node build.js

const fs = require('fs');
const path = require('path');

// data.js 로드 (const → var로 변환하여 eval 스코프 노출)
const dataContent = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf-8')
  .replace(/^const /gm, 'var ');
eval(dataContent);

const CATS = {prompting:'프롬프팅',model:'모델',tooling:'도구',data:'데이터',agent:'에이전트',infra:'인프라',safety:'안전',application:'응용'};
const BASE = 'https://aiwiki.work';
const OUT = path.join(__dirname, 'k');
const OUTC = path.join(__dirname, 'c');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
if (!fs.existsSync(OUTC)) fs.mkdirSync(OUTC);

// 카테고리 허브 소개문 (토픽 클러스터 페이지용 — 각기 다른 고유 줄글)
const CAT_INTRO = {
  prompting: 'AI에게 원하는 답을 얻으려면 "무엇을 묻느냐"만큼 "어떻게 묻느냐"가 중요합니다. 같은 모델이라도 질문을 어떻게 설계하느냐에 따라 결과물의 품질이 몇 배씩 갈리기 때문에, 프롬프트를 다루는 기술은 하나의 독립된 분야가 됐습니다. 처음이라면 프롬프트 엔지니어링에서 전체 그림을 잡고, 모델이 단계적으로 생각하게 만드는 사고의 사슬(CoT), 모델의 기본 성격을 정하는 시스템 프롬프트로 넓혀가는 순서를 권합니다. 퓨샷·제로샷 같은 예시 제공 전략, XML 프롬프팅 같은 구조화 기법, 프롬프트를 코드처럼 버전 관리하는 프롬프트 매니지먼트까지 — 모델을 정확하게 다루기 위한 기법들을 모았습니다.',
  model: 'GPT·Claude·Gemini 같은 대규모 언어 모델은 AI의 "두뇌"에 해당합니다. 이 분야의 용어는 크게 세 갈래입니다. 모델이 글을 이해하고 생성하는 원리(트랜스포머, 어텐션, 토큰), 모델을 만들고 다듬는 과정(사전학습, 파인튜닝, RLHF, LoRA), 그리고 모델을 가볍고 빠르게 만드는 기술(양자화, 증류, MoE)입니다. LLM 항목에서 출발해 트랜스포머로 내려가면 뉴스에서 스치던 용어들이 하나의 이야기로 연결됩니다. 멀티모달·추론 모델처럼 최근 모델들이 어디로 진화하고 있는지 보여주는 키워드도 함께 모았습니다.',
  tooling: 'AI를 실제 개발과 업무에 활용하게 해주는 도구와 표준입니다. 모델 자체는 텍스트를 주고받는 것밖에 못 하기 때문에, 파일을 읽고 명령을 실행하고 외부 서비스에 연결하는 일은 전부 도구 계층이 담당합니다. 터미널에서 코드를 짜주는 Claude Code, 모델과 외부 시스템을 잇는 표준 프로토콜 MCP, 에이전트 애플리케이션을 조립하는 LangChain이 대표적입니다. 도구를 확장하는 방식인 스킬과 훅, 프로젝트 규칙을 심는 CLAUDE.md처럼 실무에서 매일 마주치는 설정 개념들도 함께 다룹니다. AI 코딩을 시작했다면 이 카테고리의 용어부터 부딪히게 됩니다.',
  data: 'AI가 최신 정보나 내 문서를 근거로 답하려면 데이터를 잘 다뤄야 합니다. 모델은 학습 시점 이후의 일을 모르고 회사 내부 문서도 본 적이 없기 때문에, 필요한 지식을 검색해서 모델에게 건네주는 파이프라인이 필요합니다. 그 뼈대가 RAG이고, 문서를 검색 가능한 형태로 바꾸는 임베딩, 그것을 저장·검색하는 벡터 DB, 문서를 적절한 크기로 자르는 청킹이 각 단계를 담당합니다. 검색 품질을 끌어올리는 리랭킹·하이브리드 검색, 지식을 그래프로 연결하는 GraphRAG까지 — 검색과 지식 연결에 관한 개념들을 순서대로 모았습니다.',
  agent: '스스로 판단하고 도구를 써서 일을 끝까지 처리하는 것이 AI 에이전트입니다. 한 번 묻고 한 번 답하는 챗봇과 달리, 에이전트는 목표를 받으면 계획을 세우고 도구를 골라 쓰고 결과를 확인하며 여러 단계를 돌립니다. AI 에이전트 항목에서 기본 그림을 잡은 뒤, 생각과 행동을 번갈아 반복하는 ReAct 패턴, 여러 에이전트가 역할을 나누는 멀티에이전트, 작업 기억을 유지하는 에이전트 메모리로 확장해보세요. 에이전트끼리 통신하는 A2A 같은 프로토콜, 브라우저를 조작하는 컴퓨터 유즈, 에이전트를 평가하는 방법론까지 — "알아서 일하는 AI"를 이해하는 키워드를 모았습니다.',
  infra: 'AI 시스템을 실제로 안정적으로 굴리려면 뒷단의 기반이 필요합니다. 데모에서는 잘 되던 것이 실서비스에서 무너지는 이유는 대부분 이 계층에 있습니다. 모델이 한 번에 기억할 수 있는 양을 정하는 컨텍스트 윈도우, 응답 품질을 수치로 검증하는 평가(Eval), 같은 질문에 대한 비용을 아끼는 프롬프트 캐싱, 여러 모델을 하나의 창구로 묶는 LLM 게이트웨이가 대표 개념입니다. GPU 클러스터·배치 추론·레이턴시 최적화처럼 서빙 성능에 관한 용어, 관측가능성·트레이싱처럼 운영 품질에 관한 용어까지, 운영과 확장에 관한 개념들을 모았습니다.',
  safety: 'AI를 안전하고 믿을 수 있게 쓰기 위한 개념입니다. 모델은 모르는 것도 그럴듯하게 지어내고(환각), 악의적인 입력에 속아 하지 말아야 할 일을 하기도 합니다(프롬프트 인젝션, 탈옥). 이런 위험을 이해하는 것이 첫걸음이고, 출력을 걸러내는 가드레일, 모델 스스로 원칙을 지키게 하는 정렬과 헌법적 AI, 워터마킹·딥페이크 탐지 같은 기술이 방어선을 이룹니다. AI 서비스를 만들거나 도입하는 입장이라면 환각과 프롬프트 인젝션 두 항목만은 꼭 읽어두시길 권합니다. 위험을 이해하고 막는 기술들을 모았습니다.',
  application: 'AI가 실제 제품과 현장에서 어떻게 쓰이는지에 관한 개념입니다. 모델과 기법이 재료라면 이 카테고리는 완성된 요리에 해당합니다. 개발 현장을 바꾸고 있는 AI 코딩과 바이브 코딩, 검색의 판도를 흔드는 AI 검색, 가장 오래된 응용인 챗봇, 반복 업무를 자동화하는 AI 워크플로우가 큰 줄기입니다. 텍스트를 넘어 이미지·영상·음성을 만드는 생성 기술, 문서를 읽고 처리하는 문서 AI, 코드 리뷰·테스트 생성처럼 개발 파이프라인 곳곳에 스며든 세부 응용까지 — 기술이 실제 가치로 바뀌는 지점의 키워드를 모았습니다.'
};

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g,' ').trim();
}

// 한글 받침 여부에 따라 "란?" / "이란?" 선택 (바이브 코딩이란?, 제미나이란?)
function ranSuffix(word) {
  const last = (word || '').trim().slice(-1);
  const code = last ? last.charCodeAt(0) : 0;
  if (code >= 0xAC00 && code <= 0xD7A3) {
    const hasJongseong = (code - 0xAC00) % 28 !== 0;
    return hasJongseong ? '이란?' : '란?';
  }
  return '란?'; // 비한글(영문 약어·숫자)은 기본 "란?"
}

// D를 id로 빠르게 조회할 수 있도록 맵 생성
const DMap = {};
for (const e of D) DMap[e.id] = e;

// 품질 게이트: 본문(det) 텍스트가 이 길이 미만이면 k/ 페이지를 만들지 않고(404) sitemap에서도 빼며,
// 허브·관련 키워드·홈 목록 어디에서도 링크하지 않는다 (AdSense 심사자에게 노출되지 않게)
const THIN_THRESHOLD = 1000;
const indexableIds = new Set(D.filter(e => stripTags(e.det || '').length >= THIN_THRESHOLD).map(e => e.id));

// dateModified가 datePublished보다 과거인 데이터 모순 방지 (updated < added인 항목 존재)
function modifiedDate(e) {
  const a = e.added || '';
  const u = e.updated || '';
  return (u && u >= a) ? u : a;
}

let removedThin = 0;
for (const e of D) {
  // 얇은 페이지(본문 1000자 미만)는 파일 자체를 만들지 않고, 이전 빌드 파일도 지운다 (→ 404).
  // noindex만으로는 AdSense 심사 대상에서 빠지지 않는다 ("사이트의 모든 페이지를 검토할 수 있음").
  // 본문을 1000자 이상으로 보강하면 다음 빌드에서 자동으로 다시 생성된다.
  if (!indexableIds.has(e.id)) {
    const stale = path.join(OUT, `${e.id}.html`);
    if (fs.existsSync(stale)) { fs.unlinkSync(stale); removedThin++; }
    continue;
  }

  // 1. 검색 의도 반영 타이틀: "MCP란? (Model Context Protocol) — AI Wiki"
  // 영문명 끝의 개발사 표기 "(Anthropic)"는 제목에서 뺀다 → "클로드 오퍼스 5.5란? (Claude Opus 5.5)" (괄호 중첩 방지)
  const enTitle = (e.en || '').replace(/\s*\([^)]*\)\s*$/, '');
  const suffix = enTitle && enTitle !== e.t ? ` (${enTitle})` : '';
  const ran = ranSuffix(e.t);
  const title = `${e.t}${ran}${suffix} — AI Wiki`;
  // 2. 검색 의도 반영 디스크립션: "MCP란 무엇인가? ..."
  const rawDesc = stripTags(e.sum);
  const desc = `${e.t}${ran} ${rawDesc}`.slice(0, 160);
  const url = `${BASE}/k/${e.id}.html`;
  const catName = CATS[e.c] || e.c;

  // 관련 키워드 내부 링크
  const relLinks = (e.rel || [])
    .filter(id => DMap[id] && indexableIds.has(id))
    .map(id => `<a href="${BASE}/k/${id}.html">${escHtml(DMap[id].t)}</a>`)
    .join(', ');

  // 참고 자료 (출처) — 페이지 신뢰도(E-E-A-T) 보강
  const REF_LABEL = {official:'공식', blog:'블로그', paper:'논문', tutorial:'튜토리얼', news:'뉴스', doc:'문서'};
  const refItems = (e.refs || [])
    .filter(r => r && r.url && r.title)
    .map(r => {
      const lbl = REF_LABEL[r.type] || '';
      return `<li><a href="${escHtml(r.url)}" target="_blank" rel="nofollow noopener">${escHtml(r.title)}</a>${lbl ? ` <span class="ref-type">${lbl}</span>` : ''}</li>`;
    }).join('');
  const refsBlock = refItems ? `<div class="refs"><b>참고 자료</b><ul>${refItems}</ul></div>` : '';

  // 관련 영상 (썸네일 링크 — iframe 대신 이미지 링크로 쿠키/무게 최소화)
  const vidItems = (e.videos || [])
    .filter(v => v && v.id && v.title)
    .map(v => `<a class="video-item" href="https://www.youtube.com/watch?v=${escHtml(v.id)}" target="_blank" rel="noopener"><img src="https://i.ytimg.com/vi/${escHtml(v.id)}/mqdefault.jpg" alt="${escHtml(v.title)}" loading="lazy" width="160" height="90"><span>${escHtml(v.title)}</span></a>`)
    .join('');
  const videosBlock = vidItems ? `<div class="videos"><b>관련 영상</b><div class="video-list">${vidItems}</div></div>` : '';



  // 3. BreadcrumbList JSON-LD
  const breadcrumb = {
    "@context":"https://schema.org",
    "@type":"BreadcrumbList",
    "itemListElement":[
      {"@type":"ListItem","position":1,"name":"AI Wiki","item":BASE+"/"},
      {"@type":"ListItem","position":2,"name":catName,"item":BASE+"/c/"+e.c+".html"},
      {"@type":"ListItem","position":3,"name":e.t,"item":url}
    ]
  };

  // 4. Article JSON-LD (datePublished/dateModified)
  const article = {
    "@context":"https://schema.org",
    "@type":"Article",
    "headline": `${e.t}${suffix}`,
    "description": rawDesc.slice(0, 160),
    "url": url,
    "datePublished": e.added || undefined,
    "dateModified": modifiedDate(e) || undefined,
    "author":{"@type":"Organization","name":"AI Wiki"},
    "publisher":{"@type":"Organization","name":"AI Wiki","url":BASE+"/"},
    "mainEntityOfPage":{"@type":"WebPage","@id":url}
  };

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7817461938422229" crossorigin="anonymous"></script>
<meta name="google-adsense-account" content="ca-pub-7817461938422229">
<title>${escHtml(title)}</title>
<meta name="description" content="${escHtml(desc)}">
<meta name="keywords" content="${escHtml(e.t)}${e.en && e.en !== e.t ? `, ${escHtml(e.en)}` : ''}, ${escHtml(e.tags.join(', '))}, AI 용어">
<meta property="og:type" content="article">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${BASE}/og-thumbnail.png?v=2">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="600">
<meta property="og:site_name" content="AI Wiki">
<meta property="og:locale" content="ko_KR">
<meta property="article:published_time" content="${e.added || ''}">
<meta property="article:modified_time" content="${modifiedDate(e) || ''}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(title)}">
<meta name="twitter:description" content="${escHtml(desc)}">
<meta name="twitter:image" content="${BASE}/og-thumbnail.png?v=2">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="ko" href="${url}">
<script type="application/ld+json">
${JSON.stringify({
  "@context":"https://schema.org",
  "@type":"DefinedTerm",
  "name": e.t,
  "alternateName": e.en || undefined,
  "description": stripTags(e.sum),
  "url": url,
  "inDefinedTermSet": {
    "@type":"DefinedTermSet",
    "name":"AI Wiki",
    "url": BASE + "/"
  }
}, null, 2)}
</script>
<script type="application/ld+json">
${JSON.stringify(breadcrumb, null, 2)}
</script>
<script type="application/ld+json">
${JSON.stringify(article, null, 2)}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Noto Sans KR',sans-serif;background:#F3F0EB;color:#4a4540;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 20px}
  .wrap{max-width:720px;width:100%;background:#fff;border-radius:16px;padding:48px 40px;border:1px solid #e4dfd8}
  .cat{font-size:11px;color:#a09888;margin-bottom:8px}
  h1{font-size:30px;font-weight:900;color:#2d2a26;margin-bottom:4px}
  .en{font-size:13px;color:#a09888;margin-bottom:24px}
  .body{color:#5a5550;line-height:1.8;font-size:15px}
  .body h4{font-size:16px;font-weight:700;color:#2d2a26;margin:24px 0 8px}
  .body p{margin-bottom:14px}
  .body code{background:#F3F0EB;padding:2px 6px;border-radius:4px;font-size:13px;color:#C4613A}
  .body strong{font-weight:700;color:#2d2a26}
  .tags{margin-top:24px;display:flex;flex-wrap:wrap;gap:8px}
  .tags span{background:#F3F0EB;color:#a09888;padding:4px 12px;border-radius:20px;font-size:12px}
  .related{margin-top:36px;padding-top:28px;border-top:1px solid #e4dfd8;font-size:14px;color:#5a5550;line-height:1.8}
  .related b{color:#2d2a26;font-weight:700}
  .related a{color:#C4613A;text-decoration:none;font-weight:500}
  .related a:hover{text-decoration:underline}
  .back{display:inline-block;margin-top:32px;color:#C4613A;text-decoration:none;font-size:14px;font-weight:700}
  .back:hover{text-decoration:underline}
  .added-date{margin-top:20px;text-align:right;font-size:11px;color:#a09888}
  .site-footer{max-width:720px;width:100%;margin:28px auto 0;text-align:center;font-size:13px;color:#a09888;line-height:1.9}
  .site-footer a{color:#a09888;text-decoration:none}
  .site-footer a:hover{color:#C4613A}
  .site-footer .copy{margin-top:6px;font-size:11px;color:#b8b0a4}
  .topnav{max-width:720px;width:100%;display:flex;align-items:center;gap:16px;margin-bottom:20px}
  .topnav-logo{font-size:20px;font-weight:900;color:#C4613A;text-decoration:none}
  .topnav-links{margin-left:auto;display:flex;gap:14px}
  .topnav-links a{font-size:13px;color:#a09888;text-decoration:none}
  .topnav-links a:hover{color:#C4613A}
  .refs{margin-top:32px;padding-top:24px;border-top:1px solid #e4dfd8;font-size:14px;color:#5a5550}
  .refs b{color:#2d2a26;font-weight:700;display:block;margin-bottom:10px}
  .refs ul{margin:0;padding:0;list-style:none}
  .refs li{margin-bottom:8px;line-height:1.6}
  .refs a{color:#C4613A;text-decoration:none}
  .refs a:hover{text-decoration:underline}
  .ref-type{font-size:11px;color:#a09888;margin-left:6px}
  .videos{margin-top:28px}
  .videos b{color:#2d2a26;font-weight:700;display:block;margin-bottom:12px;font-size:14px}
  .video-list{display:flex;flex-direction:column;gap:12px}
  .video-item{display:flex;align-items:center;gap:12px;text-decoration:none;color:#5a5550}
  .video-item img{border-radius:8px;flex-shrink:0;width:160px;height:90px;object-fit:cover}
  .video-item span{font-size:14px;line-height:1.5}
  .video-item:hover span{color:#C4613A}
  @media(max-width:768px){.video-item img{width:120px;height:68px}}
</style>
</head>
<body>
<header class="topnav">
  <a class="topnav-logo" href="${BASE}/">AI Wiki</a>
  <nav class="topnav-links">
    <a href="${BASE}/">홈</a>
    <a href="${BASE}/c/${e.c}.html">${escHtml(catName)}</a>
    <a href="${BASE}/about.html">소개</a>
  </nav>
</header>
<div class="wrap">
  <div class="cat">${escHtml(catName)}</div>
  <h1>${escHtml(e.t)}</h1>
  ${e.en && e.en !== e.t ? `<div class="en">${escHtml(e.en)}</div>` : '<div class="en"></div>'}
  <div class="body"><p>${e.sum}</p>${e.det}</div>
  ${e.tags.length ? `<div class="tags">${e.tags.map(t=>`<span>#${escHtml(t)}</span>`).join('')}</div>` : ''}
  ${relLinks ? `<div class="related"><b>관련 키워드</b> ${relLinks}</div>` : ''}
  ${refsBlock}
  ${videosBlock}
  <a class="back" href="${BASE}/#${e.id}">← AI Wiki에서 더 보기</a>
  ${e.added ? `<div class="added-date">updated at ${modifiedDate(e)}</div>` : ''}
</div>
<footer class="site-footer">
  <a href="${BASE}/">홈</a> · <a href="${BASE}/about.html">소개</a> · <a href="${BASE}/privacy.html">개인정보처리방침</a> · <a href="${BASE}/contact.html">문의</a> · <a href="${BASE}/updates.html">업데이트 기록</a>
  <div class="copy">© 2026 AI Wiki · aiwiki.work</div>
</footer>
</body>
</html>`;

  fs.writeFileSync(path.join(OUT, `${e.id}.html`), html);
}

// ── 카테고리 허브 페이지 생성 (토픽 클러스터 + 내부 링크 강화) ──
const hubBuilt = [];
for (const cat of Object.keys(CATS)) {
  const catName = CATS[cat];
  const items = D.filter(e => e.c === cat && indexableIds.has(e.id)).sort((a, b) => a.t.localeCompare(b.t, 'ko'));
  if (!items.length) continue;
  const hubUrl = `${BASE}/c/${cat}.html`;
  const intro = CAT_INTRO[cat] || '';
  const listHtml = items.map(e => {
    const en = e.en && e.en !== e.t ? ` <span class="hub-en">${escHtml(e.en)}</span>` : '';
    return `<li><a class="hub-link" href="${BASE}/k/${e.id}.html"><span class="hub-t">${escHtml(e.t)}${en}</span><span class="hub-sum">${escHtml(stripTags(e.sum))}</span></a></li>`;
  }).join('');
  const otherCats = Object.keys(CATS).filter(c => c !== cat && D.some(e => e.c === c && indexableIds.has(e.id)))
    .map(c => `<a href="${BASE}/c/${c}.html">${escHtml(CATS[c])}</a>`).join(' · ');
  const itemListLd = {
    "@context": "https://schema.org", "@type": "CollectionPage",
    "name": `${catName} — AI 기술 키워드 모음`, "url": hubUrl,
    "mainEntity": {
      "@type": "ItemList", "numberOfItems": items.length,
      "itemListElement": items.map((e, i) => ({ "@type": "ListItem", "position": i + 1, "name": e.t, "url": `${BASE}/k/${e.id}.html` }))
    }
  };
  const breadcrumbLd = {
    "@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "AI Wiki", "item": BASE + "/" },
      { "@type": "ListItem", "position": 2, "name": catName, "item": hubUrl }
    ]
  };
  const hubDesc = `${catName} 분야의 AI 용어 ${items.length}개를 비전공자도 이해할 수 있게 쉽게 정리했습니다. ${intro}`.slice(0, 160);
  const hubHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="google-adsense-account" content="ca-pub-7817461938422229">
<title>${escHtml(catName)} — AI 기술 키워드 모음 | AI Wiki</title>
<meta name="description" content="${escHtml(hubDesc)}">
<meta name="keywords" content="${escHtml(catName)}, AI ${escHtml(catName)}, AI 용어, 인공지능 ${escHtml(catName)}, AI 사전">
<meta property="og:type" content="website">
<meta property="og:title" content="${escHtml(catName)} — AI 기술 키워드 모음 | AI Wiki">
<meta property="og:description" content="${escHtml(hubDesc)}">
<meta property="og:url" content="${hubUrl}">
<meta property="og:image" content="${BASE}/og-thumbnail.png?v=2">
<meta property="og:site_name" content="AI Wiki">
<meta property="og:locale" content="ko_KR">
<link rel="canonical" href="${hubUrl}">
<script type="application/ld+json">
${JSON.stringify(breadcrumbLd, null, 2)}
</script>
<script type="application/ld+json">
${JSON.stringify(itemListLd, null, 2)}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Noto Sans KR',sans-serif;background:#F3F0EB;color:#4a4540;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 20px}
  .topnav{max-width:760px;width:100%;display:flex;align-items:center;gap:16px;margin-bottom:20px}
  .topnav-logo{font-size:20px;font-weight:900;color:#C4613A;text-decoration:none}
  .topnav-links{margin-left:auto;display:flex;gap:14px}
  .topnav-links a{font-size:13px;color:#a09888;text-decoration:none}
  .topnav-links a:hover{color:#C4613A}
  .wrap{max-width:760px;width:100%;background:#fff;border-radius:16px;padding:44px 40px;border:1px solid #e4dfd8}
  .cat{font-size:11px;color:#a09888;margin-bottom:8px}
  h1{font-size:30px;font-weight:900;color:#2d2a26;margin-bottom:16px}
  .hub-intro{color:#5a5550;line-height:1.8;font-size:15px;margin-bottom:28px}
  .hub-list{list-style:none;display:flex;flex-direction:column;gap:2px}
  .hub-link{display:block;padding:12px 14px;border-radius:10px;text-decoration:none;color:inherit}
  .hub-link:hover{background:#fdfcfa}
  .hub-t{display:block;font-size:15px;font-weight:700;color:#2d2a26}
  .hub-en{font-size:12px;font-weight:400;color:#a09888;margin-left:4px}
  .hub-sum{display:block;font-size:13px;color:#5a5550;line-height:1.6;margin-top:2px}
  .hub-nav{max-width:760px;width:100%;margin-top:24px;font-size:13px;color:#a09888;line-height:1.9}
  .hub-nav a{color:#C4613A;text-decoration:none}
  .hub-nav a:hover{text-decoration:underline}
  .site-footer{max-width:760px;width:100%;margin-top:24px;text-align:center;font-size:13px;color:#a09888;line-height:1.9}
  .site-footer a{color:#a09888;text-decoration:none}
  .site-footer a:hover{color:#C4613A}
  .site-footer .copy{margin-top:6px;font-size:11px;color:#b8b0a4}
</style>
</head>
<body>
<header class="topnav">
  <a class="topnav-logo" href="${BASE}/">AI Wiki</a>
  <nav class="topnav-links">
    <a href="${BASE}/">홈</a>
    <a href="${BASE}/about.html">소개</a>
  </nav>
</header>
<div class="wrap">
  <div class="cat">AI Wiki · 분야별 키워드</div>
  <h1>${escHtml(catName)}</h1>
  <div class="hub-intro">${escHtml(intro)}</div>
  <ul class="hub-list">${listHtml}</ul>
</div>
<nav class="hub-nav">다른 분야 둘러보기: ${otherCats}</nav>
<footer class="site-footer">
  <a href="${BASE}/">홈</a> · <a href="${BASE}/about.html">소개</a> · <a href="${BASE}/privacy.html">개인정보처리방침</a> · <a href="${BASE}/contact.html">문의</a> · <a href="${BASE}/updates.html">업데이트 기록</a>
  <div class="copy">© 2026 AI Wiki · aiwiki.work</div>
</footer>
</body>
</html>`;
  fs.writeFileSync(path.join(OUTC, `${cat}.html`), hubHtml);
  hubBuilt.push(cat);
}
console.log(`✓ ${hubBuilt.length}개 카테고리 허브 페이지 생성 → /c/`);

// ── 업데이트 기록 페이지 (문서별 실제 추가·수정 날짜로 운영·유지관리 이력을 공개) ──
const byDate = {};
const slot = d => (byDate[d] = byDate[d] || { added: [], updated: [] });
for (const e of D) {
  if (!indexableIds.has(e.id)) continue;
  const add = e.added || '';
  const mod = modifiedDate(e) || '';
  if (add) slot(add).added.push(e);
  if (mod && mod !== add) slot(mod).updated.push(e);
}
const UPDATE_DATES = Object.keys(byDate).sort().reverse().slice(0, 24);
const linkList = list => list.sort((a, b) => a.t.localeCompare(b.t, 'ko'))
  .map(e => `<a href="${BASE}/k/${e.id}.html">${escHtml(e.t)}</a>`).join(' · ');
const updatesBody = UPDATE_DATES.map(d => {
  const { added, updated } = byDate[d];
  return `<section class="upd"><h2>${d}</h2>`
    + (added.length ? `<p><b>새 문서 ${added.length}개</b> ${linkList(added)}</p>` : '')
    + (updated.length ? `<p><b>내용 보강 ${updated.length}개</b> ${linkList(updated)}</p>` : '')
    + `</section>`;
}).join('\n');
const updatesHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="google-adsense-account" content="ca-pub-7817461938422229">
<title>업데이트 기록 — AI Wiki</title>
<meta name="description" content="AI Wiki 문서가 언제 추가되고 보강됐는지 날짜별로 정리한 업데이트 기록입니다.">
<link rel="canonical" href="${BASE}/updates.html">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Noto Sans KR',sans-serif;background:#F3F0EB;color:#4a4540;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 20px}
  .topnav{max-width:720px;width:100%;display:flex;align-items:center;gap:16px;margin-bottom:20px}
  .topnav-logo{font-size:20px;font-weight:900;color:#C4613A;text-decoration:none}
  .topnav-links{margin-left:auto;display:flex;gap:14px}
  .topnav-links a{font-size:13px;color:#a09888;text-decoration:none}
  .topnav-links a:hover{color:#C4613A}
  .wrap{max-width:720px;width:100%;background:#fff;border-radius:16px;padding:48px 40px;border:1px solid #e4dfd8}
  .cat{font-size:11px;color:#a09888;margin-bottom:8px}
  h1{font-size:30px;font-weight:900;color:#2d2a26;margin-bottom:12px}
  .lead{color:#5a5550;line-height:1.8;font-size:15px;margin-bottom:12px}
  .upd{border-top:1px solid #e4dfd8;padding-top:18px;margin-top:22px}
  .upd h2{font-size:16px;font-weight:700;color:#2d2a26;margin-bottom:8px}
  .upd p{font-size:14px;line-height:1.9;color:#5a5550;margin-bottom:6px}
  .upd b{color:#2d2a26;margin-right:6px}
  .upd a{color:#C4613A;text-decoration:none}
  .upd a:hover{text-decoration:underline}
  .site-footer{max-width:720px;width:100%;margin-top:28px;text-align:center;font-size:13px;color:#a09888;line-height:1.9}
  .site-footer a{color:#a09888;text-decoration:none}
  .site-footer a:hover{color:#C4613A}
  .site-footer .copy{margin-top:6px;font-size:11px;color:#b8b0a4}
  @media(max-width:768px){.wrap{padding:32px 20px}}
</style>
</head>
<body>
<header class="topnav">
  <a class="topnav-logo" href="${BASE}/">AI Wiki</a>
  <nav class="topnav-links">
    <a href="${BASE}/">홈</a>
    <a href="${BASE}/about.html">소개</a>
  </nav>
</header>
<div class="wrap">
  <div class="cat">AI Wiki</div>
  <h1>업데이트 기록</h1>
  <p class="lead">문서가 새로 추가되거나 내용이 보강된 날짜별 기록입니다. 기술 변화가 큰 항목은 공식 문서와 원 자료를 다시 확인해 수시로 고쳐 씁니다.</p>
${updatesBody}
</div>
<footer class="site-footer">
  <a href="${BASE}/">홈</a> · <a href="${BASE}/about.html">소개</a> · <a href="${BASE}/privacy.html">개인정보처리방침</a> · <a href="${BASE}/contact.html">문의</a> · <a href="${BASE}/updates.html">업데이트 기록</a>
  <div class="copy">© 2026 AI Wiki · aiwiki.work</div>
</footer>
</body>
</html>`;
fs.writeFileSync(path.join(__dirname, 'updates.html'), updatesHtml);
console.log(`✓ updates.html 생성 (최근 ${UPDATE_DATES.length}개 날짜)`);

// sitemap.xml 갱신
const today = new Date().toISOString().slice(0,10);
const urls = [
  `  <url>\n    <loc>${BASE}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`
];
urls.push(`  <url>\n    <loc>${BASE}/updates.html</loc>\n    <lastmod>${UPDATE_DATES[0] || today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.5</priority>\n  </url>`);
for (const p of ['about.html', 'privacy.html', 'contact.html']) {
  urls.push(`  <url>\n    <loc>${BASE}/${p}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.3</priority>\n  </url>`);
}
for (const cat of hubBuilt) {
  urls.push(`  <url>\n    <loc>${BASE}/c/${cat}.html</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`);
}
let thinCount = 0;
for (const e of D) {
  if (!indexableIds.has(e.id)) { thinCount++; continue; } // 얇은 페이지는 sitemap 제외
  urls.push(`  <url>\n    <loc>${BASE}/k/${e.id}.html</loc>\n    <lastmod>${modifiedDate(e) || today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>`);
}
console.log(`✓ 공개 대상 ${indexableIds.size}개 / 비공개(본문 ${THIN_THRESHOLD}자 미만) ${thinCount}개`);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), sitemap);

// index.html에 noscript 정적 링크 삽입 (구글봇 크롤링용)
const indexHtmlPath = path.join(__dirname, 'index.html');
let indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');
const noscriptLinks = D.filter(e => indexableIds.has(e.id)).map(e =>`<a href="/k/${e.id}.html">${escHtml(e.t)}</a>`).join(' ');
const noscriptBlock = `<noscript><nav aria-label="키워드 목록">${noscriptLinks}</nav></noscript>`;
// 기존 noscript 블록 교체 또는 </body> 앞에 삽입
if (indexHtml.includes('<noscript><nav aria-label="키워드 목록">')) {
  indexHtml = indexHtml.replace(/<noscript><nav aria-label="키워드 목록">.*?<\/nav><\/noscript>/, noscriptBlock);
} else {
  indexHtml = indexHtml.replace('</body>', noscriptBlock + '\n</body>');
}

// 홈 첫 페이지 카드 사전 렌더링 — JS(data.js) 로드 전에도 카드가 보이고 크롤러도 읽는다.
// index.html render()와 같은 정렬·마크업이며, 로드 후 render()가 그대로 덮어쓴다.
const HOME_PAGE_SIZE = 20;
const m3 = new Date(); m3.setMonth(m3.getMonth() - 3, 1);
const newCutoff = m3.toISOString().slice(0, 7);
const hotSet = new Set(typeof HOT_IDS !== 'undefined' ? HOT_IDS : []);
const homeCards = D.filter(e => indexableIds.has(e.id))
  .sort((a, b) => (b.born || '').localeCompare(a.born || ''))
  .slice(0, HOME_PAGE_SIZE)
  .map(e => `<div class="card" onclick="open_m('${e.id}')"><div class="card-cat">${escHtml(CATS[e.c] || e.c)}</div>${hotSet.has(e.id) ? '<div class="card-hot">▲</div>' : ''}${e.born && e.born >= newCutoff ? '<div class="card-new">NEW</div>' : ''}<div class="card-keyword">${escHtml(e.t)}</div>${e.en ? `<div class="card-sub">${escHtml(e.en)}</div>` : ''}</div>`)
  .join('');
const gridBlock = `<div class="grid" id="grid"><!--prerender-->${homeCards}<!--/prerender--></div>`;
if (indexHtml.includes('<!--prerender-->')) {
  indexHtml = indexHtml.replace(/<div class="grid" id="grid"><!--prerender-->[\s\S]*?<!--\/prerender--><\/div>/, gridBlock);
} else {
  indexHtml = indexHtml.replace('<div class="grid" id="grid"></div>', gridBlock);
}

// 홈 DefinedTermSet 구조화 데이터에 노출 용어 목록 채우기 (한 줄 JSON — 재빌드 시 정규식으로 교체)
const definedTerms = D.filter(e => indexableIds.has(e.id))
  .map(e => ({ '@type': 'DefinedTerm', name: e.t, ...(e.en && e.en !== e.t ? { alternateName: e.en } : {}), url: `${BASE}/k/${e.id}.html` }));
indexHtml = indexHtml.replace(/"hasDefinedTerm": \[.*\]/, `"hasDefinedTerm": ${JSON.stringify(definedTerms)}`);
fs.writeFileSync(indexHtmlPath, indexHtml);

// keywords-index.txt 생성 (스케줄러용 경량 인덱스)
const indexLines = D.map(e => `${e.id}\t${e.t}\t${e.en}\t${e.c}`);
fs.writeFileSync(path.join(__dirname, 'keywords-index.txt'), indexLines.join('\n') + '\n');

console.log(`✓ ${indexableIds.size}개 키워드 페이지 생성 → /k/ (얇은 페이지 ${D.length - indexableIds.size}개는 미생성${removedThin ? `, 기존 파일 ${removedThin}개 삭제` : ''})`);
console.log(`✓ sitemap.xml 갱신 (${urls.length} URLs)`);
console.log(`✓ keywords-index.txt 갱신 (${indexLines.length} entries)`);
