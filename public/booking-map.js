/* SuperSealed Booking Map
 * Finds the best day/slot to offer a client based on where staff are already
 * booked in ServiceM8. Read-only: it never changes anything in ServiceM8.
 * Data comes from /api/schedule (server-side proxy, API key never in the browser).
 */
(function () {
  'use strict';

  // ---------- settings (edit here) ----------
  var CFG = {
    // First names (lower case) of staff who do inspections / quotes.
    inspectionStaff: ['christian', 'chris', 'tarso'],
    // First names (lower case) to never show (office/admin staff).
    hiddenStaff: ['ali', 'crisia', 'chrisia', 'dina', 'dinah', 'elie'],
    dayStart: 8 * 60,          // 8:00am
    dayEnd: 17 * 60,           // 5:00pm
    inspectionMinutes: 90,     // length of an inspection visit
    travelBufferMinutes: 30,   // gap kept after the previous job
    horizonDays: 92,           // ~3 months ahead
    office: { lat: -37.6545, lng: 145.0256, name: 'the office (Epping)' },
    melbBox: '144.5,-38.5,145.7,-37.3'
  };
  var COLORS = ['#0B6E6A', '#6B4FA0', '#1D5FD1', '#A16207', '#3F7F1F', '#475569', '#B4235A', '#0E7490', '#7C3AED', '#9A3412'];
  var REGION_STYLE = {
    'Inner': '#B9AEA4', 'North': '#8FADCF', 'East': '#8DBB91',
    'South East': '#D4B66D', 'West': '#AD9CCB', 'Peninsula': '#D69C80'
  };

  // ---------- state ----------
  var S = {
    mode: 'quote', query: '', client: null, ndays: 2, dayIdx: 0,
    hidden: {}, sel: 0, loaded: false, loading: false, error: null,
    staff: [], acts: [], jobs: {}, days: [], byStaffDay: {}, opts: [],
    map: null, layer: null, regions: null, suggestTimer: null, suggestions: []
  };

  // ---------- helpers ----------
  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function dShort(d) { return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; }
  function dLong(d) { return DOWL[d.getDay()] + ' ' + d.getDate() + ' ' + MONL[d.getMonth()]; }
  function hm(mins) { var h = Math.floor(mins / 60), m = mins % 60, ap = h >= 12 ? 'pm' : 'am'; var h12 = h % 12 || 12; return h12 + ':' + pad(m) + ap; }
  function parseSm8(s) { // "YYYY-MM-DD HH:MM:SS" local Melbourne time
    if (!s || s.indexOf('0000-00-00') === 0) return null;
    var p = s.split(/[- :]/).map(Number);
    return { date: s.slice(0, 10), mins: p[3] * 60 + p[4] };
  }
  function km(a, b) {
    var R = 6371, t = Math.PI / 180, dLa = (b.lat - a.lat) * t, dLo = (b.lng - a.lng) * t;
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function driveMins(d) { return Math.round(d * 1.6 + 5); } // rough Melbourne estimate
  function suburbOf(job) { return job.suburb || (job.address || '').split(',').slice(-2, -1)[0] || job.address || 'job'; }
  function staffName(s) { return s.first || s.name || 'Staff'; }
  function isInspector(s) { return CFG.inspectionStaff.indexOf((s.first || '').trim().toLowerCase()) >= 0; }

  function pointInRing(pt, ring) {
    var x = pt.lng, y = pt.lat, inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function regionOf(pt) {
    if (!S.regions || !pt) return null;
    for (var i = 0; i < S.regions.features.length; i++) {
      var f = S.regions.features[i], g = f.geometry;
      var polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      for (var k = 0; k < polys.length; k++) if (pointInRing(pt, polys[k][0])) return f.properties.region;
    }
    return null;
  }

  // ---------- styles + layout ----------
  function injectCss() {
    if (el('bm-style')) return;
    var css = '' +
      '#bm-root{display:flex;flex-direction:column;gap:16px;font-size:15px}' +
      '#bm-root .bm-card{background:#fff;border:1px solid #DDE3E8;border-radius:14px;padding:18px}' +
      '#bm-root .bm-modes{display:flex;flex-wrap:wrap;gap:12px}' +
      '#bm-root .bm-mode{flex:1 1 280px;min-height:78px;padding:12px 18px;border-radius:14px;border:2px solid #B9C6CF;background:#fff;color:#13212B;text-align:left;cursor:pointer}' +
      '#bm-root .bm-mode b{display:block;font-size:19px}#bm-root .bm-mode span{font-size:13px}' +
      '#bm-root .bm-mode.on{background:#0E2A3B;color:#fff;border-color:#0E2A3B}' +
      '#bm-root .bm-row{display:flex;flex-wrap:wrap;gap:18px 28px;align-items:flex-start}' +
      '#bm-root label.bm-h,#bm-root .bm-h{font-size:16px;font-weight:800;display:block;margin-bottom:8px}' +
      '#bm-root .bm-addr{position:relative;flex:1 1 420px;min-width:0}' +
      '#bm-root .bm-addr input{width:100%;box-sizing:border-box;height:54px;border:2px solid #B9C6CF;border-radius:12px;padding:0 16px;font-size:17px}' +
      '#bm-root .bm-sug{position:absolute;left:0;right:0;top:100%;z-index:1000;background:#fff;border:1px solid #DDE3E8;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.12);overflow:hidden}' +
      '#bm-root .bm-sug button{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #EEF1F3;background:#fff;padding:12px 14px;font-size:15px;cursor:pointer}' +
      '#bm-root .bm-sug button:hover{background:#F3F5F7}' +
      '#bm-root .bm-step{display:flex;align-items:center;gap:10px}' +
      '#bm-root .bm-step button{width:54px;height:54px;border-radius:12px;border:2px solid #B9C6CF;background:#fff;font-size:26px;font-weight:700;cursor:pointer}' +
      '#bm-root .bm-step div{min-width:100px;height:54px;border-radius:12px;background:#0E2A3B;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800}' +
      '#bm-root .bm-note{font-size:13px;color:#4A5B67;margin-top:6px}' +
      '#bm-root .bm-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px}' +
      '#bm-root .bm-opt{background:#fff;border:1px solid #DDE3E8;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:7px}' +
      '#bm-root .bm-opt.on{border:3px solid #1F8A57;box-shadow:0 4px 14px rgba(14,42,59,.12)}' +
      '#bm-root .bm-rank{font-size:12px;font-weight:800;letter-spacing:.08em;color:#4A5B67}' +
      '#bm-root .bm-when{font-size:21px;font-weight:800;line-height:1.2}' +
      '#bm-root .bm-who{font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px}' +
      '#bm-root .bm-dot{width:14px;height:14px;border-radius:50%;display:inline-block;flex:none}' +
      '#bm-root .bm-why{font-size:14px;color:#4A5B67}' +
      '#bm-root .bm-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}' +
      '#bm-root .bm-btn{flex:1 1 110px;min-height:46px;border-radius:10px;border:2px solid #B9C6CF;background:#fff;font-size:15px;font-weight:700;cursor:pointer}' +
      '#bm-root .bm-btn.dark{background:#0E2A3B;color:#fff;border-color:#0E2A3B}' +
      '#bm-root .bm-badge{font-size:12px;font-weight:800;padding:4px 10px;border-radius:10px}' +
      '#bm-root .bm-maphead{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:10px}' +
      '#bm-root .bm-maphead .bm-day{min-width:230px;text-align:center;font-size:18px;font-weight:800}' +
      '#bm-root .bm-arrow{width:46px;height:46px;border-radius:10px;border:1px solid #B9C6CF;background:#fff;font-size:20px;cursor:pointer}' +
      '#bm-root .bm-chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}' +
      '#bm-root .bm-chip{min-height:40px;padding:0 14px;border-radius:20px;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:7px}' +
      '#bm-root .bm-link{border:0;background:none;color:#0B6E6A;font-weight:700;text-decoration:underline;cursor:pointer;font-size:14px}' +
      '#bm-map{height:640px;border-radius:12px;border:1px solid #C9D3D9}' +
      '#bm-root .bm-run{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;margin-top:12px}' +
      '#bm-root .bm-runitem{display:flex;gap:10px;align-items:center;border:1px solid #DDE3E8;border-radius:10px;padding:9px 12px;font-size:13px}' +
      '#bm-root .bm-runitem.free{border:2px dashed #3CA571;background:#F2FBF6}' +
      '#bm-root .bm-num{width:28px;height:28px;flex:none;border-radius:50%;color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center}' +
      '#bm-root .bm-empty{border:2px dashed #B9C6CF;border-radius:14px;padding:24px;text-align:center;color:#4A5B67;background:#fff}' +
      '#bm-root .bm-err{background:#FDECEC;border:1px solid #F3B4B4;color:#8A1C1C;border-radius:10px;padding:12px 14px}' +
      '.bm-pin{display:flex;align-items:center;gap:5px;white-space:nowrap}' +
      '.bm-pin b{width:26px;height:26px;border-radius:50%;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)}' +
      '.bm-pin span{background:#fff;border-radius:6px;padding:3px 7px;font-size:12px;font-weight:700;color:#13212B;box-shadow:0 1px 4px rgba(0,0,0,.2)}' +
      '.bm-client b{background:#E11D48;width:22px;height:22px;box-shadow:0 0 0 7px rgba(225,29,72,.25),0 2px 6px rgba(0,0,0,.3)}' +
      '.bm-client span{background:#E11D48;color:#fff}' +
      '.bm-region{font:800 13px Arial,sans-serif;letter-spacing:.12em;color:rgba(14,42,59,.55);white-space:nowrap;text-shadow:0 0 3px #fff}' +
      '.bm-compass{background:#fff;border-radius:50%;width:58px;height:58px;box-shadow:0 1px 6px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center}';
    var s = document.createElement('style'); s.id = 'bm-style'; s.textContent = css; document.head.appendChild(s);
  }

  function loadLeaflet() {
    return new Promise(function (resolve, reject) {
      if (window.L) return resolve();
      var c = document.createElement('link'); c.rel = 'stylesheet'; c.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(c);
      var s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload = function () { resolve(); }; s.onerror = function () { reject(new Error('Could not load the map library')); };
      document.head.appendChild(s);
    });
  }

  function shell() {
    var root = el('booking-map-root');
    root.innerHTML = '<div id="bm-root">' +
      '<div class="bm-modes">' +
      '<button class="bm-mode" data-mode="quote"><b>Book an inspection</b><span>Nearby free slot for an inspector</span></button>' +
      '<button class="bm-mode" data-mode="job"><b>Schedule an approved job</b><span>First free days in a row for a technician</span></button>' +
      '</div>' +
      '<div class="bm-card bm-row">' +
      '<div class="bm-addr"><label class="bm-h" for="bm-q">Client address</label>' +
      '<input id="bm-q" autocomplete="off" placeholder="Start typing the street address…">' +
      '<div class="bm-sug" id="bm-sug" style="display:none"></div>' +
      '<div class="bm-note" id="bm-where"></div></div>' +
      '<div id="bm-daysbox" style="display:none"><span class="bm-h">How many days is the job?</span>' +
      '<div class="bm-step"><button id="bm-dn" aria-label="One day less">−</button><div id="bm-nd"></div><button id="bm-up" aria-label="One day more">+</button></div></div>' +
      '</div>' +
      '<div><div class="bm-h" style="font-size:19px" id="bm-title">Options</div><div id="bm-status"></div><div class="bm-cards" id="bm-cards"></div></div>' +
      '<div class="bm-card">' +
      '<div class="bm-maphead"><span class="bm-h" style="margin:0;font-size:19px">Map</span><span style="flex:1"></span>' +
      '<button class="bm-arrow" id="bm-prev" aria-label="Previous day">‹</button><span class="bm-day" id="bm-day"></span>' +
      '<button class="bm-arrow" id="bm-next" aria-label="Next day">›</button></div>' +
      '<div class="bm-chips" id="bm-chips"></div>' +
      '<div id="bm-map"></div>' +
      '<div class="bm-run" id="bm-run"></div>' +
      '<div class="bm-note">Read-only view of the ServiceM8 schedule. Once the client says yes, book it in ServiceM8 as normal. Drive times are estimates.</div>' +
      '</div></div>';

    root.querySelectorAll('.bm-mode').forEach(function (b) {
      b.onclick = function () { S.mode = b.getAttribute('data-mode'); S.sel = 0; compute(); render(); };
    });
    var q = el('bm-q');
    q.oninput = function () { S.query = q.value; S.client = null; clearTimeout(S.suggestTimer); S.suggestTimer = setTimeout(suggest, 350); render(); };
    q.onkeydown = function (e) { if (e.key === 'Enter' && S.suggestions[0]) { e.preventDefault(); pick(S.suggestions[0]); } };
    el('bm-dn').onclick = function () { S.ndays = Math.max(1, S.ndays - 1); S.sel = 0; compute(); render(); };
    el('bm-up').onclick = function () { S.ndays = Math.min(15, S.ndays + 1); S.sel = 0; compute(); render(); };
    el('bm-prev').onclick = function () { S.dayIdx = Math.max(0, S.dayIdx - 1); renderMap(); };
    el('bm-next').onclick = function () { S.dayIdx = Math.min(S.days.length - 1, S.dayIdx + 1); renderMap(); };
  }

  // ---------- address search (Photon / OpenStreetMap) ----------
  function suggest() {
    var q = S.query.trim();
    if (q.length < 3) { S.suggestions = []; renderSuggest(); return; }
    fetch('https://photon.komoot.io/api/?limit=6&lang=en&bbox=' + CFG.melbBox + '&q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        S.suggestions = (d.features || []).filter(function (f) { return (f.properties.state || '').indexOf('Victoria') >= 0; }).map(function (f) {
          var p = f.properties;
          var line = [p.housenumber ? p.housenumber + ' ' + (p.street || '') : (p.street || p.name || ''), p.city || p.district || p.locality || '', p.postcode || ''].filter(Boolean).join(', ');
          return { label: line, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], suburb: p.city || p.district || p.locality || p.name || '' };
        });
        renderSuggest();
      }).catch(function () { S.suggestions = []; renderSuggest(); });
  }
  function renderSuggest() {
    var box = el('bm-sug');
    if (!S.suggestions.length || S.client) { box.style.display = 'none'; return; }
    box.innerHTML = '';
    S.suggestions.forEach(function (s) {
      var b = document.createElement('button'); b.textContent = s.label; b.onclick = function () { pick(s); }; box.appendChild(b);
    });
    box.style.display = 'block';
  }
  function pick(s) {
    S.client = s; S.query = s.label; el('bm-q').value = s.label; S.suggestions = []; S.sel = 0;
    renderSuggest(); compute(); render();
    if (S.opts[0]) { S.dayIdx = S.opts[0].dayIdx; }
    renderMap(true);
  }

  // ---------- data ----------
  function load() {
    if (S.loading) return;
    S.loading = true; S.error = null; render();
    var from = new Date(); var to = new Date(); to.setDate(to.getDate() + CFG.horizonDays);
    Promise.all([
      fetch('/api/schedule?from=' + ymd(from) + '&to=' + ymd(to)).then(function (r) { return r.json(); }),
      fetch('/regions.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var d = res[0]; S.regions = res[1];
      if (!d || d.status !== 'success') throw new Error((d && d.message) || 'Could not load the schedule');
      prepare(d);
      return geocodeMissing();
    }).then(function () {
      S.loaded = true; S.loading = false; initMap(); drawRegions(); compute(); render(); renderMap(true);
    }).catch(function (e) {
      S.loading = false; S.error = e.message; render();
    });
  }

  function prepare(d) {
    S.jobs = d.jobs || {};
    var used = {};
    S.acts = (d.activities || []).map(function (a) {
      var st = parseSm8(a.start), en = parseSm8(a.end);
      if (!st) return null;
      used[a.staff_uuid] = true;
      return { job: a.job_uuid, staff: a.staff_uuid, date: st.date, start: st.mins, end: en && en.date === st.date ? en.mins : st.mins + 120 };
    }).filter(Boolean);
    S.staff = (d.staff || []).filter(function (s) {
      return used[s.uuid] && CFG.hiddenStaff.indexOf((s.first || '').trim().toLowerCase()) < 0;
    }).sort(function (a, b) { return (isInspector(b) - isInspector(a)) || staffName(a).localeCompare(staffName(b)); });
    S.staff.forEach(function (s, i) { s.color = COLORS[i % COLORS.length]; s.inspector = isInspector(s); });
    // working days
    S.days = []; var d0 = new Date(); d0.setHours(0, 0, 0, 0);
    for (var i = 0; i <= CFG.horizonDays; i++) {
      var x = new Date(d0); x.setDate(d0.getDate() + i);
      if (x.getDay() !== 0 && x.getDay() !== 6) S.days.push(x);
    }
    S.byStaffDay = {};
    S.acts.forEach(function (a) {
      var k = a.staff + '|' + a.date; (S.byStaffDay[k] = S.byStaffDay[k] || []).push(a);
    });
    Object.keys(S.byStaffDay).forEach(function (k) { S.byStaffDay[k].sort(function (a, b) { return a.start - b.start; }); });
  }

  // Jobs without coordinates from ServiceM8 get geocoded once and cached in the browser.
  function geocodeMissing() {
    var cache = {}; try { cache = JSON.parse(localStorage.getItem('bm_geo') || '{}'); } catch (e) {}
    var todo = [];
    Object.keys(S.jobs).forEach(function (u) {
      var j = S.jobs[u];
      if (j.lat && j.lng) return;
      if (cache[j.address]) { j.lat = cache[j.address][0]; j.lng = cache[j.address][1]; return; }
      if (j.address) todo.push(j);
    });
    todo = todo.slice(0, 40);
    var i = 0;
    function next() {
      if (i >= todo.length) { try { localStorage.setItem('bm_geo', JSON.stringify(cache)); } catch (e) {} return Promise.resolve(); }
      var j = todo[i++];
      return fetch('https://photon.komoot.io/api/?limit=1&bbox=' + CFG.melbBox + '&q=' + encodeURIComponent(j.address))
        .then(function (r) { return r.json(); })
        .then(function (d) { var f = d.features && d.features[0]; if (f) { j.lat = f.geometry.coordinates[1]; j.lng = f.geometry.coordinates[0]; cache[j.address] = [j.lat, j.lng]; } })
        .catch(function () {}).then(next);
    }
    return next();
  }

  function dayActs(staffUuid, dayIdx) { var d = S.days[dayIdx]; return d ? (S.byStaffDay[staffUuid + '|' + ymd(d)] || []) : []; }
  function jobPt(a) { var j = S.jobs[a.job]; return j && j.lat && j.lng ? { lat: +j.lat, lng: +j.lng } : null; }
  function freeGaps(acts) {
    var gaps = [], t = CFG.dayStart;
    acts.forEach(function (a) { if (a.start - t >= 60) gaps.push([t, a.start]); t = Math.max(t, a.end); });
    if (CFG.dayEnd - t >= 60) gaps.push([t, CFG.dayEnd]);
    return gaps;
  }

  // ---------- the brains ----------
  function compute() {
    S.opts = [];
    if (!S.loaded || !S.client) return;
    var c = S.client, visible = S.staff.filter(function (s) { return !S.hidden[s.uuid]; });
    if (S.mode === 'quote') {
      var opts = [];
      visible.filter(function (s) { return s.inspector; }).forEach(function (s) {
        S.days.forEach(function (d, di) {
          var acts = dayActs(s.uuid, di);
          var nowM = new Date().getHours() * 60 + new Date().getMinutes();
          var gaps = freeGaps(acts), best = null;
          gaps.forEach(function (g) {
            // the job right before and after this gap
            var before = acts.filter(function (a) { return a.end <= g[0]; }).pop();
            var after = acts.filter(function (a) { return a.start >= g[1]; })[0];
            var startAt = before ? g[0] + CFG.travelBufferMinutes : g[0];
            startAt = Math.ceil(startAt / 30) * 30;
            if (di === 0) startAt = Math.max(startAt, Math.ceil((nowM + 120) / 30) * 30); // not in the past / too soon
            if (startAt + CFG.inspectionMinutes > g[1] - (after ? CFG.travelBufferMinutes : 0)) return;
            var ref = before || after, pt = ref ? jobPt(ref) : CFG.office;
            if (!pt) return;
            var dist = km(c, pt);
            if (!best || dist < best.dist) best = { dist: dist, start: startAt, from: ref ? (hm(ref.start) + ' job in ' + suburbOf(S.jobs[ref.job] || {})) : CFG.office.name };
          });
          if (best) opts.push({ staff: s, dayIdx: di, slot: best.start, dist: best.dist, from: best.from, score: best.dist + di * 0.12 });
        });
      });
      opts.sort(function (a, b) { return a.score - b.score; });
      var seen = {};
      S.opts = opts.filter(function (o) { var k = o.dayIdx + '|' + o.staff.uuid; if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 3);
    } else {
      var n = S.ndays, out = [];
      visible.filter(function (s) { return !s.inspector; }).forEach(function (s) {
        var found = 0;
        for (var i = 0; i + n <= S.days.length && found < 2; i++) {
          var ok = true;
          for (var k = 0; k < n; k++) if (dayActs(s.uuid, i + k).length) { ok = false; break; }
          if (!ok) continue;
          var prev = null;
          for (var b = i - 1; b >= 0 && b >= i - 5 && !prev; b--) { var pa = dayActs(s.uuid, b); if (pa.length) prev = { a: pa[pa.length - 1], di: b }; }
          var ppt = prev ? jobPt(prev.a) : null;
          out.push({ staff: s, dayIdx: i, endIdx: i + n - 1, prev: prev, dist: ppt ? km(c, ppt) : km(c, CFG.office) });
          found++; i += n - 1;
        }
      });
      out.sort(function (a, b) { return a.dayIdx - b.dayIdx || a.dist - b.dist; });
      S.opts = out.slice(0, 3);
    }
  }

  function optText(o) {
    if (S.mode === 'quote') {
      return {
        when: dShort(S.days[o.dayIdx]) + ' · ' + hm(o.slot) + '–' + hm(o.slot + CFG.inspectionMinutes),
        why: '≈' + driveMins(o.dist) + ' min drive from ' + o.from,
        msg: 'Good news – we can come out on ' + dLong(S.days[o.dayIdx]) + ' between ' + hm(o.slot) + ' and ' + hm(o.slot + CFG.inspectionMinutes) + '. Does that suit you?',
        badge: o.dist <= 5 ? ['Very close', '#DDF3E8', '#0F5C3A'] : o.dist <= 12 ? ['Close', '#FFF0D6', '#7A4A00'] : ['Further away', '#EEF1F3', '#4A5B67']
      };
    }
    var w = S.ndays === 1 ? dShort(S.days[o.dayIdx]) : dShort(S.days[o.dayIdx]) + ' → ' + dShort(S.days[o.endIdx]);
    var wl = S.ndays === 1 ? dLong(S.days[o.dayIdx]) : dLong(S.days[o.dayIdx]) + ' to ' + dLong(S.days[o.endIdx]);
    return {
      when: w,
      why: (S.ndays === 1 ? 'Free all day' : S.ndays + ' free working days in a row') +
        (o.prev ? ' · previous job ' + dShort(S.days[o.prev.di]) + ' in ' + suburbOf(S.jobs[o.prev.a.job] || {}) + ' (≈' + driveMins(o.dist) + ' min from client)' : ''),
      msg: 'Great news – we can start your job on ' + wl + '. Does that work for you?',
      badge: null
    };
  }

  // ---------- rendering ----------
  function render() {
    if (!el('bm-root')) return;
    document.querySelectorAll('#bm-root .bm-mode').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === S.mode); });
    el('bm-daysbox').style.display = S.mode === 'job' ? 'block' : 'none';
    el('bm-nd').textContent = S.ndays + (S.ndays === 1 ? ' day' : ' days');
    var reg = S.client ? regionOf(S.client) : null;
    el('bm-where').textContent = S.client ? ('Pin dropped: ' + (S.client.suburb || S.client.label) + (reg ? ' · ' + reg.toUpperCase() + ' side' : '')) : '';
    el('bm-title').textContent = !S.client ? 'Options' : S.mode === 'quote' ? 'Best inspection slots' : 'First available for a ' + S.ndays + '-day job';
    var st = el('bm-status');
    if (S.error) st.innerHTML = '<div class="bm-err">Could not load the ServiceM8 schedule: ' + esc(S.error) + '. <button class="bm-link" id="bm-retry">Try again</button></div>';
    else if (S.loading) st.innerHTML = '<div class="bm-empty">Loading the next 3 months of bookings from ServiceM8…</div>';
    else if (!S.client) st.innerHTML = '<div class="bm-empty">Type the client’s address above and pick it from the list.</div>';
    else if (!S.opts.length) st.innerHTML = '<div class="bm-empty">No free ' + (S.mode === 'quote' ? 'inspection slot' : S.ndays + '-day run') + ' found in the next 3 months for the staff shown.</div>';
    else st.innerHTML = '';
    if (el('bm-retry')) el('bm-retry').onclick = load;

    var cards = el('bm-cards'); cards.innerHTML = '';
    S.opts.forEach(function (o, i) {
      var t = optText(o), div = document.createElement('div');
      div.className = 'bm-opt' + (i === S.sel ? ' on' : '');
      div.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="bm-rank">' + (i === 0 ? (S.mode === 'job' ? 'FIRST AVAILABLE' : 'BEST OPTION') : 'OPTION ' + (i + 1)) + '</span>' +
        (t.badge ? '<span class="bm-badge" style="background:' + t.badge[1] + ';color:' + t.badge[2] + '">' + t.badge[0] + '</span>' : '') + '</div>' +
        '<div class="bm-when">' + esc(t.when) + '</div>' +
        '<div class="bm-who"><span class="bm-dot" style="background:' + o.staff.color + '"></span>' + esc(staffName(o.staff)) + '</div>' +
        '<div class="bm-why">' + esc(t.why) + '</div>' +
        '<div class="bm-btns"><button class="bm-btn dark" data-a="copy">Copy text for client</button><button class="bm-btn" data-a="map">See on map</button></div>';
      div.querySelector('[data-a="copy"]').onclick = function (e) {
        var b = e.currentTarget;
        (navigator.clipboard ? navigator.clipboard.writeText(t.msg) : Promise.reject()).then(function () { b.textContent = 'Copied'; }, function () { window.prompt('Copy this text:', t.msg); });
      };
      div.querySelector('[data-a="map"]').onclick = function () { S.sel = i; S.dayIdx = o.dayIdx; render(); renderMap(true); el('bm-map').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      cards.appendChild(div);
    });

    var chips = el('bm-chips'); chips.innerHTML = '<span style="font-size:14px;font-weight:700;color:#4A5B67">Show on map:</span>';
    S.staff.forEach(function (s) {
      var on = !S.hidden[s.uuid], b = document.createElement('button');
      b.className = 'bm-chip'; b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.style.cssText = on ? 'background:' + s.color + ';color:#fff;border:2px solid ' + s.color : 'background:#fff;color:#4A5B67;border:2px dashed #B9C6CF';
      b.innerHTML = '<span class="bm-dot" style="background:' + (on ? '#fff' : s.color) + '"></span>' + esc(staffName(s)) + (s.inspector ? ' <small style="opacity:.8;font-weight:600">· inspections</small>' : '');
      b.onclick = function () { S.hidden[s.uuid] = !S.hidden[s.uuid]; S.sel = 0; compute(); render(); renderMap(); };
      chips.appendChild(b);
    });
    var all = document.createElement('button'); all.className = 'bm-link'; all.textContent = 'All';
    all.onclick = function () { S.hidden = {}; compute(); render(); renderMap(); };
    var none = document.createElement('button'); none.className = 'bm-link'; none.textContent = 'None';
    none.onclick = function () { S.staff.forEach(function (s) { S.hidden[s.uuid] = true; }); compute(); render(); renderMap(); };
    chips.appendChild(all); chips.appendChild(none);
  }

  function drawRegions() {
    if (!S.map || !S.regions || S.regionsDrawn) return;
    S.regionsDrawn = true;
      L.geoJSON(S.regions, {
        interactive: false,
        style: function (f) { var c = REGION_STYLE[f.properties.region] || '#999'; return { color: c, weight: 2, fillColor: c, fillOpacity: 0.12 }; }
      }).addTo(S.map);
      var labels = { 'North': [-37.52, 145.02], 'East': [-37.80, 145.33], 'South East': [-38.02, 145.24], 'West': [-37.78, 144.74], 'Peninsula': [-38.25, 145.10], 'Inner': [-37.835, 144.985] };
      Object.keys(labels).forEach(function (k) {
        L.marker(labels[k], { interactive: false, icon: L.divIcon({ className: '', html: '<div class="bm-region">' + k.toUpperCase() + '</div>', iconSize: [120, 16], iconAnchor: [60, 8] }) }).addTo(S.map);
      });
    }

  function initMap() {
    if (S.map || !window.L) return;
    S.map = L.map('bm-map', { zoomControl: true }).setView([-37.85, 145.02], 10);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 18, subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(S.map);
    drawRegions();
    var Compass = L.Control.extend({ onAdd: function () {
      var d = L.DomUtil.create('div', 'bm-compass');
      d.innerHTML = '<svg width="50" height="50" viewBox="0 0 100 100" role="img" aria-label="North is up"><polygon points="50,14 58,50 42,50" fill="#E11D48"/><polygon points="50,86 58,50 42,50" fill="#0E2A3B"/><text x="50" y="12" text-anchor="middle" font-size="16" font-weight="800" fill="#E11D48" font-family="Arial">N</text></svg>';
      return d;
    } });
    new Compass({ position: 'topright' }).addTo(S.map);
    S.layer = L.layerGroup().addTo(S.map);
  }

  function renderMap(fit) {
    if (!S.map || !S.days.length) { if (el('bm-day')) el('bm-day').textContent = ''; return; }
    el('bm-day').textContent = dLong(S.days[S.dayIdx]);
    S.layer.clearLayers();
    var pts = [], run = el('bm-run'); run.innerHTML = '';
    S.staff.forEach(function (s) {
      if (S.hidden[s.uuid]) return;
      var acts = dayActs(s.uuid, S.dayIdx), line = [];
      acts.forEach(function (a, i) {
        var p = jobPt(a), j = S.jobs[a.job] || {};
        var item = document.createElement('div'); item.className = 'bm-runitem';
        item.innerHTML = '<span class="bm-num" style="background:' + s.color + '">' + (i + 1) + '</span><div><b>' + esc(staffName(s)) + ' · ' + hm(a.start) + '–' + hm(a.end) + '</b><br>' + esc(suburbOf(j)) + (p ? '' : ' (no map location)') + '</div>';
        run.appendChild(item);
        if (!p) return;
        line.push([p.lat, p.lng]); pts.push([p.lat, p.lng]);
        L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', iconSize: [0, 0], iconAnchor: [13, 13],
          html: '<div class="bm-pin"><b style="background:' + s.color + '">' + (i + 1) + '</b><span>' + esc(staffName(s)) + ' · ' + hm(a.start) + ' · ' + esc(suburbOf(j)) + '</span></div>' }) }).addTo(S.layer);
      });
      if (line.length > 1) L.polyline(line, { color: s.color, weight: 4, opacity: 0.8 }).addTo(S.layer);
      freeGaps(acts).forEach(function (g) {
        var item = document.createElement('div'); item.className = 'bm-runitem free';
        item.innerHTML = '<span class="bm-num" style="background:#fff;border:2px dashed ' + s.color + '"></span><div><b>' + esc(staffName(s)) + ' · FREE ' + (acts.length ? hm(g[0]) + '–' + hm(g[1]) : 'ALL DAY') + '</b><br>Available to book</div>';
        run.appendChild(item);
      });
    });
    if (S.client) {
      pts.push([S.client.lat, S.client.lng]);
      L.marker([S.client.lat, S.client.lng], { zIndexOffset: 1000, icon: L.divIcon({ className: '', iconSize: [0, 0], iconAnchor: [11, 11],
        html: '<div class="bm-pin bm-client"><b></b><span>CLIENT · ' + esc(S.client.suburb || '') + '</span></div>' }) }).addTo(S.layer);
    }
    if (fit) {
      if (S.client && S.opts[S.sel]) S.map.setView([S.client.lat, S.client.lng], 12);
      else if (pts.length) S.map.fitBounds(pts, { padding: [40, 40], maxZoom: 13 });
    }
  }

  // ---------- entry point (called by switchPage) ----------
  window.BookingMap = {
    open: function () {
      injectCss();
      if (!el('bm-root')) shell();
      render();
      loadLeaflet().then(function () {
        if (!S.loaded && !S.loading) load();
        setTimeout(function () { initMap(); if (S.map) S.map.invalidateSize(); renderMap(); }, 50);
      }).catch(function (e) { S.error = e.message; render(); });
    }
  };
})();
