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

test('lista zagnieżdżona jest wewnątrz <li> poprzedniego elementu (ul > li > ul), nie obok niego — WCAG 1.3.1', () => {
    assert.equal(parse('- a\n  - b\n- c'), '<ul class="markdown-list"><li>a<ul class="markdown-list"><li>b</li></ul></li><li>c</li></ul>');
    assert.equal(parse('1. a\n   - x\n   - y\n2. b'), '<ol class="markdown-list"><li>a<ul class="markdown-list"><li>x</li><li>y</li></ul></li><li>b</li></ol>');
});

// Struktura list: każde dziecko <ul>/<ol> to <li> (sprawdzane na znacznikach, bez przeglądarki)
const listsValid = (h) => {
    const st = [];
    for (const m of h.matchAll(/<(\/?)(ul|ol|li)\b[^>]*>/g)) {
        const [, close, tag] = m;
        if (!close) { if (tag !== 'li' && st.length && st[st.length - 1] !== 'li') return false; if (tag === 'li' && st.length && st[st.length - 1] === 'li') return false; st.push(tag); }
        else st.pop();
    }
    return true;
};

test('wiele poziomów, zmiana typu listy i powrót wcięcia — zawsze poprawna struktura', () => {
    for (const t of ['1. a\n    - x\n        - z\n2. b\ntekst', '- a\n  1. x\n  - y\n- b', ' - (a)\n- (b)', '1. a\n   - x\n\n2. b']) {
        assert.equal(listsValid(parse(t)), true, t);
    }
});

test('w danych aplikacji żadna lista nie ma dzieci innych niż <li>', () => {
    const bad = [];
    const walk = (o, f) => { if (typeof o === 'string') { if (/\n\s*([-*]|\d+\.)\s/.test(o) && !listsValid(parse(o))) bad.push(f + ': ' + o.slice(0, 60)); } else if (o && typeof o === 'object') for (const k in o) walk(o[k], f); };
    const dir = path.join(ROOT, 'clauses_json');
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) walk(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), f);
    assert.deepEqual(bad, []);
});

test('żaden element <li> w danych nie ląduje poza listą', () => {
    const orphan = (h) => { const st = []; for (const m of h.matchAll(/<(\/?)(ul|ol|li)\b[^>]*>/g)) { if (m[2] === 'li') { if (!m[1] && !st.length) return true; } else if (m[1]) st.pop(); else st.push(1); } return false; };
    const bad = [];
    const walk = (o, f) => { if (typeof o === 'string') { if (o.includes('- ') && orphan(parse(o))) bad.push(f + ': ' + o.slice(0, 60)); } else if (o && typeof o === 'object') for (const k in o) walk(o[k], f); };
    const dir = path.join(ROOT, 'clauses_json');
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) walk(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), f);
    assert.deepEqual(bad, []);
});
