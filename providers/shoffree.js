// Shoffree provider for MediaHub.
// Draft: listing / search / seasons / episodes were written from the site's real pages,
// but the video player loads by JavaScript, so getLinks is a detector. If it fails, the error text
// says what each step found - send it back to refine.
(function () {
  'use strict';

  var DEFAULT_BASE = 'https://shoffree.cc';
  var MEDIA = /https?:\\?\/\\?\/[^"'\s<>\\]+?\.(?:m3u8|mp4|mpd)(?:\?[^"'\s<>\\]*)?/gi;
  var NOTMEDIA = /\.(jpe?g|png|gif|webp|svg|css|js|ico|vtt|srt|woff2?|ttf)(\?|$)/i;
  var FILEKEY = /(?:file|src|source|hls|stream|video_url|url)["']?\s*[:=]\s*["'](https?:\\?\/\\?\/[^"'\s<>]+)/gi;
  var FILEHOSTS = /rapidgator|nitroflare|1fichier|mdiaload|bowfile|updown|koramaup|1cloudfile|mega\.nz|drive\.google|youtube|youtu\.be|facebook|twitter|instagram|google|gstatic|cloudflare|schema\.org|w3\.org|tmdb|themoviedb/i;
  var TITLE = /\/(movie|serie)\/([^\/?#]+)/i;

  function baseOf(cfg) {
    var u = String((cfg && cfg.url) || '').trim() || DEFAULT_BASE;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try { return new URL(u).origin; } catch (e) { throw new Error('Site address is not valid: ' + u); }
  }
  function abs(u, base) { try { return new URL(String(u || '').replace(/&amp;/g, '&'), base).href; } catch (e) { return ''; } }
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function parse(h) { return new DOMParser().parseFromString(h, 'text/html'); }
  function getHtml(u, o) { return MediaHub.getText(u, o); }
  function metaOf(d, p) { var m = d.querySelector('meta[property="' + p + '"],meta[name="' + p + '"]'); return m ? m.getAttribute('content') : ''; }
  function unent(t) { return String(t).replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
  function diag(html, url) {
    var t = (html.match(/<title[^>]*>([^<]*)/i) || [])[1] || '';
    var cf = /just a moment|cf-browser-verification|challenge-platform/i.test(html) ? ' [Cloudflare check]' : '';
    return 'No items found at ' + url + ' - page title: "' + clean(t).slice(0, 60) + '", ' + html.length + ' chars' + cf;
  }

  // ---------- titles ----------
  function tidy(t) {
    t = clean(t).replace(/^(?:مشاهدة وتحميل|مشاهدة|تحميل)\s+/, '').replace(/^(?:فيلم|مسلسل|انمي|أنمي)\s+/, '')
      .replace(/\s+مترجم.*$/, '').replace(/\s+(?:الموسم\s+\S+)$/, '');
    return clean(t);
  }
  function seasonOfUrl(u) { var m = String(u).match(/-s(\d+)-\d{4}(?:[\/?#-]|$)/i); return m ? m[1] : ''; }
  function baseSlug(slug) { return slug.replace(/-s\d+-\d{4}$/i, ''); }

  function imgOf(n, base) {
    var img = n.querySelector('img'), u = '';
    if (img) u = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('src') || '';
    if (!u || /^data:/.test(u)) {
      var st = (n.querySelector('[style*="url("]') || n).getAttribute('style') || '', m = st.match(/url\(["']?([^"')]+)/);
      if (m) u = m[1];
    }
    return u && !/^data:/.test(u) ? abs(u, base) : '';
  }

  // cards grouped under the heading that precedes them
  function cards(doc, base) {
    var groups = [], cur = { title: 'Latest', items: [] }, seen = {};
    groups.push(cur);
    [].forEach.call(doc.body.querySelectorAll('h1,h2,a[href]'), function (n) {
      if (n.tagName === 'H1' || n.tagName === 'H2') {
        if (n.closest && n.closest('a')) return;
        var t = clean(n.textContent).replace(/\s*(?:الكل|عربي|اليوم|مسلسلات|أفلام).*$/, '');
        if (t && t.length < 60) { if (cur.items.length) { cur = { title: t, items: [] }; groups.push(cur); } else cur.title = t; }
        return;
      }
      var href = abs(n.getAttribute('href'), base), m = href.match(TITLE);
      if (!m || host(href) !== host(base) || seen[href]) return;
      var img = n.querySelector('img');
      var h = n.querySelector('h3,h4,h2,.title');
      var title = tidy((h && h.textContent) || (img && img.getAttribute('alt')) || n.getAttribute('title') || n.textContent);
      if (!title || title.length > 120) return;
      var s = m[1] === 'serie' ? seasonOfUrl(href) : '';
      if (s && !/season|الموسم/i.test(title)) title += ' \u00B7 S' + s;
      seen[href] = 1;
      cur.items.push({ id: href, url: href, title: title, poster: imgOf(n, base) });
    });
    return groups.filter(function (g) { return g.items.length; });
  }
  function flat(html, base) { var out = []; cards(parse(html), base).forEach(function (g) { out = out.concat(g.items); }); return out; }

  // ---------- series ----------
  function epNo(u) { var m = String(u).match(/-episode-(\d+)(?:[\/?#]|$)/i); return m ? +m[1] : 0; }
  function episodesOf(doc, url, base) {
    var out = [], seen = {};
    [].forEach.call(doc.querySelectorAll('a[href*="/watch/"]'), function (a) {
      var href = abs(a.getAttribute('href'), base), n = epNo(href);
      if (!href || !n || seen[href]) return;
      seen[href] = 1;
      out.push({ id: href, url: href, title: '\u0627\u0644\u062D\u0644\u0642\u0629 ' + n, n: n });
    });
    out.sort(function (a, b) { return a.n - b.n; });
    return out;
  }
  function seasonLinks(doc, url, base) {
    var slug = (url.match(TITLE) || [])[2] || '', bs = baseSlug(slug), out = [], seen = {};
    [].forEach.call(doc.querySelectorAll('a[href*="/serie/"]'), function (a) {
      var href = abs(a.getAttribute('href'), base), m = href.match(TITLE);
      if (!m || baseSlug(m[2]) !== bs) return;
      var k = seasonOfUrl(href); if (!k || seen[k]) return;
      seen[k] = 1; out.push({ k: k, label: 'Season ' + k, url: href });
    });
    return out.sort(function (a, b) { return +a.k - +b.k; });
  }

  // ---------- link hunting ----------
  function toBase(c, a) { return (c < a ? '' : toBase(parseInt(c / a, 10), a)) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36)); }
  function unpackAll(text) {
    var out = '', re = /\}\('((?:[^'\\]|\\.)*)',\s*(\d+),\s*(\d+),\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/g, m;
    while ((m = re.exec(text))) {
      try {
        var pk = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'), a = +m[2], c = +m[3], k = m[4].split('|'), d = {};
        while (c--) d[toBase(c, a)] = k[c] || toBase(c, a);
        out += '\n' + pk.replace(/\b\w+\b/g, function (w) { return d[w] || w; });
      } catch (e) {}
    }
    return out;
  }
  function decodeB64(text) {
    var out = '', re = /atob\(\s*["']([A-Za-z0-9+\/=]{40,})["']\s*\)/g, m;
    while ((m = re.exec(text))) { try { out += '\n' + atob(m[1]); } catch (e) {} }
    return out;
  }
  function jsonUrls(o, out, depth) {
    if (depth > 6 || out.length > 60) return out;
    if (typeof o === 'string') { if (/^(https?:)?\/\//.test(o)) out.push(o.indexOf('//') === 0 ? 'https:' + o : o); }
    else if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { jsonUrls(o[k], out, depth + 1); });
    return out;
  }
  function peek(txt) {
    var out = [], re = /(m3u8|\.mp4|sources?\s*[:=]|fetch\(|\$\.ajax|\$\.post|axios|XMLHttpRequest|\/api\/|iframe)/ig, m, last = -999;
    while ((m = re.exec(txt)) && out.length < 4) {
      if (m.index - last < 200) continue; last = m.index;
      out.push(clean(txt.slice(Math.max(0, m.index - 30), m.index + 110)));
    }
    return out.join(' // ') || 'no keywords';
  }

  MediaHub.registerProvider({
    id: 'shoffree',
    name: 'Shoffree',
    fields: [{ key: 'url', label: 'Site address (current Shoffree domain)', placeholder: DEFAULT_BASE }],

    getHome: async function (cfg) {
      var base = baseOf(cfg), html = await getHtml(base + '/explore'), g = cards(parse(html), base);
      if (!g.length) throw new Error(diag(html, base + '/explore'));
      g = g.filter(function (x) { return !/^الحلقات|أحدث الحلقات/.test(x.title); });
      return g.slice(0, 12);
    },

    search: async function (cfg, q) {
      var base = baseOf(cfg), enc = encodeURIComponent(q), urls = [], tried = [], last = '';
      try {                                      // the site's own search form, when the home page has one
        var forms = parse(await getHtml(base + '/explore')).querySelectorAll('form');
        for (var i = 0; i < forms.length; i++) {
          var inp = forms[i].querySelector('input[type="search"],input[type="text"],input[name]:not([type="hidden"])');
          if (!inp || !inp.getAttribute('name')) continue;
          var act = abs(forms[i].getAttribute('action') || base + '/search', base + '/');
          urls.push(act + (act.indexOf('?') < 0 ? '?' : '&') + inp.getAttribute('name') + '=' + enc); break;
        }
      } catch (e) {}
      urls.push(base + '/search?q=' + enc, base + '/search?query=' + enc, base + '/search?s=' + enc, base + '/search/' + enc, base + '/?s=' + enc);
      for (var u = 0; u < urls.length; u++) {
        if (tried.indexOf(urls[u]) >= 0) continue; tried.push(urls[u]);
        try {
          var h = await getHtml(urls[u]), out = flat(h, base);
          if (out.length) return out;
          last = 'no results at ' + urls[u].replace(base, '');
        } catch (e) { last = (e && e.message) + ' ' + urls[u].replace(base, '').slice(0, 30); }
      }
      throw new Error('Search found nothing (' + tried.length + ' addresses tried; last: ' + last + ')');
    },

    load: async function (cfg, item) {
      var base = baseOf(cfg), url = item.url || item.id, doc = parse(await getHtml(url));
      var h1 = doc.querySelector('h1'), pageTitle = clean(h1 && h1.textContent) || tidy(metaOf(doc, 'og:title')) || item.title;
      var poster = metaOf(doc, 'og:image') || item.poster || '';
      var desc = clean(metaOf(doc, 'og:description') || metaOf(doc, 'description'));
      var isSerie = /\/serie\//i.test(url), genres = [], rows = [];
      [].forEach.call(doc.querySelectorAll('a[href*="/movies/"],a[href*="/series/"],a[href*="/anime/"]'), function (a) {
        var t = clean(a.getAttribute('title') || a.textContent), href = a.getAttribute('href') || '';
        if (t && t.length < 25 && /\/(movies|series|anime)\/[a-z-]+$/i.test(href) && !/^(الأفلام|المسلسلات|مسلسلات|أنمي)/.test(t) && genres.indexOf(t) < 0) genres.push(t);
      });
      var txt = clean(doc.body.textContent);
      [['الدولة', /الدولة\s+([^\s].{0,24}?)\s+اللغة/], ['اللغة', /اللغة\s+([^\s]\S*(?:\s\S+)?)/], ['المدة', /المدة:\s*([^ل]{3,14}?)(?:\s|$)/]].forEach(function (p) {
        var m = txt.match(p[1]); if (m && clean(m[1])) rows.push({ k: p[0], v: clean(m[1]) });
      });
      var info = { title: item.title || pageTitle, poster: poster, desc: desc, genres: genres.slice(0, 6), meta: rows };
      if (isSerie) {
        var eps = episodesOf(doc, url, base), seasons = seasonLinks(doc, url, base), cur = seasonOfUrl(url) || '1';
        eps.forEach(function (e) { e.season = cur; delete e.n; });
        if (!seasons.some(function (s) { return s.k === cur; })) seasons.push({ k: cur, label: 'Season ' + cur, url: url });
        seasons.sort(function (a, b) { return +a.k - +b.k; });
        info.series = tidy(pageTitle).replace(/\s*\(\d{4}\)\s*$/, '') || undefined;
        info.episodes = eps;
        info.seasons = seasons.length > 1 ? seasons : undefined;
        info.currentSeason = cur;
      }
      return info;
    },

    seasonEpisodes: async function (cfg, meta) {
      var base = baseOf(cfg), d = parse(await getHtml(meta.url)), eps = episodesOf(d, meta.url, base);
      if (!eps.length) throw new Error('no episodes in ' + meta.url.slice(-50));
      eps.forEach(function (e) { delete e.n; });
      return eps;
    },

    getLinks: async function (cfg, target) {
      var base = baseOf(cfg), page = target.url || target.id, report = [];
      page = page.replace('/movie/', '/watch/');       // movies: the details page -> its player page
      var direct = [], embeds = [], seenE = {}, labels = {};
      function addDirect(u, lab) { u = abs(String(u).replace(/\\\//g, '/'), page); if (u && !NOTMEDIA.test(u) && direct.indexOf(u) < 0) { direct.push(u); if (lab) labels[u] = lab; } }
      function addEmbed(u, from) {
        u = abs(u, from || page);
        if (/^https?:/i.test(u) && !FILEHOSTS.test(host(u)) && !NOTMEDIA.test(u) && !seenE[u] && host(u) !== host(base)) { seenE[u] = 1; embeds.push({ u: u, ref: from || page, d: 0 }); }
      }
      function scan(text, from) {
        text = unent(text);
        var all = text + unpackAll(text) + decodeB64(text);
        all.replace(/\\\//g, '/').replace(MEDIA, function (m) { addDirect(m); return m; });
        all.replace(FILEKEY, function (m0, u) {
          u = u.replace(/\\\//g, '/');
          if (/\.(m3u8|mp4|mpd)|\/hls\/|master|playlist/i.test(u)) addDirect(u); return m0;
        });
        return all;
      }
      var html = await getHtml(page), doc = parse(html);
      report.push('page ' + html.length);
      var all = scan(html);
      [].forEach.call(doc.querySelectorAll('iframe'), function (n) { addEmbed(n.getAttribute('src') || n.getAttribute('data-src'), page); });
      [].forEach.call(doc.querySelectorAll('[data-url],[data-embed],[data-src],[data-link],[data-server],[data-video],video source[src],video[src]'), function (n) {
        var u = n.getAttribute('data-url') || n.getAttribute('data-embed') || n.getAttribute('data-link') || n.getAttribute('data-video') || n.getAttribute('data-src') || n.getAttribute('src') || '';
        if (/^(https?:)?\/\//.test(u) || /^\//.test(u)) { if (/\.(m3u8|mp4|mpd)(\?|$)/i.test(u)) addDirect(abs(u, page)); else if (/^(https?:)?\/\//.test(u)) addEmbed(u, page); }
      });
      (all.replace(/\\\//g, '/').match(/https?:\/\/[^"'\s<>\\]+/g) || []).forEach(function (u) {
        if (/(embed|player|stream|dood|voe|mixdrop|uqload|vidmoly|filemoon|streamwish|upstream|ok\.ru\/videoembed|vk\.com\/video_ext)/i.test(u) && !NOTMEDIA.test(u)) addEmbed(u, page);
      });

      // API calls the player page makes (found in its scripts), plus the content id from the download link
      if (!direct.length) {
        var id = '', dm = html.match(/\/download\/(movie|episode|serie)\/(\d+)/i), kind = dm ? dm[1] : '';
        if (dm) id = dm[2];
        var cands = [], seenC = {};
        (all.match(/["'`](\/?(?:api|ajax|server|servers|player|embed|source|sources|stream|watch)\/[^"'`\s<>{}]{2,80})["'`]/gi) || []).forEach(function (s) {
          var p = s.slice(1, -1); if (/\.(js|css|png|jpe?g|svg)(\?|$)/i.test(p)) return;
          var u = abs(p.charAt(0) === '/' ? p : '/' + p, base); if (!seenC[u]) { seenC[u] = 1; cands.push(u); }
        });
        if (id) ['/api/servers/' + kind + '/' + id, '/api/' + kind + '/' + id + '/servers', '/ajax/servers/' + kind + '/' + id].forEach(function (p) {
          var u = base + p; if (!seenC[u]) { seenC[u] = 1; cands.push(u); }
        });
        report.push('id ' + (id || '-') + ', api candidates ' + cands.length);
        for (var c = 0; c < cands.length && c < 10 && !direct.length; c++) {
          try {
            var t = await getHtml(cands[c], { referer: page, headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' } });
            var js = null; try { js = JSON.parse(t); } catch (e) {}
            if (js) jsonUrls(js, [], 0).forEach(function (u) { if (/\.(m3u8|mp4|mpd)(\?|$)/i.test(u)) addDirect(u); else addEmbed(u, page); });
            scan(t);
            report.push('api ok ' + cands[c].replace(base, '').slice(0, 40) + ' ' + t.length);
          } catch (e) { report.push('api ' + cands[c].replace(base, '').slice(0, 30) + ' ' + (e && e.message ? e.message.slice(0, 18) : '')); }
        }
      }

      // open the embeds (and the iframes inside them)
      var fetched = 0;
      while (embeds.length && fetched < 8 && direct.length < 3) {
        var q = embeds.shift(); fetched++;
        var txt;
        try { txt = await getHtml(q.u, { referer: q.ref }); }
        catch (e1) { try { txt = await getHtml(q.u, { referrerPolicy: 'no-referrer' }); } catch (e2) { report.push(host(q.u) + ' ' + (e1 && e1.message ? e1.message.slice(0, 30) : '')); continue; } }
        report.push(host(q.u) + ' ' + txt.length);
        var before = direct.length;
        scan(txt, q.u);
        for (var di = before; di < direct.length; di++) labels[direct[di]] = host(q.u);
        if (!direct.length && q.d < 2) {
          [].forEach.call(parse(txt).querySelectorAll('iframe[src],iframe[data-src]'), function (n) {
            var u2 = abs(n.getAttribute('src') || n.getAttribute('data-src'), q.u);
            if (/^https?:/i.test(u2) && !FILEHOSTS.test(host(u2)) && !seenE[u2]) { seenE[u2] = 1; embeds.push({ u: u2, ref: q.u, d: q.d + 1 }); }
          });
        }
        if (!direct.length && fetched === 1) report.push('peek ' + peek(txt).slice(0, 260));
      }

      if (!direct.length) throw new Error('No video link. ' + report.join(' ; ') + ' | page peek: ' + peek(html).slice(0, 320));
      return direct.map(function (u, n) {
        return { url: u, label: (labels[u] || 'Server ' + (n + 1)) + ' \u00B7 ' + host(u).split('.').slice(-2).join('.'), referer: page, relay: false };
      });
    }
  });
})();
