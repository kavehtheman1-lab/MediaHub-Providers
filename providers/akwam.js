// Akwam provider for MediaHub.
// Ported from the CloudStream plugin (Akwam.cs3 v4). Not tested against the live site:
// if something does not load, the error message shows what the page returned - send it back to refine.
(function () {
  'use strict';

  var MEDIA = /https?:\\?\/\\?\/[^"'\s<>\\]+?\.(?:m3u8|mp4|mpd)(?:\?[^"'\s<>\\]*)?/gi;
  var DEFAULT_BASE = 'https://akwam.ss';
  var ITEM = /\/(movie|series|show|shows|episode|anime)\/\d+/i;

  function baseOf(cfg) {
    var u = String((cfg && cfg.url) || '').trim() || DEFAULT_BASE;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try { return new URL(u).origin; } catch (e) { throw new Error('Site address is not valid: ' + u); }   // "https://akwam.ss/one" -> "https://akwam.ss"
  }
  function abs(u, base) { try { return new URL(String(u || '').replace(/&amp;/g, '&'), base).href; } catch (e) { return ''; } }
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function dec(u) { try { return decodeURIComponent(u); } catch (e) { return u; } }
  function latin(d) { return String(d).replace(/[\u0660-\u0669]/g, function (c) { return c.charCodeAt(0) - 0x660; }); }
  function parse(html) { return new DOMParser().parseFromString(html, 'text/html'); }
  function getHtml(url, opt) { return MediaHub.getText(url, opt); }
  function metaOf(d, pr) { var m = d.querySelector('meta[property="' + pr + '"],meta[name="' + pr + '"]'); return m ? m.getAttribute('content') : ''; }
  function diag(html, url) {
    var t = (html.match(/<title[^>]*>([^<]*)/i) || [])[1] || '';
    var cf = /just a moment|cf-browser-verification|challenge-platform/i.test(html) ? ' [Cloudflare check]' : '';
    return 'No items found at ' + url + ' - page title: "' + clean(t).slice(0, 60) + '", ' + html.length + ' chars' + cf;
  }

  // ---------- cards ----------
  function imgOf(n, base) {
    var img = n.querySelector('img'), u = '';
    if (img) u = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('src') || '';
    return u && !/^data:/.test(u) ? abs(u, base) : '';
  }
  function cardOf(box, base) {
    var a = box.querySelector('h3.entry-title a') || box.querySelector('h3 a') || box.querySelector('a[href]');
    if (!a) return null;
    var href = abs(a.getAttribute('href'), base);
    if (!href || !ITEM.test(href)) return null;
    var title = clean(a.textContent) || clean((box.querySelector('img') || {}).alt);
    if (!title) return null;
    return { id: href, url: href, title: title, poster: imgOf(box, base) };
  }
  function cardsIn(doc, base) {
    var out = [], seen = {};
    var boxes = doc.querySelectorAll('div.col-lg-auto.col-md-4.col-6, div.widget-body div[class*="col-"]');
    [].forEach.call(boxes, function (b) {
      var c = cardOf(b, base);
      if (c && !seen[c.id]) { seen[c.id] = 1; out.push(c); }
    });
    if (!out.length) {                       // layout changed: any link to a title page that holds a picture
      [].forEach.call(doc.querySelectorAll('a[href]'), function (a) {
        var href = abs(a.getAttribute('href'), base);
        if (!href || !ITEM.test(href) || /\/episode\//i.test(href) || seen[href]) return;
        var box = a.closest('div') || a, img = a.querySelector('img') || (box.querySelector && box.querySelector('img'));
        if (!img) return;
        var t = clean(a.getAttribute('title') || a.textContent || img.getAttribute('alt'));
        if (!t) return;
        seen[href] = 1; out.push({ id: href, url: href, title: t, poster: imgOf(box, base) });
      });
    }
    return out;
  }

  // ---------- series helpers ----------
  var ORD = [['الأول', 1], ['الاول', 1], ['الثاني', 2], ['الثانى', 2], ['الثالث', 3], ['الرابع', 4], ['الخامس', 5], ['السادس', 6],
    ['السابع', 7], ['الثامن', 8], ['التاسع', 9], ['العاشر', 10]];
  function numOf(t, re) {
    t = latin(t);
    var m = t.match(re); if (m) return +m[1];
    return 0;
  }
  function epNum(t) { return numOf(t, /(?:الحلقة|حلقة|episode|\bep)[\s\-_.:]*0*(\d+)/i); }
  function seasonNum(t) {
    var n = numOf(t, /(?:الموسم|موسم|season|\bs)[\s\-_]*0*(\d+)/i);
    if (n) return n;
    for (var i = 0; i < ORD.length; i++) if (t.indexOf(ORD[i][0]) >= 0 && /الموسم|موسم/.test(t)) return ORD[i][1];
    return 0;
  }
  function cleanSeries(t) {
    return clean(String(t).replace(/^\s*(?:مسلسل|فيلم|انمي|أنمي|برنامج)\s+/i, '').replace(/\s*(?:الموسم|موسم|season)\s*[\d\u0660-\u0669]*.*$/i, '')
      .replace(/\s*(?:الحلقة|حلقة)\s*[\d\u0660-\u0669]+.*$/i, ''));
  }

  function metaBlock(doc) {
    var rows = [], seen = {};
    [].forEach.call(doc.querySelectorAll('div.font-size-16.text-white, div.font-size-16'), function (n) {
      var t = clean(n.textContent);
      var m = t.match(/^([^:：]{2,24})[:：]\s*(.+)$/);
      if (m && m[2].length < 120 && !seen[m[1]]) { seen[m[1]] = 1; rows.push({ k: clean(m[1]), v: clean(m[2]) }); }
    });
    return rows.slice(0, 8);
  }
  function plotOf(doc) {
    var hs = doc.querySelectorAll('h2');
    for (var i = 0; i < hs.length; i++) {
      if (/القصة|قصة|story/i.test(hs[i].textContent)) {
        var nx = hs[i].nextElementSibling, p = nx && (nx.tagName === 'P' ? nx : nx.querySelector('p'));
        if (p) return clean(p.textContent);
        if (nx) return clean(nx.textContent);
      }
    }
    return clean(metaOf(doc, 'og:description') || metaOf(doc, 'description'));
  }
  function genresOf(doc) {
    var g = [];
    [].forEach.call(doc.querySelectorAll('div.font-size-16.text-white a[href*="/genre/"], div.font-size-16.text-white a[href*="/category/"], a[href*="/genre/"]'), function (a) {
      var t = clean(a.textContent); if (t && t.length < 30 && g.indexOf(t) < 0) g.push(t);
    });
    return g.slice(0, 8);
  }

  function seasonLinks(doc, url, base) {
    var out = [], seen = {};
    [].forEach.call(doc.querySelectorAll("div.widget-body > a.btn[href*='/series/'], div.widget-body > a.btn[href*='/shows/'], div.widget-body > a.btn[href*='/show/']"), function (a) {
      var href = abs(a.getAttribute('href'), base), t = clean(a.textContent);
      var k = seasonNum(t) || seasonNum(dec(href));
      if (!href || seen[href]) return;
      seen[href] = 1;
      out.push({ k: String(k || out.length + 1), label: t || ('Season ' + (k || out.length + 1)), url: href });
    });
    return out.sort(function (a, b) { return +a.k - +b.k; });
  }

  function episodesOf(doc, url, base) {
    var out = [], seen = {};
    var boxes = doc.querySelectorAll("div#series-episodes div.col-lg-4, div#series-episodes div.col-md-6, div#series-episodes div[class*='col-']");
    var anchors = [];
    [].forEach.call(boxes, function (b) { var a = b.querySelector("a[href*='/episode/']"); if (a) anchors.push(a); });
    if (!anchors.length) anchors = [].slice.call(doc.querySelectorAll("a[href*='/episode/']"));
    anchors.forEach(function (a) {
      var href = abs(a.getAttribute('href'), base);
      if (!href || seen[href]) return;
      var box = a.closest('div[class*="col-"]') || a.parentElement || a;
      var h = box.querySelector('h3, h2, .entry-title') || a;
      var t = clean(h.textContent) || clean(a.textContent);
      var n = epNum(t) || epNum(dec(href));
      seen[href] = 1;
      out.push({ id: href, url: href, title: n ? 'الحلقة ' + n : (t || 'Episode'), n: n, poster: imgOf(box, base) });
    });
    var anyN = out.some(function (e) { return e.n > 0; });
    if (anyN) out = out.map(function (e, i) { e.k = i; return e; }).sort(function (a, b) { return (a.n - b.n) || (a.k - b.k); });
    else out.reverse();                      // the site lists newest first
    out.forEach(function (e) { delete e.k; });
    return out;
  }

  // ---------- links ----------
  function qualityOf(el, doc) {
    var txt = '';
    var pane = el.closest && el.closest('.tab-pane,[id^="tab-"]');
    if (pane && pane.id) { var nav = doc.querySelector('a[href="#' + pane.id + '"]'); if (nav) txt += ' ' + nav.textContent; }
    var p = el, i = 0;
    while (p && i < 3) { txt += ' ' + (p.getAttribute && (p.getAttribute('data-quality') || '')) + ' ' + p.textContent; p = p.parentElement; i++; }
    var m = latin(txt).match(/(2160|1440|1080|720|480|360|240)\s*p?/i);
    return m ? +m[1] : 0;
  }
  function isMedia(u) { return /\.(mp4|m3u8|mpd|mkv|webm)(\?|$)/i.test(u); }

  MediaHub.registerProvider({
    id: 'akwam',
    name: 'Akwam',
    fields: [{ key: 'url', label: 'Site address (current Akwam domain)', placeholder: DEFAULT_BASE }],

    getHome: async function (cfg) {
      var base = baseOf(cfg);
      var pages = [['Latest', base + '/'], ['Movies', base + '/movies'], ['Series', base + '/series'], ['TV Shows', base + '/shows']];
      var res = await Promise.all(pages.map(function (p) {
        return getHtml(p[1]).then(function (h) { return { t: p[0], u: p[1], h: h }; }, function (e) { return { t: p[0], u: p[1], err: e }; });
      }));
      var groups = [], firstErr = null, firstHtml = '';
      res.forEach(function (r) {
        if (r.err) { firstErr = firstErr || r.err; return; }
        firstHtml = firstHtml || r.h;
        var items = cardsIn(parse(r.h), base);
        if (items.length) groups.push({ title: r.t, items: items });
      });
      if (!groups.length) {
        if (firstErr && !firstHtml) throw firstErr;
        throw new Error(diag(firstHtml, base + '/'));
      }
      return groups;
    },

    search: async function (cfg, q) {
      var base = baseOf(cfg), enc = encodeURIComponent(q).replace(/%20/g, '+'), out = [], seen = {}, html = '';
      for (var pg = 1; pg <= 3; pg++) {
        var url = base + '/search?q=' + enc + (pg > 1 ? '&page=' + pg : '');
        try { html = await getHtml(url); } catch (e) { if (pg === 1) throw e; break; }
        var added = 0;
        cardsIn(parse(html), base).forEach(function (c) { if (!seen[c.id]) { seen[c.id] = 1; out.push(c); added++; } });
        if (!added) break;
      }
      if (!out.length) throw new Error('Search found nothing. ' + diag(html, base + '/search?q=' + enc));
      return out;
    },

    load: async function (cfg, item) {
      var base = baseOf(cfg), url = item.url || item.id, doc = parse(await getHtml(url));
      var h1 = doc.querySelector('h1.entry-title') || doc.querySelector('h1');
      var pageTitle = clean(h1 && h1.textContent) || clean(metaOf(doc, 'og:title')) || item.title;
      var poster = item.poster || metaOf(doc, 'og:image') || imgOf(doc.querySelector('.col-lg-3, .col-md-4') || doc, base);
      var rows = metaBlock(doc), genres = genresOf(doc), desc = plotOf(doc);
      var yearA = doc.querySelector("div.font-size-16.text-white a[href*='/year/']");
      if (yearA && !rows.some(function (r) { return /\d{4}/.test(r.v); })) rows.unshift({ k: 'Year', v: clean(yearA.textContent) });
      var sc = doc.querySelector('span.font-size-14, span.mx-2');
      var isSeries = /\/(series|show|shows)\/\d+/i.test(url) || !!doc.querySelector('#series-episodes');
      var info = { title: item.title || pageTitle, poster: poster, desc: desc, genres: genres, meta: rows.slice(0, 8) };

      if (isSeries) {
        var eps = episodesOf(doc, url, base), seasons = seasonLinks(doc, url, base);
        var cur = String(seasonNum(pageTitle) || seasonNum(dec(url)) || (seasons.filter(function (s) { return s.url === url; })[0] || {}).k || 1);
        eps.forEach(function (e) { e.season = cur; delete e.n; });
        if (seasons.length && !seasons.some(function (s) { return s.k === cur; })) seasons.push({ k: cur, label: 'Season ' + cur, url: url });
        seasons.sort(function (a, b) { return +a.k - +b.k; });
        info.series = cleanSeries(pageTitle) || undefined;
        info.episodes = eps;
        info.seasons = seasons.length > 1 ? seasons : undefined;
        info.currentSeason = cur;
        if (!eps.length) info.desc = (desc ? desc + '\n\n' : '') + '(no episodes found on this page)';
      }
      return info;
    },

    // episodes of another season (loaded when the user picks it)
    seasonEpisodes: async function (cfg, meta) {
      var base = baseOf(cfg), d = parse(await getHtml(meta.url)), eps = episodesOf(d, meta.url, base);
      eps.forEach(function (e) { delete e.n; });
      if (!eps.length) throw new Error('no episodes in ' + dec(meta.url).slice(-60));
      return eps;
    },

    getLinks: async function (cfg, target) {
      var base = baseOf(cfg), page = target.url || target.id, report = [], found = [], seenU = {};
      function add(u, q, from) {
        u = abs(u, from || page);
        if (!u || seenU[u] || !isMedia(u)) return;
        seenU[u] = 1; found.push({ url: u, q: q || 0, ref: from || page });
      }
      function scan(text, q, from) {
        String(text).replace(/\\\//g, '/').replace(MEDIA, function (m) { add(m, q, from); return m; });
      }
      var html = await getHtml(page), doc = parse(html);
      scan(html, 0);

      // 1) watch pages (stream)
      var watch = [], dl = [];
      [].forEach.call(doc.querySelectorAll("a.link-show, a[href*='/watch/']"), function (a) {
        var h = abs(a.getAttribute('href'), page); if (h && watch.every(function (w) { return w.u !== h; })) watch.push({ u: h, q: qualityOf(a, doc) });
      });
      [].forEach.call(doc.querySelectorAll("a.link-download, a[href*='/download/'], a[href*='/link/']"), function (a) {
        var h = abs(a.getAttribute('href'), page); if (h && watch.every(function (w) { return w.u !== h; }) && dl.every(function (w) { return w.u !== h; })) dl.push({ u: h, q: qualityOf(a, doc) });
      });
      report.push('watch ' + watch.length + ', download ' + dl.length);

      for (var i = 0; i < watch.length && i < 6; i++) {
        try {
          var wh = await getHtml(watch[i].u, { referer: page }), wd = parse(wh), q = watch[i].q;
          [].forEach.call(wd.querySelectorAll('source[src], video[src]'), function (n) {
            var s = abs(n.getAttribute('src'), watch[i].u), nq = +(latin(n.getAttribute('size') || n.getAttribute('label') || n.getAttribute('title') || '').match(/\d{3,4}/) || [0])[0];
            add(s, nq || q, watch[i].u);
          });
          scan(wh, q, watch[i].u);
          [].forEach.call(wd.querySelectorAll('iframe[src],iframe[data-src]'), function (f) {
            var fu = abs(f.getAttribute('src') || f.getAttribute('data-src'), watch[i].u);
            if (fu && !/youtube|youtu\.be/i.test(fu)) dl.push({ u: fu, q: q, ref: watch[i].u });
          });
        } catch (e) { report.push('watch ' + i + ': ' + (e && e.message)); }
      }

      // 2) download pages -> direct mp4 (often through downet.net)
      var seenD = {};
      async function follow(entry, depth) {
        if (!entry.u || seenD[entry.u] || depth > 2 || found.length >= 8) return;
        seenD[entry.u] = 1;
        if (isMedia(entry.u)) { add(entry.u, entry.q, page); return; }
        var h;
        try { h = await getHtml(entry.u, { referer: entry.ref || page }); } catch (e) { report.push(host(entry.u) + ' ' + (e && e.message)); return; }
        var d = parse(h), q = entry.q || 0, next = [];
        scan(h, q, entry.u);
        [].forEach.call(d.querySelectorAll("a[href*='downet.net'], a[href*='.mp4'], a.link-btn, a.link, a[download]"), function (a) {
          var u = abs(a.getAttribute('href'), entry.u); if (!u) return;
          if (isMedia(u)) add(u, q || qualityOf(a, d), entry.u); else next.push({ u: u, q: q || qualityOf(a, d), ref: entry.u });
        });
        [].forEach.call(d.querySelectorAll("a[href*='/download/']"), function (a) {
          var u = abs(a.getAttribute('href'), entry.u); if (u && host(u) === host(base)) next.push({ u: u, q: q, ref: entry.u });
        });
        for (var j = 0; j < next.length && j < 4; j++) await follow(next[j], depth + 1);
      }
      for (var k = 0; k < dl.length && k < 6 && found.length < 6; k++) await follow(dl[k], 0);

      if (!found.length) throw new Error('No video link. ' + report.join(' ; ') + ' | page ' + page.slice(-40) + ' ' + html.length + ' chars');
      found.sort(function (a, b) { return b.q - a.q; });
      return found.map(function (f, n) {
        return { url: f.url, label: (f.q ? f.q + 'p' : 'Server ' + (n + 1)) + ' \u00B7 ' + host(f.url).split('.').slice(-2).join('.'), referer: f.ref, relay: false };
      });
    }
  });
})();
