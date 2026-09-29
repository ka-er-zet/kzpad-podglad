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
    './js/lucide.min.js',
    './js/exceljs.min.js',
    './js/jszip.min.js',
    './js/version.js',
    './js/utils.js',
    './js/exporter.js',
    './js/wizard.js',
    './clauses_json/clauses.json',
    './clauses_json/mapping.json',
    './clauses_json/summaries.json',
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

    // Pliki JSON (clauses, mapping, summaries) — Network First, zawsze świeża wersja
    if (event.request.url.includes('.json')) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // Zaktualizuj cache świeżą odpowiedzią
                    if (response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Brak sieci — serwuj z cache
                    return caches.match(event.request);
                })
        );
        return;
    }

    // Pliki CSS i JS — Network First
    if (event.request.url.includes('.css') || event.request.url.includes('.js')) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    return caches.match(event.request);
                })
        );
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
