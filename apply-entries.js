#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Escape backticks inside a template-literal string */
function escapeBacktick(str) {
  return (str || '').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/** Escape single-quotes inside a single-quoted string */
function escapeSingle(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function formatStringArray(arr) {
  if (!arr || arr.length === 0) return '[]';
  return '[' + arr.map(s => `'${escapeSingle(s)}'`).join(',') + ']';
}

function formatRefs(refs) {
  if (!refs || refs.length === 0) return '[]';
  const items = refs.map(r =>
    `{title:'${escapeSingle(r.title)}',url:'${escapeSingle(r.url)}',type:'${escapeSingle(r.type)}'}`
  );
  return '[' + items.join(',') + ']';
}

function formatVideos(videos) {
  if (!videos || videos.length === 0) return '[]';
  const items = videos.map(v =>
    `{title:'${escapeSingle(v.title)}',id:'${escapeSingle(v.id)}',lang:'${escapeSingle(v.lang)}'}`
  );
  return '[' + items.join(',') + ']';
}

/**
 * Render one D-array entry as the string to insert.
 * Matches the observed format in data.js.
 */
function formatEntry(entry, dateStr) {
  const born = entry.born ? `,born:'${escapeSingle(entry.born)}'` : '';
  return (
    `  {id:'${escapeSingle(entry.id)}',t:'${escapeSingle(entry.t)}',en:'${escapeSingle(entry.en)}',c:'${escapeSingle(entry.c)}',h:0${born},tags:${formatStringArray(entry.tags)},\n` +
    `   sum:'${escapeSingle(entry.sum)}',det:\`${escapeBacktick(entry.det)}\`,rel:${formatStringArray(entry.rel)},\n` +
    `   refs:${formatRefs(entry.refs)},\n` +
    `   videos:${formatVideos(entry.videos)},\n` +
    `   added:'${dateStr}',updated:'${dateStr}'},`
  );
}

/**
 * Render one I18N entry (for en/zh/ja) as the string to insert.
 */
function formatI18nEntry(id, translation) {
  if (!translation || (!translation.sum && !translation.det)) return null;
  return (
    `  '${escapeSingle(id)}':{\n` +
    `    sum: '${escapeSingle(translation.sum || '')}',\n` +
    `    det: \`${escapeBacktick(translation.det || '')}\`\n` +
    `  },`
  );
}

// ---------------------------------------------------------------------------
// Insertion helpers that work on the raw text of data.js
// ---------------------------------------------------------------------------

/**
 * Insert `text` just before the closing `];` of the `const D` array.
 * We find the `];` that follows `const D = [` (line 4 in the file).
 */
function insertIntoD(src, text) {
  const dStart = src.indexOf('\nconst D = [');
  if (dStart === -1) throw new Error('Could not find "const D = [" in data.js');

  // The D array is closed by the last "];" before the next top-level
  // declaration (const I18N_CONTENT) or EOF. Using lastIndexOf up to that
  // boundary is robust whether the "];" sits on its own line ("},\n];") or
  // is glued to the final entry ("},];").
  let boundary = src.indexOf('\nconst I18N_CONTENT', dStart);
  if (boundary === -1) boundary = src.length;
  const close = src.lastIndexOf('];', boundary);
  if (close === -1 || close < dStart) throw new Error('Could not find closing ]; for const D array');

  // Insert the new entry on its own line(s) and always keep "];" on its own
  // line afterwards, so subsequent inserts keep finding a clean close.
  let before = src.slice(0, close);
  if (!before.endsWith('\n')) before += '\n';
  return before + text + '\n' + src.slice(close);
}

/**
 * Insert `text` just before the closing `}` of a specific lang block inside I18N_CONTENT.
 * lang is 'en', 'zh', or 'ja'.
 */
function insertIntoI18n(src, lang, text) {
  // The block markers anchor on each language block's CLOSING brace as it
  // actually appears in data.js: "...},},zh:{", "...},},ja:{", "...},}};".
  // `pos` ends up at that closing "}", and we insert the new entry just before
  // it. New entries (formatI18nEntry) already end with "}," so the block stays
  // well-formed and the markers keep matching on the next run.
  let marker, pos;
  if (lang === 'en') {
    marker = '},zh:{';
    pos = src.indexOf(marker);
  } else if (lang === 'zh') {
    marker = '},ja:{';
    pos = src.indexOf(marker);
  } else if (lang === 'ja') {
    // I18N_CONTENT close is the LAST "}};" in the file (near EOF), so anchor
    // with lastIndexOf to avoid any "}};" that might appear inside a det string.
    marker = '}};';
    pos = src.lastIndexOf(marker);
  } else {
    throw new Error('Unknown lang: ' + lang);
  }

  if (pos === -1) throw new Error(`Could not find I18N_CONTENT.${lang} block close marker: "${marker}"`);

  // Ensure the preceding entry ends with a comma before we append.
  let before = src.slice(0, pos).replace(/\s+$/, '');
  if (before.endsWith('}') && !before.endsWith('},')) before += ',';

  return before + '\n' + text + '\n' + src.slice(pos);
}

/**
 * Update the HOT_IDS line with the given ids array.
 */
function updateHotIds(src, ids) {
  const line = `const HOT_IDS = [${ids.map(id => `'${escapeSingle(id)}'`).join(',')}];`;
  return src.replace(/^const HOT_IDS = \[.*?\];/m, line);
}

/**
 * Update LAST_UPDATED to current ISO timestamp.
 */
function updateLastUpdated(src) {
  return src.replace(
    /^const LAST_UPDATED = '.*?';/m,
    `const LAST_UPDATED = '${nowIso()}';`
  );
}

/**
 * Add new id to existing entry's rel array in D.
 * Finds the entry by id and patches its rel:[...] field.
 */
function addToExistingRel(src, existingId, newId) {
  // Find the entry block: id:'existingId'
  const idPattern = new RegExp(`(id:'${existingId.replace(/[-]/g, '\\-')}',)`, 'g');
  const match = idPattern.exec(src);
  if (!match) return src; // entry not found, skip silently

  // Find the rel:[...] for this entry — scan forward from match position
  const startPos = match.index;
  // Find the next occurrence of rel:[ after startPos
  const relIdx = src.indexOf('rel:[', startPos);
  if (relIdx === -1) return src;

  // Check that this rel:[ belongs to the same entry (not a different entry farther away)
  // A simple heuristic: there should be no other id:' between startPos and relIdx
  const between = src.slice(startPos + match[0].length, relIdx);
  if (/id:'/.test(between)) return src; // different entry's rel

  // Extract the existing rel array content
  const relOpen = relIdx + 4; // position of [
  const relClose = src.indexOf(']', relOpen);
  if (relClose === -1) return src;

  const relContent = src.slice(relOpen + 1, relClose).trim();

  // Check if newId already present
  if (relContent.includes(`'${newId}'`)) return src;

  // Build new rel content
  const newRelContent = relContent
    ? relContent + `,'${newId}'`
    : `'${newId}'`;

  return src.slice(0, relOpen + 1) + newRelContent + src.slice(relClose);
}

/**
 * Return array of existing IDs in D array.
 */
function extractExistingIds(src) {
  const re = /id:'([^']+)'/g;
  // Only scan the D array portion
  const dStart = src.indexOf('\nconst D = [');
  const dEnd = src.indexOf('\n];', dStart);
  const dSection = src.slice(dStart, dEnd);
  const ids = [];
  let m;
  while ((m = re.exec(dSection)) !== null) {
    ids.push(m[1]);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    process.stderr.write('Usage: node apply-entries.js <content.json>\n');
    process.exit(1);
  }

  const jsonPath = path.resolve(args[0]);
  if (!fs.existsSync(jsonPath)) {
    process.stderr.write(`Error: file not found: ${jsonPath}\n`);
    process.exit(1);
  }

  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    process.stderr.write(`Error: failed to parse JSON: ${e.message}\n`);
    process.exit(1);
  }

  if (!Array.isArray(entries)) {
    process.stderr.write('Error: JSON must be an array of entries\n');
    process.exit(1);
  }

  const dataPath = path.resolve(__dirname, 'data.js');
  if (!fs.existsSync(dataPath)) {
    process.stderr.write(`Error: data.js not found at ${dataPath}\n`);
    process.exit(1);
  }

  // Backup
  fs.copyFileSync(dataPath, dataPath + '.bak');

  let src = fs.readFileSync(dataPath, 'utf8');
  const dateStr = today();

  // Find existing IDs to detect duplicates
  const existingIds = extractExistingIds(src);
  const existingIdSet = new Set(existingIds);

  const hotIds = [];
  let addedCount = 0;
  const addedIds = [];

  for (const entry of entries) {
    if (!entry.id) {
      process.stderr.write(`Warning: entry missing id, skipping\n`);
      continue;
    }

    if (existingIdSet.has(entry.id)) {
      process.stderr.write(`Warning: duplicate id '${entry.id}', skipping\n`);
      continue;
    }

    // 1. Add to D array
    const entryStr = formatEntry(entry, dateStr);
    src = insertIntoD(src, entryStr);

    // 2. Add to I18N_CONTENT for en, zh, ja
    const langs = ['en', 'zh', 'ja'];
    for (const lang of langs) {
      const translation = entry.translations && entry.translations[lang];
      const i18nStr = formatI18nEntry(entry.id, translation);
      if (i18nStr) {
        src = insertIntoI18n(src, lang, i18nStr);
      }
    }

    // 3. Bidirectional rel linking
    if (Array.isArray(entry.rel)) {
      for (const relId of entry.rel) {
        if (existingIdSet.has(relId)) {
          src = addToExistingRel(src, relId, entry.id);
        }
      }
    }

    existingIdSet.add(entry.id);
    addedIds.push(entry.id);
    addedCount++;

    if (entry.hot) {
      hotIds.push(entry.id);
    }
  }

  // 4. Update HOT_IDS (only if any hot entries exist in this batch)
  if (hotIds.length > 0) {
    src = updateHotIds(src, hotIds);
  }

  // 5. Update LAST_UPDATED
  src = updateLastUpdated(src);

  // Write result
  fs.writeFileSync(dataPath, src, 'utf8');

  process.stdout.write(`Added ${addedCount} keyword(s): ${addedIds.join(', ')}\n`);
}

main();
