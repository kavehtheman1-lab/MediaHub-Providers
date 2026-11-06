// Stremio addons for MediaHub.
// Every source you add here is ONE Stremio addon (paste its manifest address).
//  - Addons with catalogs (e.g. Cinemeta) fill the home screen and search.
//  - Addons with streams give the play links. Put extra stream addons in the second field and
//    they are asked too, the same way Stremio asks all your installed addons.
// Only streams that are a direct web address (mp4 / m3u8 / mkv) can play on the TV.
// Torrent-only streams need a debrid addon that returns direct links.
(function () {
  'use strict';

  var MAN = {};                                   // manifest cache: base address -> manifest

  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function baseOf(u) {
    u = String(u || '').trim();
    if (!u) throw new Error('Addon address is empty');
    u = u.replace(/^stremio:\/\//i, 'https://');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u.replace(/#.*$/, '').replace(/\/manifest\.json(\?.*)?$/i, '').replace(/\/+$/, '');
  }
  function enc(s) { return encodeURIComponent(String(s)); }
  function withTimeout(p, ms, what) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error((what || 'request') + ' timed out')); }, ms);
      p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  async function getJson(url) { return withTimeout(MediaHub.getJSON(url), 20000, 'addon'); }
  async function manifestOf(base) {
    if (MAN[base]) return MAN[base];
    var m = await getJson(base + '/manifest.json');
    if (!m || typeof m !== 'object' || (!m.id && !m.name)) throw new Error('Not a Stremio addon: ' + base.replace(/^https?:\/\//, '').slice(0, 40));
    MAN[base] = m;
    return m;
  }
  function resNames(m) { return (m.resources || []).map(function (r) { return typeof r === 'string' ? r : (r && r.name); }); }
  function resFor(m, name) {
    var rs = m.resources || [];
    for (var i = 0; i < rs.length; i++) if ((typeof rs[i] === 'string' ? rs[i] : rs[i] && rs[i].name) === name) return rs[i];
    return null;
  }
  function has(m, name) { return !!resFor(m, name); }
  // does this addon answer for this kind of title / id?
  function answers(m, name, type, id) {
    var r = resFor(m, name); if (!r) return false;
    var types = (typeof r === 'object' && r.types) || m.types, pre = (typeof r === 'object' && r.idPrefixes) || m.idPrefixes;
    if (types && types.length && types.indexOf(type) < 0) return false;
    if (pre && pre.length && !pre.some(function (p) { return String(id).indexOf(p) === 0; })) return false;
    return true;
  }
  function extraOf(c) {                             // [{name, required}] from both manifest styles
    var out = [];
    (c.extra || []).forEach(function (e) { if (e && e.name) out.push({ name: e.name, required: !!e.isRequired }); });
    (c.extraSupported || []).forEach(function (n) { if (!out.some(function (o) { return o.name === n; })) out.push({ name: n, required: false }); });
    (c.extraRequired || []).forEach(function (n) { var o = out.filter(function (x) { return x.name === n; })[0]; if (o) o.required = true; else out.push({ name: n, required: true }); });
    return out;
  }
  function cardOf(meta, type) {
    var id = type + '|' + meta.id;
    return { id: id, url: id, title: clean(meta.name) || meta.id, poster: meta.poster || meta.background || '' };
  }
  function splitId(s) {
    s = String(s || ''); var i = s.indexOf('|');
    return i < 0 ? { type: 'movie', id: s } : { type: s.slice(0, i), id: s.slice(i + 1) };
  }
  function typeLabel(t) { return ({ movie: 'Movies', series: 'Series', anime: 'Anime', tv: 'TV', channel: 'Channels' })[t] || t; }

  async function catalogItems(base, c, extra) {
    var url = base + '/catalog/' + enc(c.type) + '/' + enc(c.id) + (extra ? '/' + extra : '') + '.json';
    var j = await getJson(url);
    return (j.metas || []).filter(function (m) { return m && m.id; }).slice(0, 40).map(function (m) { return cardOf(m, m.type || c.type); });
  }

  MediaHub.registerProvider({
    id: 'stremio',
    name: 'Stremio addon',
    fields: [
      { key: 'url', label: 'Addon address (manifest.json or stremio:// link)', placeholder: 'https://v3-cinemeta.strem.io/manifest.json' },
      { key: 'more', label: 'Extra stream addons (optional, separate with spaces)', placeholder: 'https://.../manifest.json', optional: true }
    ],

    getHome: async function (cfg) {
      var base = baseOf(cfg.url), m = await manifestOf(base);
      var cats = (m.catalogs || []).filter(function (c) { return !extraOf(c).some(function (e) { return e.required; }); }).slice(0, 8);
      if (!cats.length) throw new Error('"' + (m.name || 'This addon') + '" has no catalogs (it only gives streams). Add it in the "Extra stream addons" field of a catalog addon such as Cinemeta.');
      var seenT = {};
      var rows = await Promise.all(cats.map(function (c) {
        return catalogItems(base, c).then(function (items) {
          var t = clean(c.name || c.id), tl = typeLabel(c.type);
          if (t.toLowerCase().indexOf(tl.toLowerCase()) < 0) t += ' \u00B7 ' + tl;
          if (seenT[t]) t += ' (' + c.id + ')'; seenT[t] = 1;
          return { title: t, items: items };
        }).catch(function () { return null; });
      }));
      rows = rows.filter(function (r) { return r && r.items.length; });
      if (!rows.length) throw new Error('The addon answered, but its catalogs are empty');
      return rows;
    },

    search: async function (cfg, q) {
      var base = baseOf(cfg.url), m = await manifestOf(base), enc2 = 'search=' + enc(q);
      var cats = (m.catalogs || []).filter(function (c) {
        var ex = extraOf(c); return ex.some(function (e) { return e.name === 'search'; }) && !ex.some(function (e) { return e.required && e.name !== 'search'; });
      }).slice(0, 5);
      if (!cats.length) throw new Error('This addon has no search');
      var res = await Promise.all(cats.map(function (c) { return catalogItems(base, c, enc2).catch(function () { return []; }); }));
      var out = [], seen = {};
      res.forEach(function (list) { list.forEach(function (x) { if (!seen[x.id]) { seen[x.id] = 1; out.push(x); } }); });
      return out;
    },

    load: async function (cfg, item) {
      var base = baseOf(cfg.url), m = await manifestOf(base), s = splitId(item.id || item.url);
      var meta = null;
      if (answers(m, 'meta', s.type, s.id)) {
        try { meta = (await getJson(base + '/meta/' + enc(s.type) + '/' + enc(s.id) + '.json')).meta; } catch (e) {}
      }
      if (!meta) {                                  // try the extra addons for details
        var ex = String(cfg.more || '').split(/[\s,]+/).filter(Boolean);
        for (var i = 0; i < ex.length && !meta; i++) {
          try {
            var b2 = baseOf(ex[i]), m2 = await manifestOf(b2);
            if (answers(m2, 'meta', s.type, s.id)) meta = (await getJson(b2 + '/meta/' + enc(s.type) + '/' + enc(s.id) + '.json')).meta;
          } catch (e) {}
        }
      }
      meta = meta || {};
      var info = { title: clean(meta.name) || item.title, poster: meta.poster || meta.background || item.poster, desc: meta.description || meta.overview || '' };
      info.genres = (meta.genres || meta.genre || []).slice(0, 8);
      var rows = [];
      if (meta.releaseInfo || meta.year) rows.push({ k: 'Year', v: String(meta.releaseInfo || meta.year) });
      if (meta.runtime) rows.push({ k: 'Runtime', v: String(meta.runtime) });
      if (meta.imdbRating) rows.push({ k: 'IMDb', v: String(meta.imdbRating) });
      if (meta.director && meta.director.length) rows.push({ k: 'Director', v: [].concat(meta.director).join(', ') });
      if (meta.cast && meta.cast.length) rows.push({ k: 'Cast', v: meta.cast.slice(0, 6).join(', ') });
      info.meta = rows;
      var vids = (meta.videos || []).filter(function (v) { return v && v.id && (v.season != null || v.episode != null); });
      if (s.type !== 'movie' && vids.length) {
        var eps = vids.map(function (v) {
          var sn = v.season != null ? +v.season : 1, en = v.episode != null ? +v.episode : 0;
          var name = clean(v.title || v.name || ''), label = 'E' + en + (name && !/^episode\s*\d+$/i.test(name) ? ' \u00B7 ' + name : '');
          var id = s.type + '|' + v.id;
          return { id: id, url: id, title: label, season: sn, _e: en };
        });
        eps.sort(function (a, b) { return (a.season - b.season) || (a._e - b._e); });
        eps.forEach(function (e) { delete e._e; });
        var nz = eps.filter(function (e) { return e.season > 0; });
        info.currentSeason = String((nz[0] || eps[0]).season);
        info.episodes = eps;
      }
      return info;
    },

    getLinks: async function (cfg, target) {
      var s = splitId(target.id || target.url), bases = [baseOf(cfg.url)];
      String(cfg.more || '').split(/[\s,]+/).filter(Boolean).forEach(function (u) { try { var b = baseOf(u); if (bases.indexOf(b) < 0) bases.push(b); } catch (e) {} });
      var rep = [], torrents = 0, others = 0;
      var results = await Promise.all(bases.map(async function (b) {
        try {
          var m = await manifestOf(b);
          if (!answers(m, 'stream', s.type, s.id)) return [];
          var j = await getJson(b + '/stream/' + enc(s.type) + '/' + enc(s.id) + '.json');
          return (j.streams || []).map(function (x) { x._addon = clean(m.name || ''); return x; });
        } catch (e) { rep.push(b.replace(/^https?:\/\//, '').slice(0, 24) + ' ' + String((e && e.message) || e).slice(0, 40)); return []; }
      }));
      var links = [], seen = {};
      function rank(t) { return /2160|4k|uhd/i.test(t) ? 2 : /1080/.test(t) ? 0 : /720/.test(t) ? 1 : /480|360/.test(t) ? 3 : 4; }
      results.forEach(function (list) {
        list.forEach(function (x) {
          var u = x.url ? String(x.url) : '';
          if (!/^https?:\/\//i.test(u)) { if (x.infoHash || /^magnet:/i.test(u)) torrents++; else others++; return; }
          if (seen[u]) return; seen[u] = 1;
          var title = clean(String(x.title || x.description || '').split('\n')[0]).slice(0, 48);
          var name = clean(String(x.name || x._addon || 'Stream').replace(/\n/g, ' ')).slice(0, 24);
          var hint = (x.behaviorHints || {}), hdr = hint.proxyHeaders && hint.proxyHeaders.request || null;
          var ref = hdr && (hdr.Referer || hdr.referer || hdr.Referrer);
          var l = { url: u, label: name + (title ? ' \u00B7 ' + title : ''), _r: rank(name + ' ' + title) };
          if (ref) { l.referer = ref; l.relay = true; }
          links.push(l);
        });
      });
      links.sort(function (a, b) { return a._r - b._r; });
      links = links.slice(0, 25).map(function (l) { delete l._r; return l; });
      if (!links.length) {
        throw new Error('No playable stream | ' + bases.length + ' addon(s)' + (torrents ? ', ' + torrents + ' torrent-only (needs a debrid addon)' : '') + (others ? ', ' + others + ' other' : '') + (rep.length ? ' | ' + rep.join('; ') : '') + (bases.length === 1 ? ' | add a stream addon in the second field' : ''));
      }
      return links;
    }
  });
})();
