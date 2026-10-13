/* TubeFox - minimal YouTube client for Firefox OS (ES5 for old Gecko) */
(function () {
  'use strict';

  var API = 'https://www.googleapis.com/youtube/v3/';
  var $ = function (id) { return document.getElementById(id); };

  var state = { mode: 'trending', query: '', nextToken: null, loading: false };

  /* ---------- storage ---------- */
  function get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- helpers ---------- */
  function setStatus(msg) { $('status').textContent = msg || ''; }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    return d.innerHTML;
  }

  function parseDuration(iso) {
    var m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
    if (!m) { return ''; }
    var h = +m[1] || 0, mi = +m[2] || 0, s = +m[3] || 0;
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return h ? h + ':' + pad(mi) + ':' + pad(s) : mi + ':' + pad(s);
  }

  function shortCount(n) {
    n = +n || 0;
    if (n >= 1e9) { return (n / 1e9).toFixed(1) + 'B'; }
    if (n >= 1e6) { return (n / 1e6).toFixed(1) + 'M'; }
    if (n >= 1e3) { return (n / 1e3).toFixed(1) + 'K'; }
    return '' + n;
  }

  function ago(iso) {
    var secs = (Date.now() - new Date(iso).getTime()) / 1000;
    var units = [['year', 31536000], ['month', 2592000], ['day', 86400],
                 ['hour', 3600], ['minute', 60]];
    for (var i = 0; i < units.length; i++) {
      var v = Math.floor(secs / units[i][1]);
      if (v >= 1) { return v + ' ' + units[i][0] + (v > 1 ? 's' : '') + ' ago'; }
    }
    return 'just now';
  }

  function request(endpoint, params, cb) {
    var key = get('apiKey', '');
    if (!key) { cb(new Error('Add your API key in Settings (gear icon).')); return; }
    params.key = key;
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');

    var xhr = new XMLHttpRequest({ mozSystem: true });
    xhr.open('GET', API + endpoint + '?' + qs, true);
    xhr.onload = function () {
      var data;
      try { data = JSON.parse(xhr.responseText); } catch (e) { return cb(new Error('Bad response')); }
      if (xhr.status !== 200) {
        return cb(new Error((data.error && data.error.message) || ('HTTP ' + xhr.status)));
      }
      cb(null, data);
    };
    xhr.onerror = function () { cb(new Error('Network error')); };
    xhr.timeout = 15000;
    xhr.ontimeout = function () { cb(new Error('Request timed out')); };
    xhr.send();
  }

  /* ---------- listing ---------- */
  function renderVideos(items) {
    var ul = $('results');
    items.forEach(function (v) {
      var li = document.createElement('li');
      var thumbs = v.snippet.thumbnails || {};
      var t = (thumbs.medium || thumbs.high || thumbs['default'] || {}).url || '';
      var stats = v.statistics ? shortCount(v.statistics.viewCount) + ' views \u00b7 ' : '';
      li.innerHTML =
        '<div class="thumb" style="background-image:url(' + esc(t) + ')">' +
          '<span class="dur">' + esc(parseDuration(v.contentDetails && v.contentDetails.duration)) + '</span>' +
        '</div>' +
        '<h3 class="title">' + esc(v.snippet.title) + '</h3>' +
        '<div class="meta">' + esc(v.snippet.channelTitle) + ' \u00b7 ' + stats + esc(ago(v.snippet.publishedAt)) + '</div>';
      li.addEventListener('click', function () { openPlayer(v); });
      ul.appendChild(li);
    });
  }

  function fetchDetails(ids, cb) {
    request('videos', { part: 'snippet,contentDetails,statistics', id: ids.join(',') }, cb);
  }

  function load(reset) {
    if (state.loading) { return; }
    state.loading = true;
    if (reset) {
      $('results').innerHTML = '';
      state.nextToken = null;
      $('more').classList.add('hidden');
    }
    setStatus('Loading\u2026');

    var done = function (err, data) {
      state.loading = false;
      if (err) { return setStatus(err.message); }
      setStatus(data.items.length ? '' : 'No results.');
      renderVideos(data.items);
      state.nextToken = data.nextPageToken || null;
      $('more').classList.toggle('hidden', !state.nextToken);
    };

    if (state.mode === 'trending') {
      var p = { part: 'snippet,contentDetails,statistics', chart: 'mostPopular',
                maxResults: 15, regionCode: (get('region', 'US') || 'US').toUpperCase() };
      if (state.nextToken) { p.pageToken = state.nextToken; }
      request('videos', p, done);
    } else {
      var sp = { part: 'snippet', type: 'video', maxResults: 15, q: state.query };
      if (state.nextToken) { sp.pageToken = state.nextToken; }
      request('search', sp, function (err, data) {
        if (err) { return done(err); }
        var ids = data.items.map(function (i) { return i.id.videoId; });
        if (!ids.length) { return done(null, { items: [] }); }
        fetchDetails(ids, function (err2, det) {
          if (err2) { return done(err2); }
          det.nextPageToken = data.nextPageToken;
          done(null, det);
        });
      });
    }
  }

  /* ---------- player ---------- */
  function openPlayer(v) {
    var id = v.id.videoId || v.id;
    $('player').src = 'https://www.youtube.com/embed/' + encodeURIComponent(id) +
      '?autoplay=1&rel=0&playsinline=1';
    $('player-title').textContent = v.snippet.title;
    $('player-channel').textContent = v.snippet.channelTitle;
    $('player-open').href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(id);
    $('player-view').classList.remove('hidden');
  }

  function closePlayer() {
    $('player').src = 'about:blank';
    $('player-view').classList.add('hidden');
  }

  /* ---------- settings ---------- */
  function openSettings() {
    $('api-key').value = get('apiKey', '');
    $('region').value = get('region', 'US');
    $('settings-view').classList.remove('hidden');
  }

  function closeSettings() { $('settings-view').classList.add('hidden'); }

  /* ---------- wiring ---------- */
  $('search-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('q').value.trim();
    $('q').blur();
    if (!q) { state.mode = 'trending'; } else { state.mode = 'search'; state.query = q; }
    load(true);
  });
  $('more').addEventListener('click', function () { load(false); });
  $('close-player').addEventListener('click', closePlayer);
  $('settings-btn').addEventListener('click', openSettings);
  $('close-settings').addEventListener('click', closeSettings);
  $('save-settings').addEventListener('click', function () {
    set('apiKey', $('api-key').value.trim());
    set('region', $('region').value.trim().toUpperCase() || 'US');
    closeSettings();
    load(true);
  });

  // Hardware back key / Escape closes overlays
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Backspace' || e.key === 'Escape') {
      if (!$('player-view').classList.contains('hidden')) { closePlayer(); e.preventDefault(); }
      else if (!$('settings-view').classList.contains('hidden')) { closeSettings(); e.preventDefault(); }
    }
  });

  if (!get('apiKey', '')) {
    setStatus('Welcome! Open Settings (gear icon) and add a YouTube Data API key to start.');
  } else {
    load(true);
  }
})();
