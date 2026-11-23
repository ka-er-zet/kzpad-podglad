importScripts('./js/version.js'); // definiuje self.APP_VERSION
const CACHE_NAME = `OZ-PAD-v${self.APP_VERSION}`;
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './favicon.ico',
    './favicon.svg',
    './icon-180.png',
    './icon-192.png',
    './icon-256.png',
    './icon-512.png',
    './css/pico.min.css',
    './css/wizard.css',
    './css/nav-panel.css',
    './js/lucide.min.js',
    './js/exceljs.min.js',
    './js/jszip.min.js',
    './js/version.js',
    './js/utils.js',
    './js/session.js',
    './js/minisearch.js',
    './js/search.js',
    './js/exporter.js',
    './js/wizard.js',
    './js/nav-panel.js',
    './clauses_json/clauses.json',
    './clauses_json/mapping.json',
    './clauses_json/summaries.json',
    './clauses_json/glossary.json',
    './img/eaa.svg',
    './img/EU1.svg',
    './img/EU2.svg',
    './img/EU3.svg',
    './img/pfron.svg',
    './img/uke.svg',
    './img/5_1_4.png',
    './img/8_3_2_2.png',
    './img/8_3_2_3_3.png',
    './img/8_3_2_5.png',
    './img/8_3_2_6.png',
    './img/8_3_3_2.png',
    './img/8_3_3_3_2.png',
    './img/8_3_4_1a.png',
    './img/8_3_4_1b.png',
    './img/8_3_4_2.png',
    './img/8_3_4_3_2.png',
    './img/8_3_4_3_3.png'
];

// Klucz w pamięci podręcznej bez parametrów zapytania (?…), żeby jeden plik miał jedną kopię
// i żeby kopia offline pasowała niezależnie od dopisków w adresie.
function cacheKey(request) {
    const url = new URL(request.url);
    url.search = '';
    return url.href;
}

// Network First: świeża wersja z sieci (i aktualizacja kopii), a bez sieci — kopia z pamięci podręcznej
function networkFirst(event) {
    const key = cacheKey(event.request);
    return fetch(event.request)
        .then((response) => {
            if (response.ok) {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(key, responseClone));
            }
            return response;
        })
        .catch(() => caches.match(key, { ignoreSearch: true }));
}

// Zdarzenie instalacji — wstępne cachowanie zasobów
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching all: app shell and content');
                return cache.addAll(ASSETS_TO_CACHE); // cachuj wszystkie zasoby
            })
            .then(() => self.skipWaiting())
    );
});

// Zdarzenie aktywacji — usuwanie starych cache'ów
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    console.log('[Service Worker] Removing old cache', key);
                    return caches.delete(key);
                }
                // Sprzątanie bieżącej pamięci: kopie zapisane pod adresami z parametrami (?t=… z wcześniejszych
                // wersji aplikacji) — każdy start dokładał nową kopię plików danych.
                return caches.open(key).then((cache) => cache.keys().then((requests) =>
                    Promise.all(requests.filter((r) => new URL(r.url).search).map((r) => cache.delete(r)))));
            }));
        })
    );
    // Natychmiast przejmij kontrolę nad wszystkimi klientami
    self.clients.claim();
});

// Nasłuchiwanie komunikatów ze strony (np. SKIP_WAITING — natychmiastowa aktywacja)
self.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Zdarzenie fetch — strategia Network First z fallbackiem na cache dla JSON, Cache First dla pozostałych zasobów
self.addEventListener('fetch', (event) => {
    // Edytor jest wyłączony z Service Workera — nie jest częścią PWA
    if (event.request.url.includes('editor.html') || event.request.url.includes('js/editor.js')) {
        return;
    }

    // Żądania nawigacji (index.html) — Network First, zawsze próba pobrania najnowszej wersji
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .catch(() => {
                    return caches.match('./index.html');
                })
        );
        return;
    }

    // Pliki JSON (clauses, mapping, summaries, glossary), CSS i JS — Network First
    const url = event.request.url;
    if (url.includes('.json') || url.includes('.css') || url.includes('.js')) {
        event.respondWith(networkFirst(event));
        return;
    }

    // Obrazy i pozostałe zasoby — Cache First (rzadko się zmieniają)
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                return response || fetch(event.request);
            })
    );
});
