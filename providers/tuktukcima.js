// Tuktukcima provider for MediaHub.
// Draft: written without seeing the live site, so it detects cards/episodes/servers generically.
// If something does not load, the error message shows what the page returned - send it back to refine.
(function () {
  'use strict';

  var MEDIA = /https?:\\?\/\\?\/[^"'\s<>\\]+?\.(?:m3u8|mp4|mpd)(?:\?[^"'\s<>\\]*)?/gi;
  var SKIP = /\/(category|tag|genre|page|author|wp-content|wp-json|feed|login|register|contact|dmca|privacy)(\/|$)/i;

  function baseOf(cfg) {
    var u = String((cfg && cfg.url) || '').trim();
    if (!u) throw new Error('Site address is empty');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u.replace(/\/+$/, '');
  }
  function abs(u, base) { try { return new URL(u, base).href; } catch (e) { return ''; } }
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

  async function getHtml(url) { return MediaHub.getText(url); }
  // Fetch from the TV itself first (stream links are often tied to the requester's network); fall back to the relay.
  async function smartText(url, opt) {
    opt = opt || {};
    try { return { t: await MediaHub.getText(url, Object.assign({}, opt, { direct: true })), relay: false }; }
    catch (e1) { return { t: await MediaHub.getText(url, opt), relay: !!MediaHub.proxy }; }
  }
  function parse(html) { return new DOMParser().parseFromString(html, 'text/html'); }
  function diag(html, url) {
    var t = (html.match(/<title[^>]*>([^<]*)/i) || [])[1] || '';
    var cf = /just a moment|cf-browser-verification|challenge-platform/i.test(html) ? ' [Cloudflare check]' : '';
    return 'No items found at ' + url + ' - page title: "' + clean(t).slice(0, 60) + '", ' + html.length + ' chars' + cf;
  }

  function poster(a, base) {
    var img = a.querySelector('img') || (a.parentElement && a.parentElement.querySelector('img'));
    var u = '';
    if (img) u = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || img.getAttribute('src') || '';
    if (!u || /^data:/.test(u)) {
      var el = a, i = 0;
      while (el && i < 3) {
        var st = el.getAttribute && el.getAttribute('style') || '', m = st.match(/url\(["']?([^"')]+)/);
        if (m) { u = m[1]; break; }
        el = el.querySelector && el.querySelector('[style*="url("]') || null; i++;
      }
    }
    return u && !/^data:/.test(u) ? abs(u, base) : '';
  }
  function titleOf(a) {
    var h = a.querySelector('h1,h2,h3,h4,h5,.title,.Title') || (a.parentElement && a.parentElement.querySelector('h1,h2,h3,h4,h5'));
    var img = a.querySelector('img');
    return clean(a.getAttribute('title') || (h && h.textContent) || (img && img.getAttribute('alt')) || a.textContent);
  }

  // Cards grouped under the heading that precedes them.
  // a link counts as a title card when it (or a small wrapper around it) holds a picture
  function hasPic(n) {
    if (n.querySelector('img')) return true;
    var p = n.parentElement, i = 0;
    while (p && i < 3) {
      if (p.querySelectorAll('a[href]').length <= 4 && p.querySelector('img') && clean(n.textContent).length > 1) return true;
      p = p.parentElement; i++;
    }
    return false;
  }
  function cards(doc, base) {
    var groups = [], cur = { title: 'Latest', items: [] }, seen = {}, h0 = host(base);
    groups.push(cur);
    [].forEach.call(doc.body.querySelectorAll('h1,h2,h3,a[href]'), function (n) {
      if (/^H\d$/.test(n.tagName)) {
        if (n.closest && n.closest('a')) return;
        var t = clean(n.textContent);
        if (t && t.length < 50 && cur.items.length) { cur = { title: t, items: [] }; groups.push(cur); }
        else if (t && t.length < 50) cur.title = t;
        return;
      }
      var href = abs(n.getAttribute('href'), base);
      if (!href || host(href) !== h0 || SKIP.test(href) || href.charAt(href.length - 1) === '#') return;
      if (!hasPic(n)) return;
      var title = titleOf(n);
      if (!title || title.length > 140 || seen[href]) return;
      seen[href] = 1;
      cur.items.push({ id: href, url: href, title: title, poster: poster(n, base) });
    });
    return groups.filter(function (g) { return g.items.length; });
  }


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
  var FILEKEY = /(?:file|src|source|hls|stream|video_url|url)["']?\s*[:=]\s*["'](https?:\\?\/\\?\/[^"'\s<>]+)/gi;
  var NOTMEDIA = /\.(jpe?g|png|gif|webp|svg|css|js|ico|vtt|srt|json|woff2?|ttf)(\?|$)/i;


  // Embed links end with a token = reversed base64 of the real player URL (with some junk around it).
  function decodeToken(u) {
    try {
      var seg = String(u).split('?')[0].replace(/\/+$/, '').split('/').pop();
      if (!seg || seg.length < 24) return '';
      var r = seg.split('').reverse().join(''), i = r.search(/aHR0c(Dov|HM6)/);
      if (i < 0) return '';
      var b = (r.slice(i).match(/^[A-Za-z0-9+\/_-]*/) || [''])[0].replace(/-/g, '+').replace(/_/g, '/');
      for (; b.length >= 16; b = b.slice(0, -1)) {
        if (b.length % 4 === 1) continue;
        try {
          var m = atob(b + '==='.slice(0, (4 - b.length % 4) % 4)).match(/^https?:\/\/[\x21-\x7e]+/);
          if (m) return m[0];
        } catch (e) {}
      }
    } catch (e) {}
    return '';
  }


  // Strings in player scripts that hide a URL (plain or reversed base64).
  function encodedUrls(text) {
    var out = [], re = /["'`]([A-Za-z0-9+\/_=-]{32,})["'`]/g, m;
    while ((m = re.exec(text)) && out.length < 12) {
      var str = m[1], u = decodeToken('x/' + str);
      if (!u && /^aHR0c/.test(str)) {
        try { var d = atob(str.replace(/-/g, '+').replace(/_/g, '/')), mm = d.match(/^https?:\/\/[\x21-\x7e]+/); u = mm ? mm[0] : ''; } catch (e) {}
      }
      if (u && out.indexOf(u) < 0) out.push(u);
    }
    return out;
  }
  // Short look at how a player page loads its video (shown in the error to guide the next fix).
  function peek(txt) {
    var out = [], re = /(m3u8|\.mp4|sources?\s*[:=]|file\s*[:=]|fetch\(|\$\.ajax|\$\.post|XMLHttpRequest|\/api\/|eval\()/ig, m, last = -999;
    while ((m = re.exec(txt)) && out.length < 3) {
      if (m.index - last < 200) continue; last = m.index;
      out.push(clean(txt.slice(Math.max(0, m.index - 30), m.index + 100)));
    }
    var js = (txt.match(/<script[^>]+src=["'][^"']+/gi) || []).slice(0, 3).map(function (x) { return x.replace(/^.*src=["']/i, '').slice(-45); });
    return 'peek: ' + (out.join(' // ') || 'no keywords') + (js.length ? ' | js: ' + js.join(', ') : '');
  }


  function unent(t) { return String(t).replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
  // Inertia/Vue style pages keep their data in a data-page="{...}" attribute.
  function pageData(txt) {
    var m = String(txt).match(/<script[^>]*data-page[^>]*>([\s\S]*?)<\/script>/i);
    if (m) { try { return JSON.parse(m[1]); } catch (e) {} }
    m = String(txt).match(/data-page=(["'])([\s\S]*?)\1\s*[>\s]/);
    if (m) { try { return JSON.parse(unent(m[2])); } catch (e) {} }
    return null;
  }
  function leaves(o, pre, out, depth) {
    if (depth > 5 || out.length > 200) return out;
    if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { leaves(o[k], k, out, depth + 1); });
    else if (o !== null && o !== undefined) out.push({ k: pre, v: String(o) });
    return out;
  }
  function keyPaths(o, pre, depth, out) {
    if (!o || typeof o !== 'object' || depth > 4 || out.length > 40) return out;
    Object.keys(o).slice(0, 14).forEach(function (k) {
      var v = o[k], pth = pre ? pre + '.' + k : k;
      if (v && typeof v === 'object') keyPaths(v, pth, depth + 1, out);
      else out.push(pth + '=' + String(v).slice(0, 26));
    });
    return out;
  }
  function apiHints(js) {
    var out = [], seen = {}, re = /["'`]((?:\/?api\/|\/?stream|\/?video|\/?source|\/?player|\/?hls|\/?playlist|\/?embed)[^"'`\s]{0,50})["'`]/gi, m;
    while ((m = re.exec(js)) && out.length < 8) { if (!seen[m[1]]) { seen[m[1]] = 1; out.push(m[1]); } }
    return out;
  }


  // ---------- series helpers ----------
  var ORD = { 'الاولى': 1, 'الأولى': 1, 'الثانية': 2, 'الثالثة': 3, 'الرابعة': 4, 'الخامسة': 5, 'السادسة': 6, 'السابعة': 7, 'الثامنة': 8, 'التاسعة': 9, 'العاشرة': 10 };
  function dec(u) { try { return decodeURIComponent(u); } catch (e) { return u; } }
  function latin(d) { return String(d).replace(/[\u0660-\u0669]/g, function (c) { return c.charCodeAt(0) - 0x660; }); }
  function epNum(t) {
    t = latin(t);
    var m = t.match(/(?:الحلقة|حلقة|episode|\bep)[\s\-_.:]*0*(\d+)/i); if (m) return +m[1];
    for (var k in ORD) if (t.indexOf(k) >= 0) return ORD[k];
    return 0;
  }
  function seasonOf(t) { var m = latin(t).match(/(?:الموسم|موسم|season|\bs)[\s\-_]*0*(\d+)/i); return m ? m[1] : undefined; }
  function metaOf(d, pr) { var m = d.querySelector('meta[property="' + pr + '"],meta[name="' + pr + '"]'); return m ? m.getAttribute('content') : ''; }
  function h1Of(d) { var h = d.querySelector('h1'); return clean(h && h.textContent) || clean(metaOf(d, 'og:title')); }

  // episode links on a page
  function extractEps(d, u, h0) {
    var out = [], words = slugOf(u).slice(0, 2);
    [].forEach.call(d.querySelectorAll('a[href]'), function (a) {
      var href = abs(a.getAttribute('href'), u), t = clean(a.textContent);
      if (!href || href === u || host(href) !== h0) return;
      var dh = dec(href).toLowerCase();
      if (words.length && !words.every(function (w) { return dh.indexOf(w) >= 0; }) && !/^(الحلقة|حلقة|episode)\s*[\d\u0660-\u0669]+/i.test(t)) return;
      if (/episode|الحلقة|حلقة|s\d+e\d+|[-_/]ep-?\d+/i.test(dh) || /(?:الحلقة|حلقة|episode)\s*[\d\u0660-\u0669]+/i.test(t)) out.push({ href: href, t: t });
    });
    return out;
  }
  function nextLink(d, u, h0) {
    var a = d.querySelector('link[rel="next"],a[rel="next"],a.next,a.page-numbers.next,.pagination a.next');
    var h = a ? abs(a.getAttribute('href'), u) : '';
    return h && h !== u && host(h) === h0 ? h : '';
  }
  // all episodes of a series/season page, following "next page" links
  async function collectEps(url, h0, first) {
    var res = [], u = url, d = first || parse(await getHtml(url)), pages = 0, seen = {};
    for (;;) {
      extractEps(d, u, h0).forEach(function (e) { if (!seen[e.href]) { seen[e.href] = 1; res.push(e); } });
      var nx = nextLink(d, u, h0);
      if (!nx || pages++ >= 6) break;
      u = nx; d = parse(await getHtml(nx));
    }
    return { eps: res, doc: first || null };
  }
  // words that identify the series in a URL (so another show's season links are not mixed in)
  function slugOf(u) {
    var seg = ''; try { seg = dec(new URL(u).pathname.split('/').filter(Boolean)[0] || ''); } catch (e) {}
    seg = latin(seg).toLowerCase().replace(/(?:-?s\d+e?\d*|-?season[-_]?\d+|-?episode[-_]?\d+|-?الموسم[-_]?\d+|-?الحلقة[-_]?\d+|-?\d+)(?=-|$)/g, '');
    return seg.split('-').filter(function (w) { return w.length > 1 && !/^(مسلسل|فيلم|انمي|أنمي|مترجم|series|movie|anime)$/.test(w); }).slice(0, 3);
  }
  // season picker (select / dropdown / season links); any = scan every link on the page
  function seasonList(d, u, h0, any) {
    var out = [], seen = {}, words = slugOf(u);
    function push(href, text) {
      href = abs(href, u); if (!href || host(href) !== h0) return;
      var dh = dec(href).toLowerCase();
      if (any && words.length && !words.slice(0, 2).every(function (w) { return dh.indexOf(w) >= 0; })) return;
      var k = seasonOf(dec(clean(text)) + ' ' + dec(href)); if (!k || seen[k]) return;
      if (/episode|الحلقة|حلقة/i.test(dh)) return;
      seen[k] = 1; out.push({ k: k, label: 'Season ' + k, url: href });
    }
    [].forEach.call(d.querySelectorAll('select option'), function (o) { push(o.getAttribute('value') || o.getAttribute('data-url') || o.getAttribute('data-href') || '', o.textContent); });
    [].forEach.call(d.querySelectorAll('[class*="season"] a[href],[id*="season"] a[href],[class*="Season"] a[href],.dropdown a[href],.dropdown-menu a[href],[class*="dropdown"] a[href],[role="listbox"] a[href],[role="menu"] a[href]'), function (a) { push(a.getAttribute('href'), a.textContent); });
    [].forEach.call(d.querySelectorAll('[data-url],[data-href]'), function (n) { push(n.getAttribute('data-url') || n.getAttribute('data-href'), n.textContent); });
    if (any) [].forEach.call(d.querySelectorAll('a[href]'), function (a) { push(a.getAttribute('href'), a.textContent); });
    return out.sort(function (a, b) { return +a.k - +b.k; });
  }
  // category chips (e.g. drama)
  function genresOf(d) {
    var genres = [];
    [].forEach.call(d.querySelectorAll('a[href*="/genre/"],a[href*="/genres/"],a[href*="/category/"],a[href*="/cat/"]'), function (a) {
      var t = clean(a.textContent); if (t && t.length < 30 && genres.indexOf(t) < 0 && !/^(الرئيسية|home)$/i.test(t)) genres.push(t);
    });
    return genres.slice(0, 8);
  }
  // "Label: value" rows -> [{k, v}]
  function metaRows(d) {
    var out = [], seenK = {}, lab = 'موعد الصدور|التصنيف|النوع|الانتاج|الإنتاج|سنة الإنتاج|سنة|بلد|الدولة|دولة المسلسل|دولة الفيلم|دولة|اللغة|لغة المسلسل|لغة الفيلم|لغة|المدة|مدة|التقييم|تقييم|جودة المسلسل|جودة الفيلم|جودة|العمر|المؤلفين|المؤلف|بطولة|الممثلين|المخرج|اخراج|إخراج|genres?|year|country|language|duration|runtime|rating|quality|age|cast|director|writers?';
    var re = new RegExp('^(?:' + lab + ')', 'i'), reAll = new RegExp('(?:^|\\s)(?:' + lab + ')\\s*[:：]', 'ig'), done = [];
    [].forEach.call(d.querySelectorAll('li,div,p,span'), function (n) {
      var t = clean(n.textContent);
      if (t.length < 6 || t.length > 220 || !re.test(t)) return;
      var hits = t.match(reAll); if (!hits || hits.length !== 1) return;          // one label per row
      var m = t.match(re), k = m[0].trim(), v = t.slice(m[0].length).replace(/^[\s:：\-]+/, '').trim();
      if (v.length < 1 || seenK[k]) return;
      seenK[k] = 1; out.push({ k: k, v: v });
    });
    return out.slice(0, 10);
  }
  // "مسلسل Grey's Anatomy الموسم 23 الحلقة 3" -> "Grey's Anatomy"
  function cleanSeries(t) {
    return clean(String(t).replace(/^\s*(?:مسلسل|فيلم|انمي|أنمي|برنامج)\s+/i, '').replace(/\s*(?:الموسم|موسم|season)\s*[\d\u0660-\u0669]+.*$/i, '').replace(/\s*(?:الحلقة|حلقة|episode)\s*\S+.*$/i, '').replace(/\s*مترجم[ةه]?\s*$/i, ''));
  }
  // quick health check of a stream address, as the TV itself would open it
  async function verifyLink(u) {
    try {
      var t = await MediaHub.getText(u, { direct: true });
      if (t.indexOf('#EXTM3U') !== 0) return !/\.m3u8/i.test(u);
      function firstUri(txt) { return (txt.split(/\r?\n/).filter(function (x) { return x && x.charAt(0) !== '#'; })[0]) || ''; }
      var first = firstUri(t); if (!first) return false;
      var nu = abs(first, u);
      if (/\.m3u8/i.test(nu)) { t = await MediaHub.getText(nu, { direct: true }); first = firstUri(t); if (!first) return false; nu = abs(first, nu); }
      await MediaHub.getText(nu, { direct: true, headers: { Range: 'bytes=0-1023' } });
      return true;
    } catch (e) { return false; }
  }
  function searchCards(html, base) { var out = []; cards(parse(html), base).forEach(function (x) { out = out.concat(x.items); }); return out; }

  MediaHub.registerProvider({
    id: 'tuktukcima',
    name: 'Tuktukcima',
    fields: [{ key: 'url', label: 'Site address (current Tuktukcima domain)', placeholder: 'https://tuktukcima.com' }],

    getHome: async function (cfg) {
      var base = baseOf(cfg), html = await getHtml(base + '/');
      var g = cards(parse(html), base);
      if (!g.length) throw new Error(diag(html, base + '/'));
      return g.slice(0, 15);
    },

    search: async function (cfg, q) {
      var base = baseOf(cfg), tried = [], enc = encodeURIComponent(q), urls = [];
      try {                                    // use the site's own search form when it has one
        var hd = parse(await getHtml(base + '/')), forms = hd.querySelectorAll('form');
        for (var fi = 0; fi < forms.length; fi++) {
          var f = forms[fi], ins = f.querySelectorAll('input[name]'), nm = '', extra = [];
          for (var ii = 0; ii < ins.length; ii++) {
            var n = ins[ii].getAttribute('name'), ty = (ins[ii].getAttribute('type') || 'text').toLowerCase(), ph = ins[ii].getAttribute('placeholder') || '';
            if (ty === 'hidden') extra.push(n + '=' + encodeURIComponent(ins[ii].getAttribute('value') || ''));
            else if (!nm && (ty === 'search' || ty === 'text') && (/^(s|q|search|query|keyword|word|k|text|term)$/i.test(n) || /بحث|search/i.test(ph))) nm = n;
          }
          if (!nm) continue;
          var act = abs(f.getAttribute('action') || base + '/', base + '/');
          urls.push(act + (act.indexOf('?') < 0 ? '?' : '&') + [nm + '=' + enc].concat(extra).join('&'));
          break;
        }
      } catch (e) {}
      urls.push(base + '/?s=' + enc, base + '/search/' + enc, base + '/search?q=' + enc, base + '/?search=' + enc, base + '/search/?q=' + enc, base + '/?q=' + enc);
      var last = '';
      for (var ui = 0; ui < urls.length; ui++) {
        if (tried.indexOf(urls[ui]) >= 0) continue; tried.push(urls[ui]);
        try {
          var html = await getHtml(urls[ui]), out = searchCards(html, base);
          if (out.length) {
            var seenS = {}, dS = parse(html), uS = urls[ui], h0S = host(base), more = 0;
            out.forEach(function (x) { seenS[x.id] = 1; });
            while (more++ < 3) {
              var nxS = nextLink(dS, uS, h0S);
              if (!nxS && urls[ui].indexOf('?s=') > 0) nxS = base + '/page/' + (more + 1) + '/?s=' + enc;   // WordPress style
              if (!nxS || nxS === uS) break;
              try {
                var h2 = await getHtml(nxS), extra = searchCards(h2, base), added = 0;
                extra.forEach(function (x) { if (!seenS[x.id]) { seenS[x.id] = 1; out.push(x); added++; } });
                if (!added) break;
                dS = parse(h2); uS = nxS;
              } catch (e) { break; }
            }
            return out;
          }
          last = 'no results at ' + urls[ui].replace(base, '');
        } catch (e) { last = (e && e.message) + ' ' + urls[ui].replace(base, '').slice(0, 30); }
      }
      throw new Error('Search found nothing (' + tried.length + ' addresses tried; last: ' + last + ')');
    },

    load: async function (cfg, item) {
      var base = baseOf(cfg), url = item.url || item.id, h0 = host(base), doc = parse(await getHtml(url));
      var pageTitle = h1Of(doc), poster = item.poster || metaOf(doc, 'og:image');
      var desc = clean(metaOf(doc, 'og:description') || metaOf(doc, 'description')), rows = metaRows(doc);
      var isEp = /الحلقة|حلقة|episode/i.test(dec(url) + ' ' + pageTitle);
      var seasons = seasonList(doc, url, h0), cur = seasonOf(dec(url) + ' ' + pageTitle + ' ' + (item.title || ''));
      var seenE = {}, list = [];
      function addAll(ex) { ex.forEach(function (e) { if (seenE[e.href]) return; seenE[e.href] = 1; list.push({ id: e.href, url: e.href, title: e.t || 'Episode ' + (list.length + 1), n: epNum(dec(e.href) + ' ' + e.t) }); }); }
      var got = await collectEps(url, h0, doc);
      addAll(got.eps);
      if (isEp && !seenE[url]) { seenE[url] = 1; list.push({ id: url, url: url, title: pageTitle || item.title, n: epNum(dec(url) + ' ' + pageTitle) }); }
      // breadcrumb: Home > category > series > season ... (the last items are this show's pages)
      var crumbs = [];
      [].forEach.call(doc.querySelectorAll('[class*="breadcrumb"] a[href],[itemtype*="Breadcrumb"] a[href]'), function (a) {
        var href = abs(a.getAttribute('href'), url), pth = ''; try { pth = new URL(href).pathname; } catch (e) {}
        if (href && href !== url && host(href) === h0 && pth.length > 2 && !/\/(category|genre|tag|page)\//i.test(pth) && !/episode|الحلقة|حلقة/i.test(dec(href))) crumbs.push({ href: href, t: clean(a.textContent) });
      });
      var seasonPage = '', seriesPage = '';
      crumbs.forEach(function (c) { if (seasonOf(dec(c.t) + ' ' + dec(c.href))) seasonPage = c.href; else if (/^مسلسل|^series|^anime|^أنمي/i.test(c.t)) seriesPage = c.href; });
      if (!seriesPage && crumbs.length) seriesPage = crumbs[crumbs.length - (seasonPage ? 2 : 1)] ? crumbs[crumbs.length - (seasonPage ? 2 : 1)].href : '';
      // the series page usually lists every season
      if (seasons.length < 2 && (seriesPage || seasonPage)) {
        try {
          var sp = seriesPage || seasonPage, sd = parse(await getHtml(sp)), sl = seasonList(sd, sp, h0, true);
          if (sl.length > seasons.length) seasons = sl;
          if (!rows.length) rows = metaRows(sd);
        } catch (e) {}
      }
      // an episode page only shows some episodes: take the full list from its season page
      if (isEp) {
        var par = seasonPage || (seasons.length ? '' : seriesPage);
        if (par) {
          try {
            var pd = parse(await getHtml(par)), pg = await collectEps(par, h0, pd);
            addAll(pg.eps);
            if (!rows.length) rows = metaRows(pd);
            var pdesc = clean(metaOf(pd, 'og:description') || metaOf(pd, 'description')); if (pdesc && pdesc.length > desc.length) desc = pdesc;
          } catch (e) { /* keep what this page listed */ }
        }
      }
      if (list.some(function (e) { return e.n > 0; })) {
        list = list.map(function (e, i) { e.k = i; return e; }).sort(function (a, b) { return (a.n - b.n) || (a.k - b.k); });
      }
      // tag the loaded episodes with the season they belong to
      if (!cur && seasons.length) { var same = seasons.filter(function (x) { return x.url === url; })[0]; cur = same ? same.k : seasons[seasons.length - 1].k; }
      list.forEach(function (e) {
        e.season = seasonOf(dec(e.url) + ' ' + e.title) || cur;
        if (e.n) e.title = 'الحلقة ' + e.n;
        delete e.n; delete e.k;
      });
      var seenN = {};
      list = list.filter(function (e) {
        var m = String(e.title).match(/^الحلقة (\d+)$/); if (!m) return true;
        var key = e.season + '-' + m[1]; if (seenN[key]) return false; seenN[key] = 1; return true;
      });
      var genres = genresOf(doc);
      return { title: item.title || pageTitle, series: (isEp || list.length) ? (cleanSeries(pageTitle || item.title) || undefined) : undefined,
        poster: poster, desc: desc, genres: genres, meta: rows, episodes: list, seasons: seasons.length > 1 ? seasons : undefined, currentSeason: cur };
    },

    // episodes of another season (loaded when the user picks it)
    seasonEpisodes: async function (cfg, meta) {
      var base = baseOf(cfg), h0 = host(base), got = await collectEps(meta.url, h0, null), out = [], seen = {};
      got.eps.forEach(function (e) { if (!seen[e.href]) { seen[e.href] = 1; out.push({ id: e.href, url: e.href, title: e.t || 'Episode', n: epNum(dec(e.href) + ' ' + e.t) }); } });
      out.sort(function (a, b) { return a.n - b.n; });
      out.forEach(function (e) { if (e.n) e.title = 'الحلقة ' + e.n; delete e.n; });
      if (!out.length) {
        var d2 = got.doc || parse(await getHtml(meta.url)), as = d2.querySelectorAll('a[href]'), smp = [];
        [].forEach.call(as, function (a) { var t = clean(a.textContent); if (t && t.length < 28 && smp.length < 6 && smp.indexOf(t) < 0) smp.push(t); });
        var pth = ''; try { pth = decodeURIComponent(new URL(meta.url).pathname).slice(0, 60); } catch (e) {}
        throw new Error('no episodes in ' + pth + ' (' + as.length + ' links; title: ' + h1Of(d2).slice(0, 40) + '; links: ' + smp.join(' / ') + ')');
      }
      return out;
    },

    getLinks: async function (cfg, target) {
      var base = baseOf(cfg), page = target.url || target.id, tried = [page], report = [];
      var tail = page.charAt(page.length - 1) === '/' ? '' : '/';
      tried.push(page + tail + 'watch/');
      var direct = [], embeds = [], posts = [], stats = { iframe: 0, nume: 0 }, hosts = {}, h0 = host(base);
      function scan(text) {
        String(text).replace(/\\\//g, '/').replace(MEDIA, function (m) { if (direct.indexOf(m) < 0) direct.push(m); return m; });
      }
      function addEmbed(u, from) {
        u = abs(String(u || '').replace(/&amp;/g, '&'), from);
        if (/^https?:/i.test(u) && !/youtube|youtu\.be/i.test(u) && !NOTMEDIA.test(u) && embeds.indexOf(u) < 0) embeds.push(u);
      }
      for (var i = 0; i < tried.length; i++) {
        var html;
        try { html = await getHtml(tried[i]); report.push(tried[i].slice(-14) + ' ' + html.length); }
        catch (e) { report.push(tried[i].slice(-14) + ' ' + (e && e.message)); continue; }
        scan(html);
        var doc = parse(html);
        [].forEach.call(doc.querySelectorAll('iframe'), function (n) { stats.iframe++; addEmbed(n.getAttribute('src') || n.getAttribute('data-src') || n.getAttribute('data-lazy-src'), tried[i]); });
        [].forEach.call(doc.querySelectorAll('[data-url],[data-src],[data-embed],[data-link],a[href*="embed"],a[href*="player"],a[href*="?do=watch"]'), function (n) {
          addEmbed(n.getAttribute('data-url') || n.getAttribute('data-embed') || n.getAttribute('data-link') || n.getAttribute('data-src') || n.getAttribute('href'), tried[i]);
        });
        // DooPlay-style server buttons
        [].forEach.call(doc.querySelectorAll('[data-post][data-nume]'), function (n) {
          stats.nume++;
          posts.push({ post: n.getAttribute('data-post'), nume: n.getAttribute('data-nume'), type: n.getAttribute('data-type') || 'movie' });
        });
        // any embed-looking URL written in scripts / attributes
        (html.replace(/\\\//g, '/').match(/https?:\/\/[^"'\s<>\\]+/g) || []).forEach(function (u) {
          var h = host(u);
          if (h && h !== h0 && !/google|gstatic|facebook|twitter|cloudflare|wp\.com|w3\.org|schema\.org|jquery|bootstrap|fontawesome|gravatar|youtube\.com\/(?!embed)/i.test(h)) { if (!hosts[h]) hosts[h] = u; }
          if (/(embed|player|stream|dood|voe|mixdrop|uqload|vidmoly|filemoon|streamwish|upstream|ok\.ru\/videoembed|vk\.com\/video_ext)/i.test(u) && !/\.(jpe?g|png|gif|webp|svg|css|js)(\?|$)/i.test(u)) addEmbed(u, tried[i]);
        });
        if (direct.length || embeds.length || posts.length) break;
      }
      for (var k = 0; k < posts.length && k < 6 && !direct.length; k++) {
        var pj = posts[k], got = '';
        try {
          var r = await MediaHub.getJSON(base + '/wp-json/dooplayer/v2/' + pj.post + '/' + pj.type + '/' + pj.nume);
          got = r.embed_url || r.url || '';
        } catch (e) {
          try {
            var t = await MediaHub.getText(base + '/wp-admin/admin-ajax.php', {
              method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: 'action=doo_player_ajax&post=' + pj.post + '&nume=' + pj.nume + '&type=' + pj.type
            });
            var jm = t.match(/"embed_url"\s*:\s*"([^"]+)/); got = jm ? jm[1].replace(/\\\//g, '/') : (t.match(/src=["']([^"']+)/) || [])[1] || '';
          } catch (e2) {}
        }
        if (got) { scan(got); addEmbed(got, page); }
      }
      var crawled = {}, labels = {}, refs = {}, relays = {}, labelFor = {}, lastN = 0, lastLabel = '', lastRef = page, lastRelay = false;
      function flushLabels() { for (; lastN < direct.length; lastN++) { labels[direct[lastN]] = lastLabel; refs[direct[lastN]] = lastRef; relays[direct[lastN]] = lastRelay; } }
      var queue = embeds.map(function (u) { return { u: u, d: 0, ref: page }; }), seenQ = {}, fetched = 0, eReport = [];
      while (queue.length && fetched < 9 && direct.length < 3) {
        var q = queue.shift();
        if (seenQ[q.u]) continue; seenQ[q.u] = 1; fetched++;
        flushLabels(); lastLabel = labelFor[q.u] || ''; lastRef = q.u;
        if (!q.nodec) {
          var dec = decodeToken(q.u);
          if (dec && !seenQ[dec]) {
            eReport.push('decoded ' + dec.slice(0, 160));
            queue.unshift({ u: dec, d: q.d + 1, ref: q.u });
            queue.push({ u: q.u, d: q.d, ref: q.ref, nodec: true });
            seenQ[q.u] = 0; fetched--; continue;
          }
        }
        var txt;
        var viaRelay = false;
        try { var sr = await smartText(q.u, { referer: q.ref }); txt = sr.t; viaRelay = sr.relay; }
        catch (e1) {
          try { txt = await MediaHub.getText(q.u, { referrerPolicy: 'no-referrer' }); }
          catch (e2) { eReport.push(q.u.slice(0, 300) + ' -> ' + (e1 && e1.message)); continue; }
        }
        eReport.push(host(q.u) + ' ' + txt.length + (viaRelay ? ' r' : ' d')); lastRelay = viaRelay;
        var txt2 = unent(txt), all = txt2 + unpackAll(txt2) + decodeB64(txt2);
        scan(all);
        all.replace(FILEKEY, function (m0, u) {
          u = u.replace(/\\\//g, '/');
          if (!NOTMEDIA.test(u) && direct.indexOf(u) < 0 && /\.(m3u8|mp4|mpd)|\/hls\/|master|playlist|\/stream/i.test(u)) direct.push(u);
          return m0;
        });
        encodedUrls(all).forEach(function (u) {
          if (/\.(m3u8|mp4|mpd)(\?|$)/i.test(u)) { if (direct.indexOf(u) < 0) direct.push(u); }
          else if (q.d < 3 && !seenQ[u]) queue.push({ u: u, d: q.d + 1, ref: q.u });
        });
        var mh = q.u.match(/^(https?:\/\/[^\/]+)\/iframe\/([A-Za-z0-9]+)/);
        if (mh && !crawled.sib) {
          crawled.sib = 1;
          ['mirror', 'download'].forEach(function (seg) { queue.push({ u: mh[1] + '/' + seg + '/' + mh[2], d: q.d + 1, ref: q.u }); });
        }
        if (!direct.length && q.d >= 1) {
          var pd = pageData(txt), tag = q.u.split('/').slice(3, 4).join('');
          if (pd && pd.props && !crawled['d' + q.u]) {
            crawled['d' + q.u] = 1;
            // Inertia only sends optional/lazy props when they are asked for by name, so ask for the likely ones.
            var dn = ['attachments', 'attachment', 'mirror', 'mirrors', 'source', 'sources', 'stream', 'streams', 'hls', 'network', 'networks',
              'domain', 'domains', 'storage', 'storages', 'account', 'accounts', 'path', 'paths', 'files', 'links', 'link', 'urls', 'qualities',
              'servers', 'subtitles', 'tracks', 'playlist', 'playlists', 'manifest', 'download', 'downloads', 'directLink', 'direct'];
            Object.keys(pd.deferredProps || {}).forEach(function (g) { dn = dn.concat(pd.deferredProps[g]); });
            try {
              var sj = await smartText(q.u, { referer: q.u, headers: {
                'X-Inertia': 'true', 'X-Inertia-Version': pd.version || '', 'X-Inertia-Partial-Component': pd.component || '',
                'X-Inertia-Partial-Data': dn.join(','), 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'text/html, application/xhtml+xml' } });
              var dj = JSON.parse(sj.t);
              var fresh = [];
              if (dj && dj.props) Object.keys(dj.props).forEach(function (k) { if (!(k in pd.props)) fresh.push(k); pd.props[k] = dj.props[k]; });
              var sdata = (dj && dj.props && dj.props.streams && dj.props.streams.data) || [];
              sdata.forEach(function (it) {
                (it.mirrors || []).slice().sort(function (a, b) { return (/vip/i.test((b.symbol || '') + (b.driver || '')) ? 1 : 0) - (/vip/i.test((a.symbol || '') + (a.driver || '')) ? 1 : 0); }).forEach(function (m) {
                  var l3 = String(m.link || '');
                  if (!/^(https?:)?\/\//.test(l3)) return;
                  var u3 = l3.indexOf('//') === 0 ? 'https:' + l3 : l3;
                  if (seenQ[u3]) return;
                  labelFor[u3] = ((m.symbol || m.driver || 'Server') + (m.driver && m.symbol && m.driver !== m.symbol ? ' (' + m.driver + ')' : '') + ' ' + (String(it.label || '').split(' ')[0])).trim();
                  queue.push({ u: u3, d: q.d + 1, ref: q.u });
                });
              });
              eReport.push('[' + tag + '] partial new props: ' + (fresh.join(',') || 'none'));
            } catch (e) { eReport.push('[' + tag + '] partial ' + (e && e.message)); }
          }
          if (pd && !pd.props) eReport.push('[' + tag + '] pd keys: ' + Object.keys(pd).join(','));
          if (pd && pd.props) {
            var lv = leaves(pd.props, '', [], 0);
            lv.forEach(function (l) { if (/^https?:\/\/[^\s]+\.(m3u8|mp4|mkv|webm)(\?|$)/i.test(l.v) && direct.indexOf(l.v) < 0) direct.push(l.v); });
            var get = function (names) {
              for (var a1 = 0; a1 < names.length; a1++) for (var b1 = 0; b1 < lv.length; b1++) if (lv[b1].k === names[a1] && lv[b1].v) return lv[b1].v;
              return '';
            };
            if (!direct.length) {
              var dom = get(['domain', 'host', 'hostname', 'server']), acc = get(['account', 'account_id', 'accountId']),
                  mir = get(['mirror', 'mirror_id', 'mirrorId']), pth = get(['path', 'hls', 'hls_path']),
                  sto = get(['storage']), att = get(['attachment', 'attachment_id']), nm = get(['name', 'filename', 'file_name']);
              var atts = (pd.props.attachments || []).filter(function (x) { return x && x.hashId; });
              if (!att && atts.length) att = atts[0].hashId;
              if (!nm && pd.props.file) nm = pd.props.file.name || '';
              var cands = [];
              if (dom && acc && mir && pth) cands.push({ u: 'https://' + dom + '/hls/' + acc + '/' + mir + '/' + pth + '/master.m3u8', hls: true });
              if (dom && sto && att && mir && nm) cands.push({ u: 'https://' + dom + '/' + sto + '/' + att + '/' + mir + '/' + encodeURIComponent(nm), hls: false });
              for (var ci = 0; ci < cands.length && !direct.length; ci++) {
                try {
                  var ct = await MediaHub.getText(cands[ci].u, { referer: q.u, method: cands[ci].hls ? 'GET' : 'HEAD' });
                  eReport.push('try ' + host(cands[ci].u) + ' ok');
                  if (!cands[ci].hls || /^#EXTM3U/.test(ct)) direct.push(cands[ci].u);
                } catch (e) { eReport.push('try ' + host(cands[ci].u) + ' ' + (e && e.message)); }
              }
            }
            if (!direct.length) {
              var parts = [];
              Object.keys(pd.props).forEach(function (k) {
                if (k === 'config' || k === 'errors' || k === 'ads' || k === 'video' || k === 'file') return;
                var v = pd.props[k];
                if (Array.isArray(v)) parts.push(k + '[' + v.length + '] ' + keyPaths(v[0] || {}, '', 0, []).join(','));
                else if (v && typeof v === 'object') parts.push(k + '{' + keyPaths(v, '', 0, []).filter(function (x) { return !/_at=|name=/.test(x); }).join(',') + '}');
                else parts.push(k + '=' + String(v).slice(0, 30));
              });
              eReport.push('[' + tag + '] ' + (pd.component || '') + ': ' + parts.join(' ; ').slice(0, 560));
            }
          } else eReport.push('[' + tag + '] no page data');
        }
        if (!direct.length && q.d < 2) {
          [].forEach.call(parse(txt).querySelectorAll('iframe[src],iframe[data-src]'), function (n) {
            var u2 = abs(n.getAttribute('src') || n.getAttribute('data-src'), q.u);
            if (/^https?:/i.test(u2) && !/youtube|youtu\.be/i.test(u2)) queue.push({ u: u2, d: q.d + 1, ref: q.u });
          });
        }
      }
      flushLabels();
      if (direct.length > 1) {                 // test the ones the TV will open itself; keep the live ones
        var oks = await Promise.all(direct.map(function (u) { return relays[u] ? Promise.resolve(true) : verifyLink(u); }));
        var good = direct.filter(function (u, i) { return oks[i]; });
        if (good.length) direct = good;
      }
      if (!direct.length) {
        throw new Error('No video link. ' + eReport.join(' ; ') + ' | page ' + report.join('; '));
      }
      return direct.map(function (u, n) { return { url: u, label: (labels[u] || ('Server ' + (n + 1))) + ' \u00B7 ' + host(u).split('.').slice(-2).join('.'), referer: refs[u] || page, relay: !!relays[u] }; });
    }
  });
})();
