import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(import.meta.dirname, '..', 'src');
const LOCALES = join(SRC, 'i18n', 'locales');
const LOCALE_NAMES = ['th', 'en', 'cn', 'mm', 'jp'];

// ── 1. Collect all locale keys ──
function loadLocaleKeys(filePath) {
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  const keys = new Set();
  function walk(obj, prefix) {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string') keys.add(p);
      else walk(v, p);
    }
  }
  walk(raw, '');
  return keys;
}

const localeKeys = {};
for (const name of LOCALE_NAMES) {
  localeKeys[name] = loadLocaleKeys(join(LOCALES, `${name}.json`));
}

// All keys that exist in AT LEAST one locale
const allKeys = new Set();
for (const name of LOCALE_NAMES) {
  for (const k of localeKeys[name]) allKeys.add(k);
}

// ── 2. Collect all t('...') keys from source files ──
const usedKeys = new Set();
const tCalls = []; // { file, line, key, raw }

function walkDir(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      walkDir(full);
    } else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) {
      const content = readFileSync(full, 'utf-8');
      const lines = content.split('\n');
      // Match t('...') and t("...") calls
      const re = /[^a-zA-Z]t\(['"]([^'"]+)['"]\)/g;
      let m;
      while ((m = re.exec(content)) !== null) {
        const lineNum = content.slice(0, m.index).split('\n').length;
        usedKeys.add(m[1]);
        tCalls.push({ file: relative(SRC, full), line: lineNum, key: m[1], raw: m[0].trim() });
      }
    }
  }
}
walkDir(SRC);

// ── 3. Report ──
let exitCode = 0;

console.log('\n=== i18n Audit Report ===\n');

// 3a. Keys in code but missing from some locales
const missingFromLocale = [];
for (const key of usedKeys) {
  for (const name of LOCALE_NAMES) {
    if (!localeKeys[name].has(key)) {
      missingFromLocale.push({ key, locale: name });
    }
  }
}

if (missingFromLocale.length > 0) {
  console.log(`❌ Keys used in code but MISSING from locale files (${missingFromLocale.length}):\n`);
  for (const { key, locale } of missingFromLocale) {
    const usage = tCalls.filter(c => c.key === key);
    const loc = usage.map(u => `    ${u.file}:${u.line}`).join('\n');
    console.log(`  [${locale}] missing: "${key}"`);
    console.log(`    used at:\n${loc}\n`);
  }
  exitCode = 1;
} else {
  console.log('✅ All used translation keys exist in all 5 locales.\n');
}

// 3b. Unused keys in locale files
const unused = [];
for (const key of allKeys) {
  if (!usedKeys.has(key)) unused.push(key);
}
if (unused.length > 0) {
  console.log(`⚠️  Keys in locale files but NEVER used in code (${unused.length}):`);
  for (const key of unused) {
    // show which locales have it
    const presentIn = LOCALE_NAMES.filter(n => localeKeys[n].has(key));
    console.log(`  "${key}" — present in: ${presentIn.join(', ')}`);
  }
  console.log();
} else {
  console.log('✅ All locale keys are used in code.\n');
}

// 3c. Potential hardcoded text in JSX (simple heuristic)
console.log('--- Potential hardcoded text in JSX ---');
console.log('(text outside t() – heuristic, may include false positives)\n');

const skipWords = new Set([
  'id', 'ID', 'url', 'URL', 'api', 'API', 'smb', 'SMB', 'md5', 'sha256',
  'jpg', 'png', 'tiff', 'csv', 'json', 'http', 'https', 'localhost',
  'minio', 'redis', 'bull', 'kafka', 'jwt', 'rbac',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'true', 'false', 'null', 'undefined',
  'px', 'rem', 'em', 'ms', 's',
]);

// Scan files for JSX text nodes > 2 chars that look like English UI text
let hardcodedFound = 0;
walkDir(SRC); // re-scan, but we already have tCalls; let's scan differently

function scanHardcoded(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      scanHardcoded(full);
    } else if (entry.isFile() && /\.tsx$/.test(entry.name)) {
      const content = readFileSync(full, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip lines with t() calls, imports, comments, or object property values
        if (line.includes('t(') || line.includes('import ') || line.includes('//') || line.includes('* ')) continue;

        // Find text between JSX tags like: >Some Text<
        const jsxTextRe = />([A-Z][a-zA-Z\s]{2,30})</g;
        let m;
        while ((m = jsxTextRe.exec(line)) !== null) {
          const text = m[1].trim();
          if (text.length < 3) continue;
          if (skipWords.has(text) || skipWords.has(text.toLowerCase())) continue;
          // Skip if it looks like a CSS class or URL
          if (text.includes('-') && !text.includes(' ')) continue;
          // Skip numeric/technical
          if (/^[\d\s%./,]+$/.test(text)) continue;

          console.log(`  ${relative(SRC, full)}:${i + 1}  >${text}<`);
          hardcodedFound++;
        }

        // Also check template literals with hardcoded English words
        const engSuffixRe = /`\$\{[^}]+\}\s*(minutes?|seconds?|hours?|days?|files?|types?|items?|records?|pages?|jobs?|errors?|retries?)(["'` ,.]|$)/gi;
        while ((m = engSuffixRe.exec(line)) !== null) {
          console.log(`  ${relative(SRC, full)}:${i + 1}  possible unit: "${m[1]}" (use t())`);
          hardcodedFound++;
        }

        // Check for hardcoded "..." strings that look like UI labels
        const engStrRe = /['"]([A-Z][a-zA-Z\s]{3,40})['"]/g;
        while ((m = engStrRe.exec(line)) !== null) {
          const text = m[1];
          // Skip obvious non-UI strings
          if (skipWords.has(text) || skipWords.has(text.toLowerCase())) continue;
          if (/^\d/.test(text)) continue;
          if (text.includes('{') || text.includes('<')) continue;
          // Only report if it looks like a UI label (Title Case or "lowercase action")
          if (/^[A-Z][a-z]/.test(text) || /^[a-z]{3,10}$/.test(text)) {
            if (['disabled', 'active', 'pending', 'loading', 'deleted'].includes(text.toLowerCase())) continue;
            // Check if we're in a block that already has t() for this text
            console.log(`  ${relative(SRC, full)}:${i + 1}  possible label: "${text}"`);
            hardcodedFound++;
          }
        }
      }
    }
  }
}
scanHardcoded(SRC);

if (hardcodedFound === 0) {
  console.log('  (none detected — good job!)');
}
console.log(`\nTotal potential issues: ${hardcodedFound}`);

// ── Summary ──
console.log('\n=== Summary ===');
console.log(`  Translation keys used in code: ${usedKeys.size}`);
console.log(`  Translation keys in locale files: ${allKeys.size}`);
console.log(`  Keys missing from some locales: ${missingFromLocale.length}`);
console.log(`  Keys unused in code: ${unused.length}`);
console.log(`  Potential hardcoded text spots: ${hardcodedFound}`);
console.log();

process.exit(exitCode);
