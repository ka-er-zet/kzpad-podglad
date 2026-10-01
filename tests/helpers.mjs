// Wspólne pomocniki testów: serwer statyczny, wypełnianie arkusza, zapis JSON.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

export function startServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const rel = decodeURIComponent(req.url.split('?')[0]);
            const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
            if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                res.writeHead(404); res.end('not found'); return;
            }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
            fs.createReadStream(file).pipe(res);
        }).listen(0, '127.0.0.1', () => resolve(server));
    });
}

export const baseUrl = (server) => `http://127.0.0.1:${server.address().port}/index.html`;

/** Usuwa pola zależne od czasu, żeby porównać resztę. */
export function stripTimes(node) {
    if (Array.isArray(node)) return node.map(stripTimes);
    if (node && typeof node === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(node)) {
            if (k === 'dct:date') continue;
            out[k] = stripTimes(v);
        }
        return out;
    }
    return node;
}

export async function saveJson(page) {
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.click('#btn-save-wizard'),
    ]);
    return JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
}

/** Nowa ocena: wybór profilu, dane kreatora i wygenerowanie arkusza. */
export async function generateSheet(page, { name = 'Terminal testowy ąęść', desc = 'Opis / wersja 1.0', auditor = 'Anna Tester' } = {}) {
    await page.waitForSelector('#hero-new-audit');
    await page.click('#hero-new-audit');
    await page.waitForSelector('input[name="product_choice"]', { state: 'attached' });
    await page.locator('input[name="product_choice"]').nth(1).check({ force: true });
    await page.fill('#wizard-product-name', name);
    await page.fill('#wizard-product-desc', desc);
    await page.fill('#wizard-auditor-name', auditor);
    await page.click('#generateBtn');
    await page.waitForSelector('.requirement-row', { state: 'attached' });
}

/** Ustawia statusy i komentarze pierwszych `n` wymagań i testów (jak użytkownik: przez click i zdarzenia). */
export async function fillAssessments(page, n = 9) {
    return page.evaluate((n) => {
        const statusVals = ['compliant', 'non-compliant', 'not-applicable'];
        const testVals = ['pass', 'fail', 'na'];
        let rowsSet = 0, testsSet = 0;
        [...document.querySelectorAll('.requirement-row')].slice(0, n).forEach((row, i) => {
            const r = [...row.querySelectorAll('input[type="radio"][name^="status-"]')].find((x) => x.value === statusVals[i % 3]);
            if (r) { r.click(); rowsSet++; }
            const ta = row.querySelector('textarea[name^="comment-"]');
            if (ta) { ta.value = `Komentarz wymagania ${i} „cytat” & <b>`; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        [...document.querySelectorAll('.checklist-test-item[data-test-id]')].slice(0, n).forEach((card, i) => {
            const r = [...card.querySelectorAll('input[type="radio"][name^="test-status-"]')].find((x) => x.value === testVals[i % 3]);
            if (r) { r.click(); testsSet++; }
            const ta = card.querySelector('textarea[name^="test-comment-"]');
            if (ta) { ta.value = `Komentarz testu ${i}\nlinia 2`; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        return { rowsSet, testsSet };
    }, n);
}

export const AUTOSAVE_KEY = 'oz-pad:autosave:v1';
export const readSlot = (page) => page.evaluate((k) => localStorage.getItem(k), AUTOSAVE_KEY);
