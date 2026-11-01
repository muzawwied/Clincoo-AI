/* Clincoo AI — [Realtime] semua halaman & perangkat tersambung ke satu sumber data.
   Cara pakai: cukup sertakan <script src="/assets/realtime.js" defer></script>.
   - Memantau /api/sync?since=<rev> tiap 5 detik (ringan, 1 baris jawaban bila tak berubah)
   - Saat berubah: sebar event 'clincoo:sync' + perbarui elemen bertanda data-sync-*
   - Antar-tab di perangkat sama: BroadcastChannel -> instan
   - API: window.clincooSync { rev, data, refresh(), onChange(fn) }
*/
(function () {
  'use strict';
  if (window.clincooSync && window.clincooSync.__on) return;

  var POLL_MS = 5000;
  var state = { rev: '', data: null, timer: null, subs: [], busy: false };
  var bc = null;
  try { bc = ('BroadcastChannel' in window) ? new BroadcastChannel('clincoo-sync') : null; } catch (e) { bc = null; }

  function paint() {
    var d = state.data || {};
    document.querySelectorAll('[data-sync-rev]').forEach(function (el) { el.textContent = state.rev || '-'; });
    document.querySelectorAll('[data-sync-examples]').forEach(function (el) { el.textContent = (d.examples != null ? d.examples : '-'); });
    document.querySelectorAll('[data-sync-approved]').forEach(function (el) { el.textContent = (d.approved != null ? d.approved : '-'); });
    document.querySelectorAll('[data-sync-chats]').forEach(function (el) { el.textContent = (d.chats != null ? d.chats : '-'); });
    document.querySelectorAll('[data-sync-updated]').forEach(function (el) { el.textContent = d.updated_at || '-'; });
  }

  function emit() {
    var ev;
    try { ev = new CustomEvent('clincoo:sync', { detail: { rev: state.rev, data: state.data } }); } catch (e) { ev = document.createEvent('Event'); ev.initEvent('clincoo:sync', true, true); ev.detail = { rev: state.rev, data: state.data }; }
    document.dispatchEvent(ev);
    state.subs.slice().forEach(function (fn) { try { fn(state.data, state.rev); } catch (e) {} });
    try { if (bc) bc.postMessage({ rev: state.rev }); } catch (e) {}
  }

  function fetchSync(force) {
    if (state.busy) return Promise.resolve();
    state.busy = true;
    var url = '/api/sync' + (!force && state.rev ? ('?since=' + encodeURIComponent(state.rev)) : '');
    return fetch(url, { cache: 'no-store', headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        if (d.changed === false) return;
        var isNew = String(d.rev) !== String(state.rev);
        state.rev = String(d.rev || '');
        state.data = d;
        paint();
        if (isNew || force) emit();
      })
      .catch(function () {})
      .then(function () { state.busy = false; });
  }

  function start() {
    stop();
    fetchSync(true);
    state.timer = setInterval(function () { if (!document.hidden) fetchSync(false); }, POLL_MS);
  }
  function stop() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) fetchSync(false);
  });
  if (bc) bc.onmessage = function (ev) { fetchSync(false); };

  window.clincooSync = {
    __on: true,
    get rev() { return state.rev; },
    get data() { return state.data; },
    refresh: function () { return fetchSync(true); },
    onChange: function (fn) { if (typeof fn === 'function') { state.subs.push(fn); if (state.data) { try { fn(state.data, state.rev); } catch (e) {} } } return function () { state.subs = state.subs.filter(function (f) { return f !== fn; }); }; },
    start: start,
    stop: stop
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
