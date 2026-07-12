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
  prompting: 'AI에게 원하는 답을 얻으려면 "무엇을 묻느냐"만큼 "어떻게 묻느냐"가 중요합니다. 프롬프트 엔지니어링, 사고의 사슬(CoT), 시스템 프롬프트처럼 모델을 정확하게 다루기 위한 기법들을 모았습니다.',
  model: 'GPT·Claude·Gemini 같은 대규모 언어 모델은 AI의 "두뇌"에 해당합니다. 모델이 어떻게 학습되고 작동하는지, 파인튜닝·양자화·멀티모달처럼 모델 자체를 이해하는 데 필요한 개념들을 모았습니다.',
  tooling: 'AI를 실제 개발과 업무에 활용하게 해주는 도구와 표준입니다. MCP, Claude Code, LangChain, 스킬·훅처럼 모델과 외부 세계를 잇는 기술들을 모았습니다.',
  data: 'AI가 최신 정보나 내 문서를 근거로 답하려면 데이터를 잘 다뤄야 합니다. RAG, 임베딩, 벡터 DB, 청킹처럼 검색과 지식 연결에 관한 개념들을 모았습니다.',
  agent: '스스로 판단하고 도구를 써서 일을 끝까지 처리하는 것이 AI 에이전트입니다. 멀티에이전트, ReAct, 에이전트 프레임워크·메모리처럼 "알아서 일하는 AI"를 이해하는 키워드를 모았습니다.',
  infra: 'AI 시스템을 실제로 안정적으로 굴리려면 뒷단의 기반이 필요합니다. 컨텍스트 윈도우, API 게이트웨이, 평가(Eval)처럼 운영과 확장에 관한 개념들을 모았습니다.',
  safety: 'AI를 안전하고 믿을 수 있게 쓰기 위한 개념입니다. 환각, 가드레일, 프롬프트 인젝션처럼 위험을 이해하고 막는 기술들을 모았습니다.',
  application: 'AI가 실제 제품과 현장에서 어떻게 쓰이는지에 관한 개념입니다. AI 코딩, 챗봇, AI 검색, 워크플로우처럼 응용 분야의 키워드를 모았습니다.'
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

for (const e of D) {
  // 1. 검색 의도 반영 타이틀: "MCP란? (Model Context Protocol) — AI Wiki"
  const suffix = e.en && e.en !== e.t ? ` (${e.en})` : '';
  const ran = ranSuffix(e.t);
  const title = `${e.t}${ran}${suffix} — AI Wiki`;
  // 2. 검색 의도 반영 디스크립션: "MCP란 무엇인가? ..."
  const rawDesc = stripTags(e.sum);
  const desc = `${e.t}${ran} ${rawDesc}`.slice(0, 160);
  const url = `${BASE}/k/${e.id}.html`;
  const catName = CATS[e.c] || e.c;

  // 관련 키워드 내부 링크
  const relLinks = (e.rel || [])
    .filter(id => DMap[id])
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

  // 얇은 페이지 noindex: 본문이 매우 짧고 출처도 없는 경우만 (색인 품질 방어)
  const detLen = stripTags(e.det || '').length;
  const robotsMeta = (detLen < 400 && (!e.refs || !e.refs.length))
    ? '\n<meta name="robots" content="noindex,follow">' : '';

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
    "dateModified": e.updated || e.added || undefined,
    "author":{"@type":"Organization","name":"AI Wiki"},
    "publisher":{"@type":"Organization","name":"AI Wiki","url":BASE+"/"},
    "mainEntityOfPage":{"@type":"WebPage","@id":url}
  };

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">${robotsMeta}
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7817461938422229" crossorigin="anonymous"></script>
<meta name="google-adsense-account" content="ca-pub-7817461938422229">
<title>${escHtml(title)}</title>
<meta name="description" content="${escHtml(desc)}">
<meta name="keywords" content="${escHtml(e.tags.join(', '))}, AI, ${escHtml(e.t)}, ${escHtml(e.t)}란, ${escHtml(e.t)} 뜻, ${escHtml(e.t)} 의미, ${escHtml(e.t)} 개념, ${escHtml(e.t)} 설명, ${escHtml(e.t)} 정리, ${escHtml(e.t)}이란">
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
<meta property="article:modified_time" content="${e.updated || e.added || ''}">
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
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap');
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
  ${e.added ? `<div class="added-date">updated at ${e.updated||e.added}</div>` : ''}
</div>
<footer class="site-footer">
  <a href="${BASE}/">홈</a> · <a href="${BASE}/about.html">소개</a> · <a href="${BASE}/privacy.html">개인정보처리방침</a> · <a href="${BASE}/contact.html">문의</a>
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
  const items = D.filter(e => e.c === cat).sort((a, b) => a.t.localeCompare(b.t, 'ko'));
  if (!items.length) continue;
  const hubUrl = `${BASE}/c/${cat}.html`;
  const intro = CAT_INTRO[cat] || '';
  const listHtml = items.map(e => {
    const en = e.en && e.en !== e.t ? ` <span class="hub-en">${escHtml(e.en)}</span>` : '';
    return `<li><a class="hub-link" href="${BASE}/k/${e.id}.html"><span class="hub-t">${escHtml(e.t)}${en}</span><span class="hub-sum">${escHtml(stripTags(e.sum))}</span></a></li>`;
  }).join('');
  const otherCats = Object.keys(CATS).filter(c => c !== cat && D.some(e => e.c === c))
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
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap');
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
  <a href="${BASE}/">홈</a> · <a href="${BASE}/about.html">소개</a> · <a href="${BASE}/privacy.html">개인정보처리방침</a> · <a href="${BASE}/contact.html">문의</a>
  <div class="copy">© 2026 AI Wiki · aiwiki.work</div>
</footer>
</body>
</html>`;
  fs.writeFileSync(path.join(OUTC, `${cat}.html`), hubHtml);
  hubBuilt.push(cat);
}
console.log(`✓ ${hubBuilt.length}개 카테고리 허브 페이지 생성 → /c/`);

// sitemap.xml 갱신
const today = new Date().toISOString().slice(0,10);
const urls = [
  `  <url>\n    <loc>${BASE}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`
];
for (const p of ['about.html', 'privacy.html', 'contact.html']) {
  urls.push(`  <url>\n    <loc>${BASE}/${p}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.3</priority>\n  </url>`);
}
for (const cat of hubBuilt) {
  urls.push(`  <url>\n    <loc>${BASE}/c/${cat}.html</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`);
}
for (const e of D) {
  urls.push(`  <url>\n    <loc>${BASE}/k/${e.id}.html</loc>\n    <lastmod>${e.updated || today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>`);
}
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), sitemap);

// index.html에 noscript 정적 링크 삽입 (구글봇 크롤링용)
const indexHtmlPath = path.join(__dirname, 'index.html');
let indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');
const noscriptLinks = D.map(e => `<a href="/k/${e.id}.html">${escHtml(e.t)}</a>`).join(' ');
const noscriptBlock = `<noscript><nav aria-label="키워드 목록">${noscriptLinks}</nav></noscript>`;
// 기존 noscript 블록 교체 또는 </body> 앞에 삽입
if (indexHtml.includes('<noscript><nav aria-label="키워드 목록">')) {
  indexHtml = indexHtml.replace(/<noscript><nav aria-label="키워드 목록">.*?<\/nav><\/noscript>/, noscriptBlock);
} else {
  indexHtml = indexHtml.replace('</body>', noscriptBlock + '\n</body>');
}
fs.writeFileSync(indexHtmlPath, indexHtml);

// keywords-index.txt 생성 (스케줄러용 경량 인덱스)
const indexLines = D.map(e => `${e.id}\t${e.t}\t${e.en}\t${e.c}`);
fs.writeFileSync(path.join(__dirname, 'keywords-index.txt'), indexLines.join('\n') + '\n');

console.log(`✓ ${D.length}개 키워드 페이지 생성 → /k/`);
console.log(`✓ sitemap.xml 갱신 (${urls.length} URLs)`);
console.log(`✓ keywords-index.txt 갱신 (${indexLines.length} entries)`);
