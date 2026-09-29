/**
 * Jedyne źródło prawdy o wersji aplikacji OZ-PAD.
 * Ładowany przez index.html (<script>) oraz service-worker.js (importScripts),
 * dlatego używa `self` (działa i w oknie, i w Service Workerze).
 *
 * Przy wydaniu zmieniamy WYŁĄCZNIE tę stałą (oraz datę w README.md).
 * Z niej wynikają: nazwa cache'u Service Workera, wykrywanie nowej wersji
 * po stronie przeglądarki i wymuszenie odświeżenia PWA.
 */
self.APP_VERSION = '1.4.2';
