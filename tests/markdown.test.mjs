// Testy parsera markdown z js/utils.js (listy z niespójnymi wcięciami w danych).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const src = fs.readFileSync(path.join(ROOT, 'js', 'utils.js'), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('function parseMarkdown');
const end = src.indexOf('/**\n * Usuwa numerację');
const parse = new Function(src.slice(start, end) + '; return parseMarkdown;')();

test('lista, w której pierwszy element ma większe wcięcie niż kolejne, to jedna lista', () => {
    const html = parse('Sprawdzenie:\n - (a) pierwszy oraz\n- (b) drugi.\n**Interpretacja:** x');
    assert.equal((html.match(/<ul/g) || []).length, 1);
    assert.match(html, /<ul class="markdown-list"><li>\(a\) pierwszy oraz<\/li><li>\(b\) drugi\.<\/li><\/ul>/);
});

test('zagnieżdżone listy nadal działają', () => {
    const html = parse('- a\n  - b\n- c');
    assert.equal(html, '<ul class="markdown-list"><li>a</li><ul class="markdown-list"><li>b</li></ul><li>c</li></ul>');
});

test('żaden element <li> w danych nie ląduje poza listą', () => {
    const orphan = (h) => { const st = []; for (const m of h.matchAll(/<(\/?)(ul|ol|li)\b[^>]*>/g)) { if (m[2] === 'li') { if (!m[1] && !st.length) return true; } else if (m[1]) st.pop(); else st.push(1); } return false; };
    const bad = [];
    const walk = (o, f) => { if (typeof o === 'string') { if (o.includes('- ') && orphan(parse(o))) bad.push(f + ': ' + o.slice(0, 60)); } else if (o && typeof o === 'object') for (const k in o) walk(o[k], f); };
    const dir = path.join(ROOT, 'clauses_json');
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) walk(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), f);
    assert.deepEqual(bad, []);
});
