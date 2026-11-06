// Offline support: cache the app shell, serve cache first, refresh in the background.
const VERSION = "b1print-v1";
const SHELL = ["./", "index.html", "app.js", "effects.js", "manifest.webmanifest",
  "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then((hit) => {
    const net = fetch(e.request).then((res) => {
      if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
