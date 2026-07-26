// Service Worker بسيط جداً — غرضه الأساسي هو تفعيل شرط "قابل للتثبيت" في
// المتصفح (Install / تثبيت التطبيق). النسخة دي مبدئية بدون تخزين مؤقت حقيقي
// للعمل بدون إنترنت — ده بند Backlog لاحق (Offline caching).

const SW_VERSION = "bybus-sw-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // شبكة أولاً، ولو فشلت (مفيش نت) نجرب أي نسخة متخزنة سابقاً إن وجدت
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
