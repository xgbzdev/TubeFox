(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };

  // Public, key-free front-end APIs (Piped / Invidious). Tried in order, with automatic fallback.
  var PIPED = ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://api.piped.private.coffee'];
  var INV = ['https://inv.nadeko.net', 'https://yewtu.be', 'https://invidious.nerdvpn.de'];

  function get(k, d) { try { var v = localStorage.getItem('tf_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem('tf_' + k, JSON.stringify(v)); } catch (e) {} }
  var S = get('settings', { backend: 'piped', custom: '', region: 'US', quality: '360' });
  var subs = get('subs', []), saved = get('saved', []), hist = get('history', []);

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function enc(s) { return encodeURIComponent(s); }
  function dur(s) { s = Math.floor(+s) || 0; var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }
  function num(n) { n = +n; if (!n || n < 0) return ''; if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return '' + n; }
  function toast(t) { var e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { e.hidden = true; }, 2200); }

  // ---------- networking ----------
  function http(url, cb) {
    var x = new XMLHttpRequest({ mozSystem: true, mozAnon: true });
    x.open('GET', url, true); x.timeout = 12000; x.responseType = 'json';
    x.onload = function () { (x.status === 200 && x.response) ? cb(null, x.response) : cb(new Error('HTTP ' + x.status)); };
    x.onerror = x.ontimeout = function () { cb(new Error('Network error')); };
    x.send();
  }
  function vid(o) { return { id: o.id, title: o.title || '', channel: o.channel || '', channelId: o.channelId || '', duration: o.duration || 0, views: o.views || 0, date: o.date || '' }; }
  function fromPiped(x) {
    var m = /v=([\w-]{11})/.exec(x.url || ''); if (!m) return null;
    return vid({ id: m[1], title: x.title, channel: x.uploaderName, channelId: (x.uploaderUrl || '').replace('/channel/', ''), duration: x.duration, views: x.views, date: x.uploadedDate });
  }
  function fromInv(x) {
    if (!x.videoId) return null;
    return vid({ id: x.videoId, title: x.title, channel: x.author, channelId: x.authorId, duration: x.lengthSeconds, views: x.viewCount, date: x.publishedText });
  }
  function list(arr, f) { var o = []; (arr || []).forEach(function (x) { var v = f(x); if (v) o.push(v); }); return o; }

  var OPS = {
    trending: {
      piped: function () { return '/trending?region=' + S.region; },
      inv: function () { return '/api/v1/trending?region=' + S.region; },
      pp: function (d) { return { items: list(d, fromPiped) }; },
      ip: function (d) { return { items: list(d, fromInv) }; }
    },
    search: {
      piped: function (q) { return '/search?filter=videos&q=' + enc(q); },
      inv: function (q) { return '/api/v1/search?type=video&q=' + enc(q); },
      pp: function (d) { return { items: list(d.items, fromPiped) }; },
      ip: function (d) { return { items: list(d, fromInv) }; }
    },
    channel: {
      piped: function (id) { return '/channel/' + id; },
      inv: function (id) { return '/api/v1/channels/' + id + '/videos'; },
      pp: function (d) { return { name: d.name, items: list(d.relatedStreams, fromPiped) }; },
      ip: function (d) { var it = list(d.videos, fromInv); return { name: it[0] && it[0].channel, items: it }; }
    },
    video: {
      piped: function (id) { return '/streams/' + id; },
      inv: function (id) { return '/api/v1/videos/' + id; },
      pp: function (d) {
        var s = [];
        (d.videoStreams || []).forEach(function (v) { if (!v.videoOnly && /mp4/.test(v.mimeType || v.format || '')) s.push({ url: v.url, q: parseInt(v.quality, 10) || 0 }); });
        return { title: d.title, channel: d.uploader, channelId: (d.uploaderUrl || '').replace('/channel/', ''), views: d.views, desc: d.description || '', streams: s, hls: d.hls, related: list(d.relatedStreams, fromPiped) };
      },
      ip: function (d) {
        var s = [];
        (d.formatStreams || []).forEach(function (v) { if (/mp4/.test(v.type || '')) s.push({ url: v.url, q: parseInt(v.qualityLabel || v.quality, 10) || 0 }); });
        return { title: d.title, channel: d.author, channelId: d.authorId, views: d.viewCount, desc: d.description || '', streams: s, hls: d.hlsUrl, related: list(d.recommendedVideos, function (x) { return fromInv({ videoId: x.videoId, title: x.title, author: x.author, authorId: x.authorId, lengthSeconds: x.lengthSeconds, viewCount: x.viewCount }); }) };
      }
    }
  };

  function candidates() {
    var p = PIPED.map(function (u) { return { b: 'piped', u: u }; }), i = INV.map(function (u) { return { b: 'inv', u: u }; });
    if (S.custom) {
      var c = S.custom.replace(/\/+$/, '');
      return [{ b: S.backend, u: c }];
    }
    return S.backend === 'piped' ? p.concat(i) : i.concat(p);
  }
  function api(op, arg, cb) {
    var c = candidates(), n = 0, last;
    (function next() {
      if (n >= c.length) return cb(last || new Error('No instance reachable'));
      var e = c[n++], o = OPS[op];
      http(e.u + o[e.b](arg), function (err, d) {
        if (err) { last = err; return next(); }
        try { cb(null, o[e.b === 'piped' ? 'pp' : 'ip'](d)); } catch (x) { last = x; next(); }
      });
    })();
  }

  // ---------- views ----------
  var view = 'home', token = 0, L = $('#list');
  function setTitle(t) { $('#title').textContent = t; }
  function busy() { L.innerHTML = ''; L.appendChild(el('div', 'spin')); }
  function fail(err, retry) {
    L.innerHTML = '';
    L.appendChild(el('div', 'msg err', 'Could not load: ' + err.message + '. Check your connection or choose another server in Settings.'));
    var b = el('button', 'btn fox', 'Try again'); b.onclick = retry; var w = el('div', 'msg'); w.appendChild(b); L.appendChild(w);
  }
  function card(v) {
    var c = el('div', 'card'), th = el('div', 'th'), im = el('img'), tx = el('div', 'tx');
    im.src = 'https://i.ytimg.com/vi/' + v.id + '/mqdefault.jpg'; im.alt = '';
    th.appendChild(im); if (v.duration) th.appendChild(el('b', null, dur(v.duration)));
    tx.appendChild(el('h3', null, v.title));
    var ch = el('div', 'ch', v.channel); ch.onclick = function (e) { e.stopPropagation(); if (v.channelId) openChannel(v.channelId, v.channel); };
    tx.appendChild(ch);
    tx.appendChild(el('div', 'mt', [num(v.views) && num(v.views) + ' views', v.date].filter(Boolean).join(', ')));
    c.appendChild(th); c.appendChild(tx); c.onclick = function () { play(v); };
    return c;
  }
  function show(items, empty, parent) {
    parent = parent || L; parent.innerHTML = '';
    if (!items.length) parent.appendChild(el('div', 'empty', empty));
    items.forEach(function (v) { parent.appendChild(card(v)); });
  }
  function load(op, arg, title, empty) {
    var t = ++token; setTitle(title); busy();
    api(op, arg, function (err, d) {
      if (t !== token) return;
      if (err) return fail(err, function () { load(op, arg, title, empty); });
      show(d.items, empty);
    });
  }
  function openChannel(id, name) {
    var t = ++token; setTitle(name || 'Channel'); busy(); closePlayer();
    api('channel', id, function (err, d) {
      if (t !== token) return;
      if (err) return fail(err, function () { openChannel(id, name); });
      show(d.items, 'No videos found.');
      var b = el('button', 'btn' + (isSub(id) ? ' fox' : ''), isSub(id) ? 'Subscribed' : 'Subscribe');
      b.onclick = function () { toggleSub(id, d.name || name); b.textContent = isSub(id) ? 'Subscribed' : 'Subscribe'; b.className = 'btn' + (isSub(id) ? ' fox' : ''); };
      L.insertBefore(b, L.firstChild);
    });
  }
  function feed() {
    var t = ++token; setTitle('Feed'); busy();
    if (!subs.length) { L.innerHTML = ''; L.appendChild(el('div', 'empty', 'No subscriptions yet. Open a channel and tap Subscribe — it stays on this phone.')); return; }
    var all = [], left = subs.length;
    subs.forEach(function (s) {
      api('channel', s.id, function (err, d) {
        if (err) { all.push.apply(all, []); } else { all.push.apply(all, d.items.slice(0, 4)); }
        if (--left === 0 && t === token) show(all, 'Nothing new right now.');
      });
    });
  }
  function simple(arr, title, empty) { ++token; setTitle(title); show(arr, empty); }
  function settings() {
    ++token; setTitle('Settings'); L.innerHTML = '';
    var w = el('div', 'set');
    function field(label, node) { w.appendChild(el('label', null, label)); w.appendChild(node); }
    var be = el('select'); [['piped', 'Piped'], ['inv', 'Invidious']].forEach(function (o) { var p = el('option', null, o[1]); p.value = o[0]; if (S.backend === o[0]) p.selected = true; be.appendChild(p); });
    var cu = el('input'); cu.placeholder = 'https://... (optional, overrides built-in list)'; cu.value = S.custom;
    var rg = el('input'); rg.value = S.region; rg.maxLength = 2;
    var ql = el('select'); ['144', '240', '360', '480', '720'].forEach(function (q) { var p = el('option', null, q + 'p'); p.value = q; if (S.quality === q) p.selected = true; ql.appendChild(p); });
    field('Server type', be); field('Custom server address', cu); field('Trending region (2 letters)', rg); field('Preferred quality', ql);
    var sv = el('button', 'btn fox', 'Save settings'); sv.style.marginTop = '14px';
    sv.onclick = function () { S = { backend: be.value, custom: cu.value.trim(), region: (rg.value || 'US').toUpperCase(), quality: ql.value }; put('settings', S); toast('Settings saved'); };
    w.appendChild(sv);
    var cl = el('button', 'btn', 'Clear history'); cl.onclick = function () { hist = []; put('history', hist); toast('History cleared'); };
    w.appendChild(cl);
    w.appendChild(el('p', 'msg', 'TubeFox needs no API key. It reads public data through open servers, and keeps subscriptions, saves and history on this device only.'));
    L.appendChild(w);
  }
  function go(v) {
    view = v; $('#q').value = '';
    var bs = document.querySelectorAll('#tabs button'), i;
    for (i = 0; i < bs.length; i++) bs[i].className = bs[i].getAttribute('data-v') === v ? 'on' : '';
    if (v === 'home') load('trending', null, 'Trending', 'Nothing trending.');
    else if (v === 'subs') feed();
    else if (v === 'saved') simple(saved, 'Saved', 'Tap Save on any video to keep it here.');
    else if (v === 'history') simple(hist, 'History', 'Videos you watch appear here.');
    else settings();
    L.scrollTop = 0;
  }

  // ---------- local data ----------
  function isSub(id) { return subs.some(function (s) { return s.id === id; }); }
  function toggleSub(id, name) {
    if (isSub(id)) subs = subs.filter(function (s) { return s.id !== id; }); else subs.push({ id: id, name: name });
    put('subs', subs); toast(isSub(id) ? 'Subscribed to ' + name : 'Unsubscribed');
  }
  function isSaved(id) { return saved.some(function (v) { return v.id === id; }); }
  function toggleSaved(v) {
    if (isSaved(v.id)) saved = saved.filter(function (x) { return x.id !== v.id; }); else saved.unshift(v);
    put('saved', saved);
  }
  function addHist(v) { hist = [v].concat(hist.filter(function (x) { return x.id !== v.id; })).slice(0, 100); put('history', hist); }

  // ---------- player ----------
  var cur = null, streams = [], V = $('#video');
  function pickQuality(q) {
    var best = null; streams.forEach(function (s) { if (s.q <= q && (!best || s.q > best.q)) best = s; });
    return best || streams.sort(function (a, b) { return a.q - b.q; })[0];
  }
  function setSrc(url) { var t = V.currentTime || 0; V.src = url; if (t) V.addEventListener('loadedmetadata', function f() { V.removeEventListener('loadedmetadata', f); V.currentTime = t; }); V.play(); }
  function refreshButtons() {
    var s = $('#bSub'), f = $('#bFav');
    s.textContent = isSub(cur.channelId) ? 'Subscribed' : 'Subscribe'; s.className = isSub(cur.channelId) ? 'on' : ''; s.style.display = cur.channelId ? '' : 'none';
    f.textContent = isSaved(cur.id) ? 'Saved' : 'Save'; f.className = isSaved(cur.id) ? 'on' : '';
  }
  function play(v) {
    cur = v; addHist(v);
    $('#player').hidden = false; $('#ptitle').textContent = v.title; $('#pmeta').textContent = 'Loading...';
    $('#pdesc').textContent = ''; $('#related').innerHTML = ''; $('#qual').innerHTML = ''; V.removeAttribute('src'); V.poster = 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg';
    refreshButtons();
    var id = v.id;
    api('video', id, function (err, d) {
      if (!cur || cur.id !== id) return;
      if (err) { $('#pmeta').textContent = 'Could not load video: ' + err.message; return; }
      cur.channel = d.channel || cur.channel; cur.channelId = d.channelId || cur.channelId; refreshButtons();
      var m = $('#pmeta'); m.innerHTML = '';
      var a = el('a', null, d.channel); a.onclick = function () { openChannel(d.channelId, d.channel); }; m.appendChild(a);
      if (num(d.views)) m.appendChild(document.createTextNode(' - ' + num(d.views) + ' views'));
      $('#ptitle').textContent = d.title || v.title; $('#pdesc').textContent = d.desc.replace(/<[^>]+>/g, ' ');
      streams = d.streams; var q = $('#qual');
      streams.sort(function (a, b) { return a.q - b.q; }).forEach(function (s, i) { var o = el('option', null, s.q + 'p'); o.value = i; q.appendChild(o); });
      var pick = streams.length ? pickQuality(+S.quality) : null;
      if (pick) { q.value = streams.indexOf(pick); setSrc(pick.url); }
      else if (d.hls) { V.src = d.hls; V.play(); }
      else $('#pmeta').textContent = 'No playable stream found. Try another server in Settings.';
      show(d.related.slice(0, 12), '', $('#related'));
    });
  }
  function closePlayer() { V.pause(); V.removeAttribute('src'); V.load(); $('#player').hidden = true; cur = null; }
  $('#bClose').onclick = closePlayer;
  $('#bSub').onclick = function () { toggleSub(cur.channelId, cur.channel); refreshButtons(); };
  $('#bFav').onclick = function () { toggleSaved(cur); refreshButtons(); };
  $('#qual').onchange = function () { setSrc(streams[+this.value].url); };
  window.addEventListener('keydown', function (e) { if ((e.key === 'Backspace' || e.key === 'Escape') && !$('#player').hidden && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); closePlayer(); } });

  // ---------- wiring ----------
  $('#tabs').addEventListener('click', function (e) { var v = e.target.getAttribute && e.target.getAttribute('data-v'); if (v) go(v); });
  $('#q').addEventListener('keydown', function (e) { if (e.keyCode === 13 && this.value.trim()) { var q = this.value.trim(); this.blur(); load('search', q, q, 'No results.'); } });
  go('home');
})();
