// EgyDead provider for MediaHub (movies and series, Arabic subtitles). Built from the Anime4up provider.
// The site only shows its servers after a form post (View=1); the list is read from the answer.
// Written without the site's HTML in hand: when something is missing, the Diagnostics screen says what was found.
(function () {
  'use strict';

  var MEDIA = /https?:\\?\/\\?\/[^"'\s<>\\]+?\.(?:m3u8|mp4|mpd)(?![\w.-])(?:\?[^"'\s<>\\]*)?/gi;
  var NOTMEDIA = /\.(jpe?g|png|gif|webp|svg|css|js|ico|vtt|srt|json|woff2?|ttf)(\?|$)/i;
  var SKIPPATH = /\/(category|tag|genre|genres|page|author|wp-content|wp-json|feed|login|register|contact|dmca|privacy|anime-type|anime-status|season|studio)(\/|$)/i;
  var LABELS = 'الاستوديو|المصدر|الحلقات|الموسم|السنة|المدة|البلد|التصنيف العمري|التصنيف|النوع|الحالة|العرض|بداية العرض|نهاية العرض|studio|source|episodes|season|year|duration|country|rating|status|type';

  var SITE = '';
  var CARD_SEL = 'li.movieItem', TITLE_SEL = 'div.singleTitle em', POSTER_SEL = 'div.single-thumbnail img', SEASON_SEL = '/season/', WATCH_PAGE = true, SLUG_LAST = false;
  var IMG_RELAY = false;
  var SELF = new RegExp('https?://(?:[a-z0-9-]+\\.)?egydead\\.[a-z]{2,10}(?![a-z0-9.-]*[a-z0-9])', 'gi');
  // ---------- small helpers ----------
  function baseOf(cfg) {
    var u = String((cfg && cfg.url) || '').trim();
    if (!u) throw new Error('Site address is empty');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    SITE = u.replace(/\/+$/, '');
    return SITE;
  }
  function abs(u, base) { try { return new URL(u, base).href; } catch (e) { return ''; } }
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function dec(u) { try { return decodeURIComponent(u); } catch (e) { return u; } }
  function latin(d) { return String(d).replace(/[\u0660-\u0669]/g, function (c) { return c.charCodeAt(0) - 0x660; }); }
  function unent(t) { return String(t).replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
  function parse(html) { return new DOMParser().parseFromString(html, 'text/html'); }
  var REAL = '';
  var HC = {}, HCN = 0, LC = {}, PREF = '', dumped = {}, DQ = [], CARDDIAG = null;
  try { PREF = localStorage.getItem('egydead_pref') || ''; } catch (e) {}
  function withTimeout(p, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error('timeout')); }, ms);
      p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  // quality written inside a stream address (720p, quality=480, _1080.mp4 ...)
  function qualOfUrl(u) {
    var x = String(u), m = x.match(/[?&](?:quality|res|height|q)=(\d{3,4})p?(?![\d])/i) || x.match(/[\/_.-](\d{3,4})p(?![a-z\d])/i) || x.match(/[\/_-](2160|1440|1080|720|480|360|240)(?=[\/_.?-])/);
    return m ? m[1] + 'p' : '';
  }
  // best picture of an anime page (the og:image of this site is only its logo)
  function posterOf(d, base, title) {
    var best = '', bs = 1, t0 = clean(title).toLowerCase().slice(0, 10);
    [].forEach.call(d.querySelectorAll('img'), function (img) {
      var u = imgUrl(img, base);
      if (!u || /logo|favicon|icon|avatar|banner|sprite|loading|placeholder|emoji|flag|ads?\//i.test(u)) return;
      var alt = clean(img.getAttribute('alt') || img.getAttribute('title')).toLowerCase(), sc = 0, p = img.parentElement, i = 0;
      if (t0 && alt.indexOf(t0) >= 0) sc += 3;
      if (/wp-content\/uploads|poster|cover|thumb/i.test(u)) sc += 2;
      for (; p && i < 4; p = p.parentElement, i++) { if (/poster|thumb|cover|anime-?(details|info)|info/i.test(String(p.className && p.className.baseVal === undefined ? p.className : ''))) { sc += 2; break; } }
      var w = +img.getAttribute('width') || 0; if (w && w < 80) sc -= 3;
      if (sc > bs) { bs = sc; best = u; }
    });
    return best;
  }
  async function getHtml(url) {
    var hc = HC[url]; if (hc && Date.now() - hc.t < 300000) return hc.h;
    var t = await MediaHub.getText(url);
    var m = t.match(/<link[^>]+rel=["']canonical["'][^>]*href=["'](https?:\/\/[^\/"']+)/i) || t.match(/<link[^>]+href=["'](https?:\/\/[^\/"']+)[^>]*rel=["']canonical["']/i) || t.match(/property=["']og:url["'][^>]*content=["'](https?:\/\/[^\/"']+)/i);
    if (m && /egydead/i.test(m[1])) REAL = m[1];
    var hout = SITE ? t.replace(SELF, SITE) : t;
    if (++HCN > 60) { HC = {}; HCN = 1; }
    HC[url] = { t: Date.now(), h: hout };
    return hout;
  }
  function realRef(u) { return REAL && SITE ? String(u).replace(SITE, REAL) : u; }
  // servers that check the Referer: ask through the relay first (it can send one), the TV itself cannot
  async function relayFirst(url, opt) {
    if (MediaHub.proxy) { try { return { t: await MediaHub.getText(url, opt), relay: true }; } catch (e) { var e1 = e; } }
    return smartText(url, opt);
  }
  // the TV's own network first (stream links are tied to the requester), the relay only as a fallback
  async function smartText(url, opt) {
    opt = opt || {};
    try { return { t: await MediaHub.getText(url, Object.assign({}, opt, { direct: true })), relay: false }; }
    catch (e1) { return { t: await MediaHub.getText(url, opt), relay: !!MediaHub.proxy }; }
  }
  function isJunk(u) {
    return /googleusercontent|gstatic|favicon|imdb|youtube|youtu\.be|ytimg|googlevideo|facebook|fbcdn|instagram|tiktok|twitter|vimeo|dailymotion|tmdb|themoviedb|myanimelist|anilist|fanart/i.test(host(u)) || /trailer|teaser|promo|\/ads?\//i.test(u);
  }
  function metaOf(d, p) { var m = d.querySelector('meta[property="' + p + '"],meta[name="' + p + '"]'); return m ? m.getAttribute('content') : ''; }
  function h1Of(d) { var ts = TITLE_SEL && d.querySelector(TITLE_SEL); if (ts && clean(ts.textContent)) return tidy(ts.textContent); var h = d.querySelector('h1'); return clean(h && h.textContent) || clean(metaOf(d, 'og:title')); }

  // ---------- script decoding ----------
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
  function b64text(s) {
    try {
      s = String(s).replace(/-/g, '+').replace(/_/g, '/');
      return atob(s + '==='.slice(0, (4 - s.length % 4) % 4));
    } catch (e) { return ''; }
  }
  // text that was hidden as base64 (plain or reversed) inside a page
  function hiddenText(text) {
    var out = '', re = /["'`]([A-Za-z0-9+\/_=-]{28,})["'`]/g, m, n = 0;
    while ((m = re.exec(text)) && n < 40) {
      var s = m[1], d = b64text(s);
      if (/^[\x09\x0a\x0d\x20-\x7e]+$/.test(d) && /https?:|\/\/|\{/.test(d)) { out += '\n' + d; n++; continue; }
      d = b64text(s.split('').reverse().join(''));
      if (/^[\x09\x0a\x0d\x20-\x7e]+$/.test(d) && /https?:|\/\/|\{/.test(d)) { out += '\n' + d; n++; }
    }
    return out;
  }
  var FILEKEY = /(?:file|src|source|hls\d*|stream|video_url|url)["']?\s*[:=]\s*["'](https?:\\?\/\\?\/[^"'\s<>]+)/gi;

  // ---------- numbers ----------
  var ORD = { 'الاولى': 1, 'الأولى': 1, 'الثانية': 2, 'الثالثة': 3, 'الرابعة': 4, 'الخامسة': 5, 'السادسة': 6, 'السابعة': 7, 'الثامنة': 8, 'التاسعة': 9, 'العاشرة': 10 };
  function epNum(t) {
    t = latin(t);
    var m = t.match(/(?:الحلقة|حلقة|حلقه|episode|\bep)[\s\-_.:]*0*(\d+)/i); if (m) return +m[1];
    m = t.match(/[-_\/]s\d{1,2}e0*(\d{1,4})/i) || t.match(/[-_\/]e0*(\d{1,4})(?=[-_\/\s]|$)/i); if (m) return +m[1];
    for (var k in ORD) if (t.indexOf(k) >= 0) return ORD[k];
    m = t.match(/\/(\d{1,4})\/?(?=\s|$)/); if (m) return +m[1];
    return 0;
  }
  function cleanSeries(t) {
    return clean(String(t).replace(/^\s*(?:(?:تحميل|مشاهدة|انمي|أنمي|مسلسل|فيلم|برنامج)\s+)+/i, '').replace(/\s*(?:الحلقة|حلقة|episode)\s*\S+.*$/i, '').replace(/\s*(?:برابط|بروابط).*$/i, '').replace(/\s*(?:مترجم[ةه]?|مدبلج[ةه]?)\s*(?:كامل[ةه]?)?\s*$/i, ''));
  }
  // words that identify an anime in a URL
  function slugOf(u) {
    if (SLUG_LAST) { try { var ls = new URL(u).pathname.split('/').filter(Boolean).pop() || ''; return latin(dec(ls)).toLowerCase().split('-').filter(function (w) { return w.length > 1; }).slice(0, 3); } catch (e) {} }
    var segs = []; try { segs = new URL(u).pathname.split('/').filter(Boolean); } catch (e) {}
    var seg = '';
    for (var i = 0; i < segs.length; i++) if (!/^(episodes?|anime|watch|series?|serie|seasons?|titles?|movies?|animes)$/i.test(segs[i])) { seg = segs[i]; break; }
    seg = latin(dec(seg)).toLowerCase().replace(/(?:-?الحلقة[-_]?\d+|-?episode[-_]?\d+|-?ep[-_]?\d+)/g, '');
    return seg.split('-').filter(function (w) { return w.length > 1 && !/^(مترجم|مترجمة|انمي|أنمي|anime)$/.test(w); }).slice(0, 3);
  }

  // ---------- cards on list pages ----------
  function hasPic(n) {
    if (n.querySelector('img')) return true;
    var p = n.parentElement, i = 0;
    while (p && i < 3) { if (p.querySelectorAll('a[href]').length <= 4 && p.querySelector('img') && clean(n.textContent).length > 1) return true; p = p.parentElement; i++; }
    return false;
  }
  function picOf(a, base) {
    var img = a.querySelector('img') || (a.parentElement && a.parentElement.querySelector('img')), u = img ? imgUrl(img, base) : '';
    if (!u) {
      var pp = a, k = 0, el;
      for (; pp && k < 3 && !u; pp = pp.parentElement, k++) {
        if (pp !== a && pp.querySelectorAll('a[href]').length > 4) break;
        el = (bgOf(pp) ? pp : null) || pp.querySelector('[style*="url("],[data-bg],[data-background]');
        if (el) u = bgOf(el);
      }
      if (u) u = abs(u, base);
    }
    return u && !/^data:/.test(u) ? u : '';
  }
  function titleOf(a) {
    var img = a.querySelector('img'), h = a.querySelector('h1,h2,h3,h4,h5,.title,.Title') || (a.parentElement && a.parentElement.querySelector('h1,h2,h3,h4,h5'));
    var t = clean(a.getAttribute('title') || (h && h.textContent) || (img && img.getAttribute('alt')) || '');
    if (!t) { t = clean(a.textContent).replace(/^(?:الحلقة\s*\d+\s*)+/, ''); }
    return t;
  }
  function cardsGeneric(doc, base) {
    var groups = [], cur = { title: 'Latest', items: [] }, seen = {}, h0 = host(base);
    groups.push(cur);
    [].forEach.call(doc.body.querySelectorAll('h1,h2,h3,a[href]'), function (n) {
      if (/^H\d$/.test(n.tagName)) {
        if (n.closest && n.closest('a')) return;
        var t = clean(n.textContent);
        if (t && t.length < 50 && cur.items.length) { cur = { title: t, items: [] }; groups.push(cur); } else if (t && t.length < 50) cur.title = t;
        return;
      }
      var href = abs(n.getAttribute('href'), base);
      if (!href || host(href) !== h0 || SKIPPATH.test(href) || /#$/.test(href) || href === base + '/') return;
      if (!hasPic(n)) return;
      var title = titleOf(n);
      if (!title || title.length > 140 || seen[href]) return;
      seen[href] = 1;
      cur.items.push({ id: href, url: href, title: title, poster: picOf(n, base) });
    });
    return groups.filter(function (g) { return g.items.length; });
  }

  // Anime4up cards: the title is an <h3><a href=anime page>, the poster <img> sits in a sibling element of the same card.
  function bgOf(el) {
    if (!el || !el.getAttribute) return '';
    var st = el.getAttribute('style') || '', m = st.match(/url\(["']?([^"')]+)/);
    return m ? m[1] : (el.getAttribute('data-bg') || el.getAttribute('data-background') || el.getAttribute('data-image') || '');
  }
  function imgUrl(img, base) {
    if (!img) return '';
    var u = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy') || img.getAttribute('src') || '';
    if (/^data:/.test(u)) u = '';
    if (!u) { var ss = img.getAttribute('data-srcset') || img.getAttribute('srcset') || ''; u = (ss.split(',')[0] || '').trim().split(/\s+/)[0]; }
    if (!u) u = bgOf(img);
    return u && !/^data:/.test(u) ? abs(u, base) : '';
  }
  function pimg(u) {
    var p = MediaHub.proxy;
    if (!IMG_RELAY || !u || !p || !p.url || u.indexOf(p.url) === 0 || !/^https?:/i.test(u)) return u;
    var rf0 = (SITE || REAL || '').replace(/\/+$/, ''); if (!rf0) { try { rf0 = new URL(u).origin; } catch (e) {} }
    return p.url + '/img.jpg?url=' + encodeURIComponent(u) + '&referer=' + encodeURIComponent(rf0 + '/') + (p.key ? '&key=' + encodeURIComponent(p.key) : '');
  }
  function pxItems(list) { list.forEach(function (it) { it.poster = pimg(it.poster); }); return list; }
  function pxGroups(g) { g.forEach(function (x) { pxItems(x.items); }); return g; }
  function tidy(t) {
    return clean(String(t).replace(/^\s*(?:مشاهدة|تحميل|مشاهده)?\s*(?:فيلم|مسلسل|انمي|أنمي|برنامج)\s+/i, '').replace(/\s*(?:مترجم[ةه]?|مدبلج[ةه]?|اون لاين|أون لاين|كامل[ةه]?|بجودة.*|HD)\s*$/i, ''));
  }
  function cardsSel(doc, base) {
    var groups = [], cur = { title: 'Latest', items: [] }, seen = {}, h0 = host(base);
    groups.push(cur);
    [].forEach.call(doc.body.querySelectorAll('h1,h2,h3,h4,' + CARD_SEL), function (n) {
      if (/^H\d$/.test(n.tagName)) {
        if (n.closest && (n.closest(CARD_SEL) || n.closest('a'))) return;
        var t = clean(n.textContent);
        if (t && t.length < 40) { if (cur.items.length) { cur = { title: t, items: [] }; groups.push(cur); } else cur.title = t; }
        return;
      }
      var a = n.tagName === 'A' ? n : n.querySelector('a[href]'); if (!a) return;
      var href = abs(a.getAttribute('href'), base);
      if (!href || host(href) !== h0 || seen[href] || /#$/.test(href) || href === base + '/') return;
      var img = n.querySelector('img'), poster = picOf(a, base);
      if (!img && !poster) return;                       // menu and page-number items have no picture
      var title = tidy(a.getAttribute('title') || (n.querySelector('h1,h2,h3,h4,h5') || {}).textContent || (img && img.getAttribute('alt')) || '');
      if (!title || title.length > 140) return;
      seen[href] = 1; cur.items.push({ id: href, url: href, title: title, poster: poster });
    });
    return groups.filter(function (g) { return g.items.length; });
  }
  var SORD = { 'الاول': 1, 'الأول': 1, 'الثاني': 2, 'الثانى': 2, 'الثالث': 3, 'الرابع': 4, 'الخامس': 5, 'السادس': 6, 'السابع': 7, 'الثامن': 8, 'التاسع': 9, 'العاشر': 10 };
  function seasonNo(t) {
    var m = latin(t).match(/(?:الموسم|الجزء|season|\bs)\s*0*(\d{1,2})\b/i); if (m) return +m[1];
    m = clean(t).match(/(?:الموسم|الجزء)\s+(\S+)/); return m && SORD[m[1]] ? SORD[m[1]] : 0;
  }
  // the "مواسم المسلسل" list of a season page
  function seasonLinks(d, base, h0) {
    var out = [], seen = {}, stopRe = /ذات صل|مشابه|شاهد|احدث|المضاف/;
    [].forEach.call(d.querySelectorAll('h1,h2,h3,h4'), function (h) {
      var ht0 = clean(h.textContent);
      if (out.length || !/مواسم/.test(ht0) || stopRe.test(ht0)) return;
      var n = h, up = 0, found = false;
      for (; n && up < 3 && !found; n = n.parentElement, up++) {
        for (var s = n.nextElementSibling; s; s = s.nextElementSibling) {
          if (/^H[1-4]$/.test(s.tagName)) break;
          var hh = s.querySelector && s.querySelector('h1,h2,h3,h4');
          if (hh && stopRe.test(clean(hh.textContent))) break;
          var as = s.tagName === 'A' ? [s] : [].slice.call(s.querySelectorAll('a[href*="/seasons/"]'));
          as.forEach(function (a) {
            var href = abs(a.getAttribute('href'), base);
            if (!href || seen[href] || host(href) !== h0 || !/\/seasons\//i.test(href)) return;
            seen[href] = 1; found = true; out.push({ url: href, title: clean(a.getAttribute('title') || a.textContent) });
          });
        }
      }
    });
    out.reverse();                                       // the site lists the newest season first
    var nums = out.map(function (x) { return seasonNo(x.title); });
    if (out.length > 1 && nums.every(function (x) { return x > 0; })) out = out.map(function (x, i) { x.n = nums[i]; return x; }).sort(function (a, b) { return a.n - b.n; });
    return out.map(function (x, i) {
      var m = clean(x.title).match(/(?:الموسم|الجزء)\s+\S+/), lab = m ? m[0] : tidy(x.title).replace(/\s*(?:كامل|مترجم).*$/i, '').slice(0, 28);
      return { k: String(i + 1), label: lab || ('Season ' + (i + 1)), url: x.url };
    });
  }
  function cards(doc, base) {
    if (CARD_SEL) { var cs = cardsSel(doc, base); if (cs.length) return cs; }
    var groups = [], cur = { title: 'Latest', items: [] }, seen = {}, h0 = host(base);
    groups.push(cur);
    [].forEach.call(doc.body.querySelectorAll('h1,h2,h3,h4'), function (h) {
      var a = h.querySelector('a[href]');
      if (!a) {
        var t = clean(h.textContent);
        if (t && t.length < 50) { if (cur.items.length) { cur = { title: t, items: [] }; groups.push(cur); } else cur.title = t; }
        return;
      }
      var href = abs(a.getAttribute('href'), base);
      if (!href || host(href) !== h0 || SKIPPATH.test(href) || /#$/.test(href) || href === base + '/' || seen[href]) return;
      var title = clean(a.textContent) || clean(a.getAttribute('title'));
      if (!title || title.length > 140) return;
      var img = null, el = h.parentElement;
      for (var up = 0; el && up < 4 && !img; up++, el = el.parentElement) {
        if (el.querySelectorAll('h3 a[href],h2 a[href],h4 a[href]').length > 1) break;
        img = el.querySelector('img');
      }
      seen[href] = 1;
      cur.items.push({ id: href, url: href, title: title, poster: imgUrl(img, base) });
    });
    var out = groups.filter(function (g) { return g.items.length; });
    return out.length ? out : cardsGeneric(doc, base);
  }
  function searchCards(html, base) { var out = []; cards(parse(html), base).forEach(function (g) { out = out.concat(g.items); }); return out; }
  function nextLink(d, u, h0) {
    var a = d.querySelector('link[rel="next"],a[rel="next"],a.next,a.page-numbers.next,.pagination a.next');
    var h = a ? abs(a.getAttribute('href'), u) : '';
    return h && h !== u && host(h) === h0 ? h : '';
  }

  // ---------- episodes & details ----------
  function extractEps(d, u, h0) {
    var out = [], words = slugOf(u).slice(0, 2);
    [].forEach.call(d.querySelectorAll('a[href]'), function (a) {
      var href = abs(a.getAttribute('href'), u), t = clean(a.textContent);
      if (!href || href === u || host(href) !== h0) return;
      var dh = dec(href).toLowerCase(), isNum = /^[\d\u0660-\u0669]{1,4}$/.test(t);
      if (SKIPPATH.test(href) || /#$/.test(href)) return;
      if (words.length && !words.every(function (w) { return dh.indexOf(w) >= 0; }) && !/^(الحلقة|حلقة|حلقه|episode)\s*[\d\u0660-\u0669]+/i.test(t)) return;
      if (/\/episodes?\/|الحلقة|حلقة|[-_/]ep-?\d+/i.test(dh) || /(?:الحلقة|حلقة|حلقه|episode)\s*[\d\u0660-\u0669]+/i.test(t) || (isNum && /episode/i.test(dh))) out.push({ href: href, t: isNum ? 'الحلقة ' + latin(t) : t });
    });
    return out;
  }
  async function collectEps(url, h0, first) {
    var res = [], u = url, d = first || parse(await getHtml(url)), pages = 0, seen = {};
    for (;;) {
      extractEps(d, u, h0).forEach(function (e) { if (!seen[e.href]) { seen[e.href] = 1; res.push(e); } });
      var nx = nextLink(d, u, h0);
      if (!nx || pages++ >= 8) break;
      u = nx; d = parse(await getHtml(nx));
    }
    return res;
  }
  function animePageLink(d, url, h0) {
    var best = '';
    [].forEach.call(d.querySelectorAll('a[href*="/seasons/"],a[href*="/Series/"]'), function (a) {
      var href = abs(a.getAttribute('href'), url), pth = ''; try { pth = new URL(href).pathname; } catch (e) {}
      if (!href || href === url || host(href) !== h0 || pth.length < 4 || /\/episode\//i.test(pth) || /الحلقة/.test(dec(pth)) || SKIPPATH.test(href)) return;
      if (!best) best = href;
    });
    return best;
  }
  function genresOf(d) {
    var g = [];
    [].forEach.call(d.querySelectorAll('a[href*="/genre/"],a[href*="/genres/"],a[href*="anime-genre"],a[href*="/category/"]'), function (a) {
      var t = clean(a.textContent); if (t && t.length < 24 && g.indexOf(t) < 0) g.push(t);
    });
    return g.slice(0, 8);
  }
  // label above/next to a value: <div><span>الاستوديو</span><b>studio Pierrot</b></div>
  function infoRows(d) {
    var out = [], seen = {}, re = new RegExp('^(?:' + LABELS + ')$', 'i');
    [].forEach.call(d.querySelectorAll('div,li,p,span'), function (n) {
      var kids = n.children;
      if (kids.length !== 2) return;
      var a = clean(kids[0].textContent).replace(/[:：]\s*$/, ''), b = clean(kids[1].textContent);
      if (kids[0].children.length || kids[1].children.length) return;
      if (!re.test(a) || !b || b.length > 90 || seen[a]) return;
      seen[a] = 1; out.push({ k: a, v: b });
    });
    return out.slice(0, 10);
  }
  function synopsis(d) {
    var best = '';
    [].forEach.call(d.querySelectorAll('p,div'), function (n) {
      if (n.children.length > 3) return;
      var t = clean(n.textContent);
      if (t.length > 70 && t.length < 1200 && t.length > best.length && !/(الحلقة|©|جميع الحقوق)/.test(t.slice(0, 30))) best = t;
    });
    return best || clean(metaOf(d, 'og:description') || metaOf(d, 'description'));
  }

  // ---------- video servers ----------
  var KNOWN = /ok\.ru|videa|yonaplay|mega\.nz|hgcloud|hglink|haxloppd|streamwish|wishfast|vidhide|filelions|voe\.|dood|mp4upload|playmogo|filemoon|sendvid|vk\.com|swish|wish|vidhide|vidmoly|lulu|streamtape|uqload|mixdrop|upstream|dhcplay|minochinos|cybervynx|embed|\/e\/|player|\/v\//i;
  function normUrl(raw, base) {
    raw = unent(String(raw || '').trim());
    if (!raw || raw.length > 900 || /^(javascript|#|mailto)/i.test(raw)) return '';
    if (!/^(https?:)?\/\//i.test(raw)) {
      var d = b64text(raw); if (/^(https?:)?\/\//i.test(d)) raw = d;
      else { d = b64text(raw.split('').reverse().join('')); if (/^(https?:)?\/\//i.test(d)) raw = d; else return ''; }
    }
    raw = raw.indexOf('//') === 0 ? 'https:' + raw : raw;
    return abs(raw, base);
  }
  function qualityOf(el) {
    var n = el, i = 0;
    while (n && n.getAttribute && i < 6) {
      var s = (n.id || '') + ' ' + (n.className && n.className.baseVal === undefined ? n.className : '') + ' ' + (n.getAttribute('data-quality') || '') + ' ' + (n.getAttribute('data-q') || '');
      var m = s.match(/\b(fhd|hd|sd)\b/i); if (m) return m[1].toUpperCase();
      n = n.parentElement; i++;
    }
    return '';
  }
  function collectServers(doc, html, pageUrl) {
    var out = [], seen = {};
    function add(raw, name, q, auth, watch) {
      var u = normUrl(raw, pageUrl);
      if (!u || seen[u] || isJunk(u) || NOTMEDIA.test(u)) return;
      if (/\/(?:e|v|embed|iframe)\/?$/i.test(u.split(/[?#]/)[0])) return;     // address without an id
      if (!watch && host(u) === host(pageUrl) && !/embed|player|iframe|\/e\/|\/v\//i.test(u)) return;
      if (!KNOWN.test(u) && !auth) return;
      seen[u] = 1; out.push({ url: u, name: clean(name).slice(0, 22), q: q || '' });
    }
    [].forEach.call(doc.querySelectorAll('*'), function (el) {
      var at = el.attributes; if (!at) return;
      for (var i = 0; i < at.length; i++) {
        var nm = at[i].name;
        if (/^data-/.test(nm) || nm === 'href' || nm === 'src' || nm === 'value') {
          var v = at[i].value;
          if (v && v.length < 900 && (nm !== 'href' || el.tagName !== 'A' || KNOWN.test(v))) add(v, el.getAttribute('data-server') || el.getAttribute('data-name') || (clean(el.textContent).length < 30 ? el.textContent : ''), qualityOf(el), /^data-(ep-)?(url|src|embed|link|iframe|player|watch)$/i.test(nm), nm === 'data-watch');
        }
      }
    });
    var all = unent(html) + hiddenText(unent(html));
    (all.replace(/\\\//g, '/').match(/https?:\/\/[^"'\s<>\\)]+/g) || []).forEach(function (u) { add(u, '', ''); });
    return out;
  }
  function serverRank(u, name) {
    var h = host(u);
    if (/anime4up|megamax/i.test(name || '') || /megamax/i.test(h)) return 0;
    if (/ok\.ru/.test(h)) return 1;
    if (/hgcloud|hglink|haxloppd|streamwish|wishfast|swish|wish|vidhide|filelions|filemoon|dhcplay|minochinos|cybervynx/.test(h)) return 2;
    if (/yonaplay/.test(h)) return 3;
    if (/sendvid|voe|vidmoly|lulu|uqload|streamtape|mixdrop/.test(h)) return 4;
    if (/dood|playmogo|mogo|ds2play|d000d/.test(h)) return 7;
    if (/videa/.test(h)) return 6;
    if (/mp4upload/.test(h)) return 9;
    return 5;
  }

  // ok.ru keeps its video list inside data-options -> flashvars.metadata
  function okLinks(html) {
    var out = [];
    try {
      var m = html.match(/data-options="([^"]+)"/); if (!m) return out;
      var opt = JSON.parse(unent(m[1])), meta = opt.flashvars && opt.flashvars.metadata;
      var md = typeof meta === 'string' ? JSON.parse(meta) : meta; if (!md) return out;
      var rank = { full: 6, quad: 5, hd: 4, sd: 3, low: 2, lowest: 1, mobile: 0 };
      (md.videos || []).slice().sort(function (a, b) { return (rank[b.name] || 0) - (rank[a.name] || 0); }).slice(0, 3).forEach(function (v) {
        if (v && v.url) out.push({ url: v.url.replace(/\\u0026/g, '&'), q: { full: '1080p', quad: '1440p', hd: '720p', sd: '480p', low: '360p', lowest: '240p', mobile: '144p' }[v.name] || v.name });
      });
      var hls = md.hlsManifestUrl || md.hlsMasterPlaylistUrl || md.ondemandHls;
      if (hls) out.push({ url: hls, q: 'HLS' });
    } catch (e) {}
    return out;
  }

  // open a server page and pull out the stream address(es)

  // ---------- Doodstream family (playmogo.com, dood.*, ds2play ...) ----------
  async function doodLinks(txt, sv) {
    var m = txt.match(/\/pass_md5\/[^'"\s<>\\]+/);
    if (!m) return null;
    var origin = abs(sv.url, sv.url).replace(/^(https?:\/\/[^\/]+).*$/, '$1');
    var tk = (txt.match(/[?&]token=([A-Za-z0-9]+)/) || [])[1] || m[0].split('/').pop();
    var r = await relayFirst(origin + m[0], { referer: sv.url }), base = String(r.t).trim();   // same network (the relay) as the page and the video, the link is tied to it
    if (!/^https?:\/\//i.test(base)) throw new Error('pass_md5 gave "' + base.slice(0, 30) + '"');
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', rnd = '';
    for (var i = 0; i < 10; i++) rnd += chars.charAt(Math.floor(Math.random() * chars.length));
    // the trailing random part is ignored by the CDN; '.mp4' on it lets the app pick the mp4 path (play.mp4) instead of treating it as HLS
    return { url: base + rnd + '.mp4?token=' + tk + '&expiry=' + Date.now(), relay: !!MediaHub.proxy, ref: origin + '/' };
  }
  // ---------- VOE (best effort: the page hides the playlist in an encoded JSON blob) ----------
  function voeSource(txt) {
    try {
      var h = txt.match(/["']hls["']\s*:\s*["']([A-Za-z0-9+\/=]{20,})["']/);
      if (h) { var u = b64text(h[1]); if (/^https?:/i.test(u)) return u; }
      var m = txt.match(/<script[^>]*type=["']application\/json["'][^>]*>\s*\[\s*"([^"]+)"\s*\]/i);
      if (!m) return '';
      var x = m[1].replace(/[a-zA-Z]/g, function (c) { var k = c.charCodeAt(0) + 13; return String.fromCharCode((c <= 'Z' ? 90 : 122) >= k ? k : k - 26); });
      ['@$', '^^', '~@', '%?', '*~', '!!', '#&'].forEach(function (q) { x = x.split(q).join(''); });
      x = b64text(x).split('').map(function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 3); }).reverse().join('');
      var j = JSON.parse(b64text(x));
      return j.source || j.direct_access_url || '';
    } catch (e) { return ''; }
  }
  // ---------- AES-128-CBC decrypt (small, no dependencies: the TV's WebCrypto is not always available) ----------
  var AES_SBOX = null, AES_INV = null;
  function aesInit() {
    if (AES_SBOX) return;
    var s = new Array(256), inv = new Array(256), p = 1, q = 1;
    function rotl(x, n) { return ((x << n) | (x >> (8 - n))) & 255; }
    do {
      p = p ^ ((p << 1) & 255) ^ (p & 128 ? 27 : 0);
      q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 255; if (q & 128) q ^= 9;
      var x = q ^ rotl(q, 1) ^ rotl(q, 2) ^ rotl(q, 3) ^ rotl(q, 4) ^ 99;
      s[p] = x; inv[x] = p;
    } while (p !== 1);
    s[0] = 99; inv[99] = 0;
    AES_SBOX = s; AES_INV = inv;
  }
  function gmul(a, b) { var r = 0; while (b) { if (b & 1) r ^= a; a = ((a << 1) & 255) ^ (a & 128 ? 27 : 0); b >>= 1; } return r; }
  function aesKeys(key) {
    var w = [], i, t, rc = 1;
    for (i = 0; i < 16; i++) w[i] = key[i];
    for (i = 16; i < 176; i += 4) {
      t = [w[i - 4], w[i - 3], w[i - 2], w[i - 1]];
      if (i % 16 === 0) { t = [AES_SBOX[t[1]] ^ rc, AES_SBOX[t[2]], AES_SBOX[t[3]], AES_SBOX[t[0]]]; rc = ((rc << 1) & 255) ^ (rc & 128 ? 27 : 0); }
      for (var j = 0; j < 4; j++) w[i + j] = w[i - 16 + j] ^ t[j];
    }
    return w;
  }
  function aesBlockDec(b, w) {
    var st = b.slice(), r, i, c;
    function add(rk) { for (var k = 0; k < 16; k++) st[k] ^= w[rk * 16 + k]; }
    add(10);
    for (r = 9; r >= 0; r--) {
      var t = st.slice();                                   // inverse shift rows
      for (c = 0; c < 4; c++) for (i = 0; i < 4; i++) st[((c + i) % 4) * 4 + i] = t[c * 4 + i];
      for (i = 0; i < 16; i++) st[i] = AES_INV[st[i]];
      add(r);
      if (r > 0) for (c = 0; c < 4; c++) {                  // inverse mix columns
        var a0 = st[c * 4], a1 = st[c * 4 + 1], a2 = st[c * 4 + 2], a3 = st[c * 4 + 3];
        st[c * 4] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
        st[c * 4 + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
        st[c * 4 + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
        st[c * 4 + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
      }
    }
    return st;
  }
  function aesCbcHex(hex, keyStr, ivStr) {
    aesInit();
    var d = [], i, j;
    for (i = 0; i + 1 < hex.length; i += 2) d.push(parseInt(hex.substr(i, 2), 16));
    var key = [], iv = [];
    for (i = 0; i < 16; i++) { key.push(keyStr.charCodeAt(i) & 255); iv.push(ivStr.charCodeAt(i) & 255); }
    var w = aesKeys(key), out = '', prev = iv;
    for (i = 0; i + 16 <= d.length; i += 16) {
      var blk = d.slice(i, i + 16), pl = aesBlockDec(blk, w);
      for (j = 0; j < 16; j++) out += String.fromCharCode(pl[j] ^ prev[j]);
      prev = blk;
    }
    var pad = out.charCodeAt(out.length - 1); if (pad > 0 && pad <= 16) out = out.slice(0, out.length - pad);
    return out;
  }

  function sourcesOf(txt) {
    var out = [], re = /(?:video_)?sources?["']?\s*[:=]\s*\[/gi, m, T = String(txt);
    while ((m = re.exec(T))) {
      var st = m.index + m[0].length - 1, d = 0, q = '', i = st, esc = false;
      for (; i < T.length && i < st + 20000; i++) {
        var ch = T.charAt(i);
        if (q) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === q) q = ''; }
        else if (ch === '"' || ch === "'") q = ch;
        else if (ch === '[' || ch === '{') d++;
        else if (ch === ']' || ch === '}') { d--; if (!d) break; }
      }
      var arr; try { arr = JSON.parse(T.slice(st, i + 1)); } catch (e) { continue; }
      if (!Array.isArray(arr)) continue;
      arr.forEach(function (it) {
        if (!it) return;
        var u = typeof it === 'string' ? it : (it.src || it.file || it.url || it.source || '');
        if (u && /^https?:|^\/\//.test(u) && !/\.(jpe?g|png|webp|gif|vtt|srt)(\?|$)/i.test(u)) out.push({ url: u.indexOf('//') === 0 ? 'https:' + u : u, q: String(it.label || it.quality || '').replace(/\s*premium/i, '').trim() });
      });
    }
    return out;
  }
  async function vidstackLinks(sv, page, rep) {
    var u; try { u = new URL(sv.url); } catch (e) { return []; }
    var id = u.hash.replace(/^#/, '') || (u.searchParams && (u.searchParams.get('id') || u.searchParams.get('v'))) || '';
    if (!id) { var seg = u.pathname.split('/').filter(Boolean); if (seg.length > 1 && /^(e|embed|v|d|f|iframe)$/i.test(seg[seg.length - 2])) id = seg[seg.length - 1]; }
    if (!id) return [];
    var api = u.origin + '/api/v1/video?id=' + encodeURIComponent(id) + '&w=1920&h=1080&r=' + encodeURIComponent(realRef(page));
    var t = '', apiErr = [];
    try { t = String(await MediaHub.getText(api, { direct: true })).trim(); } catch (e1) { apiErr.push('d ' + String((e1 && e1.message) || e1).slice(0, 22)); }
    if (!t || /^</.test(t) && t.length < 300) {
      if (MediaHub.proxy) { try { t = String(await MediaHub.getText(api, { referer: sv.url })).trim(); } catch (e2) { apiErr.push('r ' + String((e2 && e2.message) || e2).slice(0, 22)); } }
    }
    if (!t) { rep.push(host(sv.url).slice(0, 12) + ' api: ' + apiErr.join(' | ')); return []; }
    var plain = t;
    if (/^[0-9a-f]{32,}$/i.test(t)) plain = aesCbcHex(t, 'kiemtienmua911ca', '1234567890oiuytr');
    var urls = [], seenU = {};
    plain.replace(/\\\//g, '/').replace(/"(?:source|hls|file|url|cf)"\s*:\s*"(https?:\/\/[^"]+)"/gi, function (m0, x) { if (!seenU[x] && !NOTMEDIA.test(x)) { seenU[x] = 1; urls.push(x); } return m0; });
    if (!urls.length) { plain.replace(MEDIA, function (m0) { if (!seenU[m0]) { seenU[m0] = 1; urls.push(m0); } return m0; }); }
    if (!urls.length) { rep.push(host(sv.url).slice(0, 12) + ' api: ' + plain.replace(/\s+/g, ' ').slice(0, 38)); return []; }
    rep.push(host(sv.url).slice(0, 12) + ' api ok ' + urls.length);
    return urls.map(function (x) { return { url: x, q: '', relay: true, ref: u.origin + '/', name: sv.name, sq: sv.q }; });
  }

  // ---------- Inertia players (Laravel + Vue pages that keep the video data as JSON inside the page) ----------
  async function inertiaScan(txt, sv, push) {
    var m = txt.match(/<script[^>]*>\s*(\{"component":[\s\S]*?\})\s*<\/script>/);
    if (!m) { var m2 = txt.match(/data-page=(["'])(\{[\s\S]*?\})\1/); if (m2) m = [0, unent(m2[2])]; }
    if (!m) return;
    var h = host(sv.url).slice(0, 12), obj, leaves = [];
    try { obj = JSON.parse(m[1]); } catch (e) { DQ.push(['egydead json ' + h, 'parse failed ' + String(m[1]).slice(0, 120)]); return; }
    (function walk(v, path, d) {
      if (d > 7 || leaves.length > 400) return;
      if (v && typeof v === 'object') Object.keys(v).slice(0, 60).forEach(function (k) { walk(v[k], path + '.' + k, d + 1); });
      else if (typeof v === 'string' || typeof v === 'number') leaves.push([path, String(v)]);
    })(obj.props || obj, 'p', 0);
    var isMed = function (u) { return /\.(?:m3u8|mp4|mpd)(?![\w.-])/i.test(u); };
    leaves.forEach(function (l) {
      var v = l[1].replace(/\\\//g, '/');
      if ((/^https?:\/\//i.test(v) || /^\//.test(v)) && isMed(v)) push(abs(v, sv.url));
    });
    // ---- build the playlist address from the page data: template hls/{account}/{mirror}/{path}/master.m3u8 ----
    try {
      var lv = function (re, pre) { return leaves.filter(function (l) { return re.test(l[0].split('.').pop()) && (!pre || pre.test(l[0])); }).map(function (l) { return l[1]; }); };
      var uniq = function (a) { var sn = {}; return a.filter(function (x) { if (!x || sn[x]) return false; sn[x] = 1; return true; }); };
      var tok = lv(/^token$/i, /stream/i)[0] || lv(/^token$/i)[0] || '';
      var tl = leaves.filter(function (l) { return /\{(?:account|mirror|path)\}/.test(l[1]); })[0];
      var tmpl = tl ? tl[1] : 'hls/{account}/{mirror}/{path}/master.m3u8';
      var accs = uniq(lv(/^account/i).concat(lv(/^user_id$/i))).slice(0, 2);
      var pths = uniq(lv(/^path$/i).concat(lv(/^hashId$/i))).slice(0, 2);
      var mirs = uniq(lv(/^(?:value|mirror)$/i, /mirror|server/i)).slice(0, 3); if (!mirs.length) mirs = [''];
      var doms = uniq(lv(/^(?:domain|host|cdn|base|url)$/i, /stream|mirror|server|cdn|hls/i).map(function (x) { return x.replace(/^https?:\/\//, '').replace(/\/.*$/, ''); })).slice(0, 3);
      var cand = [];
      doms.forEach(function (dm) { accs.forEach(function (ac) { pths.forEach(function (pt) { mirs.forEach(function (mi) {
        var u = tmpl.replace(/\{domain\}/g, dm).replace(/\{account\}/g, ac).replace(/\{mirror\}/g, mi).replace(/\{path\}/g, pt);
        u = /^https?:\/\//i.test(u) ? u : 'https://' + dm + '/' + u.replace(/^\//, '');
        if (tok) u += (u.indexOf('?') < 0 ? '?' : '&') + 'token=' + encodeURIComponent(tok);
        if (cand.length < 6) cand.push(u);
      }); }); }); });
      DQ.push(['egydead build ' + h, 'tmpl=' + tmpl + ' tok=' + (tok ? tok.slice(0, 8) : '-') + ' acc=' + accs.join(',') + ' path=' + pths.join(',') + ' mir=' + mirs.join(',') + ' dom=' + doms.join(',') + ' -> ' + cand.length]);
      cand.forEach(function (u) { push(u, ''); });
    } catch (e) { DQ.push(['egydead build ' + h, 'error ' + String((e && e.message) || e).slice(0, 80)]); }
    var KEYRE = /stream|mirror|token|domain|account|path|hls|uri|quality|source|cdn|server|host/i;
    var prio = leaves.filter(function (l) { return KEYRE.test(l[0]) && !/allow_domain|^p\.ads/.test(l[0]); }), rest = leaves.filter(function (l) { return prio.indexOf(l) < 0 && !/^p\.(config|ads)/.test(l[0]); });
    DQ.push(['egydead json ' + h, prio.concat(rest).map(function (l) { return l[0].replace(/^p\./, '') + '=' + l[1].replace(/\s+/g, ' ').slice(0, 60); }).slice(0, 30).join(' ; ')]);
    // the player script knows which address it asks for the stream: list the paths it contains
    var srcs = [];
    txt.replace(/<(?:script|link)[^>]+(?:src|href)=["']([^"']+\.js[^"']*)["']/gi, function (m0, x) { var a = abs(x, sv.url); if (srcs.indexOf(a) < 0) srcs.push(a); return m0; });
    var hits = [], seenH = {}, ctx = [];
    for (var i = 0; i < srcs.length && i < 5; i++) {
      var js; try { js = await MediaHub.getText(srcs[i], { direct: true }); } catch (e) { continue; }
      js.replace(/["'`](\/[A-Za-z0-9_\-\/\.${}:]*(?:api|hls|stream|m3u8|mp4|playlist|source|embed|token|player|video|file)[A-Za-z0-9_\-\/\.${}:?=&]*)["'`]/gi, function (m0, x) { if (x.length > 3 && x.length < 60 && !seenH[x]) { seenH[x] = 1; hits.push(x); } return m0; });
      if (ctx.length < 3) js.replace(/.{0,45}(?:\.m3u8|\.mp4|\.hashId|hashId).{0,45}/g, function (m0) { if (ctx.length < 3) ctx.push(m0.replace(/\s+/g, ' ')); return m0; });
    }
    DQ.push(['egydead js ' + srcs.length + ' ' + h, hits.slice(0, 26).join(' ')]);
    if (ctx.length) DQ.push(['egydead ctx ' + h, ctx.join(' || ')]);
  }
  async function extractServer(sv, page, rep) {
    var h = host(sv.url);
    if (/mega\.nz|mega\.io/.test(h)) return [];
    var r;
    var pri = /anime4up|megamax|share4max/i.test(sv.name + ' ' + h), rf = realRef(page);
    var unk = /\/(?:e|iframe)\/[A-Za-z0-9_-]{8,}\/?$/.test(sv.url.split(/[?#]/)[0]) && !/ok\.ru|videa|vk\.|streamwish|wishfast|vidhide|filelions|voe\.|dood|mp4upload|playmogo|filemoon|sendvid|vidmoly|lulu|streamtape|uqload|mixdrop|upstream|dhcplay|minochinos|cybervynx|hgcloud|hglink|haxloppd/i.test(h);
    if (pri || unk || /#./.test(sv.url)) try { var vsl = await vidstackLinks(sv, page, rep); if (vsl.length) return vsl; } catch (e) { rep.push(h.slice(0, 12) + ' vs ' + String((e && e.message) || e).slice(0, 30)); }
    var dd = /dood|playmogo|ds2play|d000d|mogo/i.test(h);
    try { r = (pri || dd) ? await relayFirst(sv.url, { referer: rf }) : await smartText(sv.url, { referer: rf }); } catch (e) { rep.push(h.slice(0, 14) + ' ' + String((e && e.message) || e).slice(0, 40)); return []; }
    var txt = r.t, found = [], seen = {};
    function push(u, q) { u = String(u).replace(/\\\//g, '/'); if (!isJunk(u) && !seen[u]) { seen[u] = 1; found.push({ url: u, q: q || qualOfUrl(u) }); } }
    if (/ok\.ru/.test(h)) okLinks(txt).forEach(function (x) { push(x.url, x.q); });
    if (/vk\.com|vkvideo|vk\.ru/.test(h)) {                  // vk lists its files as "url720":"https://..."
      try {
        var vkT = unent(txt).replace(/\\\//g, '/'), vm, vre = /"url(\d{3,4})"\s*:\s*"(https?:[^"]+)"/g, vka = [];
        while ((vm = vre.exec(vkT))) vka.push({ n: +vm[1], u: vm[2] });
        vka.sort(function (a, b) { return b.n - a.n; }).forEach(function (x) { push(x.u, x.n + 'p'); });
      } catch (e) {}
    }
    if (/\/pass_md5\//.test(txt)) {
      try { var dl = await doodLinks(txt, sv); if (dl) { rep.push(h + ' dood ok'); return [{ url: dl.url, q: '', relay: dl.relay, ref: dl.ref, name: sv.name, sq: sv.q }]; } }
      catch (e) { rep.push(h + ' dood: ' + (e && e.message)); }
    }
    try {
      sourcesOf(unent(txt) + unpackAll(unent(txt))).sort(function (a, b) { return (parseInt(b.q, 10) || 0) - (parseInt(a.q, 10) || 0); }).forEach(function (x) {
        var qm = x.q.match(/\d{3,4}/); push(x.url, qm ? qm[0] + 'p' : '');
      });
    } catch (e) {}
    var vs = voeSource(txt);
    if (vs) push(vs);
    var all = unent(txt) + unpackAll(unent(txt)) + hiddenText(unent(txt));
    if (!found.length) {
      all.replace(/\\\//g, '/').replace(MEDIA, function (m0) { push(m0); return m0; });
      all.replace(FILEKEY, function (m0, u) { u = u.replace(/\\\//g, '/'); if (!NOTMEDIA.test(u) && /\.(m3u8|mp4|mpd)|\/hls\/|master|playlist|\/stream/i.test(u)) push(u); return m0; });
    }
    if (!found.length && /"component"\s*:/.test(txt)) { try { await inertiaScan(txt, sv, push); } catch (e) { rep.push('inertia ' + String((e && e.message) || e).slice(0, 40)); } }
    if (!found.length) {                                    // one nested player page
      var nest = parse(txt).querySelector('iframe[src],iframe[data-src]');
      if (nest) {
        var nu = abs(nest.getAttribute('src') || nest.getAttribute('data-src'), sv.url);
        if (/^https?:/i.test(nu) && !isJunk(nu) && nu !== sv.url) {
          try { var r2 = await smartText(nu, { referer: sv.url }), a2 = unent(r2.t) + unpackAll(unent(r2.t)) + hiddenText(unent(r2.t)); a2.replace(/\\\//g, '/').replace(MEDIA, function (m0) { push(m0); return m0; }); r.relay = r2.relay; } catch (e) {}
        }
      }
    }
    if (!found.length && txt.length >= 200 && !dumped[h]) {
      dumped[h] = 1;
      try {
        var dp = unent(txt).replace(/<style[\s\S]*?<\/style>/gi, ''), dk = dp.search(/\/api\/|fetch\(|\.m3u8|\.mp4|sources?\s*[:=]|token/i), dsr = [], inl = '';
        dp.replace(/<script([^>]*)>([\s\S]*?)<\/script>/gi, function (m0, at, body) {
          var sm = at.match(/src=["']([^"']+)/i);
          if (sm) dsr.push(sm[1].replace(/^https?:\/\//, '').slice(0, 36)); else if (!inl && body.length > 40) inl = body.replace(/\s+/g, ' ').slice(0, 260);
          return m0;
        });
        DQ.push(['egydead page ' + h.slice(0, 14) + ' ' + txt.length, dk >= 0 ? dp.slice(Math.max(0, dk - 80), dk + 300).replace(/\s+/g, ' ') : dp.replace(/\s+/g, ' ').slice(0, 300)]);
        DQ.push(['egydead scripts ' + h.slice(0, 14), dsr.slice(0, 4).join(' , ') + ' || ' + inl]);
      } catch (e) {}
    }
    rep.push(h + ' ' + txt.length + (r.relay ? ' r' : ' d') + (txt.length < 200 ? ' "' + txt.replace(/\s+/g, ' ').slice(0, 40) + '"' : '') + ' -> ' + found.length);
    return found.map(function (f) { return { url: f.url, q: f.q, relay: r.relay, ref: /ok\.ru/.test(h) ? 'https://ok.ru/' : sv.url, name: sv.name, sq: sv.q }; });
  }
  // a quick look at an HLS playlist the way the TV will open it
  async function verifyHls(u) {
    try {
      var t = await MediaHub.getText(u, { direct: true });
      if (t.indexOf('#EXTM3U') !== 0) return false;
      function first(x) { return (x.split(/\r?\n/).filter(function (l) { return l && l.charAt(0) !== '#'; })[0]) || ''; }
      var f = first(t); if (!f) return false;
      var nu = abs(f, u);
      if (/\.m3u8/i.test(nu)) { t = await MediaHub.getText(nu, { direct: true }); f = first(t); if (!f) return false; nu = abs(f, nu); }
      await MediaHub.getText(nu, { direct: true, headers: { Range: 'bytes=0-1023' } });
      return true;
    } catch (e) { return false; }
  }

  MediaHub.registerProvider({
    id: 'egydead',
    name: 'EgyDead',
    fields: [{ key: 'url', label: 'Site address (current EgyDead domain)', placeholder: 'https://egydead.space' }],

    getHome: async function (cfg) {
      var base = baseOf(cfg), html = await getHtml(base + '/'), g = cards(parse(html), base);
      if (!g.length) {
        var t = (html.match(/<title[^>]*>([^<]*)/i) || [])[1] || '';
        throw new Error('No titles found at ' + base + ' - page "' + clean(t).slice(0, 50) + '", ' + html.length + ' chars' + (/just a moment|challenge-platform/i.test(html) ? ' [Cloudflare check]' : ''));
      }
      try {
        var fp0 = '', anyPic = g.some(function (x) { return x.items.some(function (it) { if (it.poster && !fp0) fp0 = it.poster; return it.poster; }); });
        if (g[0] && g[0].items[0]) {
          var hp = null;
          if (!anyPic) {
            var f0 = g[0].items[0].url, d0 = parse(html), hit = null;
            [].forEach.call(d0.querySelectorAll('a[href]'), function (a) { if (!hit && abs(a.getAttribute('href'), base) === f0) hit = a; });
            hp = hit && (hit.parentElement || hit);
          }
          CARDDIAG = ['egydead card', anyPic ? 'first picture: ' + fp0 : 'no pictures found; ' + (hp ? hp.outerHTML.replace(/\s+/g, ' ').slice(0, 380) : 'card not located')];
          MediaHub.note(CARDDIAG[0], CARDDIAG[1]);
        }
      } catch (e) {}
      return pxGroups(g.slice(0, 14));
    },

    search: async function (cfg, q) {
      var base = baseOf(cfg), enc = encodeURIComponent(q), urls = [], tried = [], last = '';
      try {
        var forms = parse(await getHtml(base + '/')).querySelectorAll('form');
        for (var fi = 0; fi < forms.length; fi++) {
          var ins = forms[fi].querySelectorAll('input[name]'), nm = '', extra = [];
          for (var ii = 0; ii < ins.length; ii++) {
            var n = ins[ii].getAttribute('name'), ty = (ins[ii].getAttribute('type') || 'text').toLowerCase();
            if (ty === 'hidden') extra.push(n + '=' + encodeURIComponent(ins[ii].getAttribute('value') || ''));
            else if (!nm && (ty === 'search' || ty === 'text') && /^(s|q|search|query|keyword|word|k|term)$/i.test(n)) nm = n;
          }
          if (!nm) continue;
          var act = abs(forms[fi].getAttribute('action') || base + '/', base + '/');
          urls.push(act + (act.indexOf('?') < 0 ? '?' : '&') + [nm + '=' + enc].concat(extra).join('&')); break;
        }
      } catch (e) {}
      urls.push(base + '/?search_param=animes&s=' + enc, base + '/?s=' + enc, base + '/search/' + enc, base + '/search?q=' + enc, base + '/?q=' + enc);
      for (var ui = 0; ui < urls.length; ui++) {
        if (tried.indexOf(urls[ui]) >= 0) continue; tried.push(urls[ui]);
        try {
          var html = await getHtml(urls[ui]), out = searchCards(html, base);
          if (!out.length) { last = 'no results at ' + urls[ui].replace(base, '').slice(0, 40); continue; }
          var seenS = {}, dS = parse(html), uS = urls[ui], more = 0;
          out.forEach(function (x) { seenS[x.id] = 1; });
          while (more++ < 3) {
            var nx = nextLink(dS, uS, host(base)); if (!nx || nx === uS) break;
            try { var h2 = await getHtml(nx), extra2 = searchCards(h2, base), added = 0; extra2.forEach(function (x) { if (!seenS[x.id]) { seenS[x.id] = 1; out.push(x); added++; } }); if (!added) break; dS = parse(h2); uS = nx; } catch (e) { break; }
          }
          var onlyT = out.filter(function (x) { return !/\/episodes?\//i.test(x.url); });
          return pxItems(onlyT.length ? onlyT : out);
        } catch (e) { last = (e && e.message) + ' ' + urls[ui].replace(base, '').slice(0, 30); }
      }
      throw new Error('Search found nothing (' + tried.length + ' addresses tried; last: ' + last + ')');
    },

    load: async function (cfg, item) {
      var base = baseOf(cfg), url = item.url || item.id, h0 = host(base), doc = parse(await getHtml(url));
      var pageTitle = h1Of(doc) || item.title, isEp = /\/episodes?\/|الحلقة|حلقة|حلقه/i.test(dec(url));
      var animeUrl = isEp ? animePageLink(doc, url, h0) : url, ad = doc, aurl = url;
      if (isEp && animeUrl) { try { ad = parse(await getHtml(animeUrl)); aurl = animeUrl; } catch (e) { ad = doc; aurl = url; } }
      var seen = {}, list = [];
      function addAll(ex) { ex.forEach(function (e) { if (seen[e.href]) return; seen[e.href] = 1; list.push({ id: e.href, url: e.href, title: e.t, n: epNum(dec(e.href) + ' ' + e.t) }); }); }
      addAll(await collectEps(aurl, h0, ad));
      if (isEp) { addAll(extractEps(doc, url, h0)); if (!seen[url]) { seen[url] = 1; list.push({ id: url, url: url, title: pageTitle, n: epNum(dec(url) + ' ' + pageTitle) }); } }
      var seasons = [], curK = '';
      if (SEASON_SEL) {
        seasons = seasonLinks(ad, aurl, h0);
        seasons.forEach(function (sx) { if (sx.url === aurl || sx.url === url) curK = sx.k; });
        if (!list.length && seasons.length) {              // a series page that only lists its seasons: open the first one
          curK = seasons[0].k;
          try { addAll(await collectEps(seasons[0].url, h0)); } catch (e) {}
        }
        if (seasons.length && !curK) curK = seasons[seasons.length - 1].k;
      }
      list = list.map(function (e, i) { e.k = i; return e; });
      if (list.some(function (e) { return e.n > 0; })) list.sort(function (a, b) { return (a.n - b.n) || (a.k - b.k); });
      var seenN = {};
      list = list.filter(function (e) { if (!e.n) return true; if (seenN[e.n]) return false; seenN[e.n] = 1; return true; });
      list.forEach(function (e) { if (e.n) e.title = 'الحلقة ' + e.n; delete e.n; delete e.k; });
      if (seasons.length > 1) list.forEach(function (e) { e.season = curK; });
      if (!list.length) {
        try {
          var smp = [], sm = {};
          [].forEach.call(ad.querySelectorAll('a[href]'), function (a) { var hh = abs(a.getAttribute('href'), aurl); if (hh && host(hh) === h0) { var pp = ''; try { pp = new URL(hh).pathname.slice(0, 38); } catch (e) {} if (pp && !sm[pp] && smp.length < 7) { sm[pp] = 1; smp.push(pp); } } });
          MediaHub.note('egydead load', 'no episodes; page ' + ad.documentElement.innerHTML.length + ' chars; links: ' + smp.join(' , '));
        } catch (e) {}
      }
      var aTitle = ad !== doc ? h1Of(ad) : '';
      var pEl = POSTER_SEL ? ad.querySelector(POSTER_SEL) : null;
      return {
        seasons: seasons.length > 1 ? seasons : undefined, currentSeason: seasons.length > 1 ? curK : undefined,
        title: item.title || pageTitle, series: cleanSeries(aTitle || pageTitle || item.title) || undefined,
        poster: pimg((pEl && imgUrl(pEl, aurl)) || posterOf(ad, aurl, aTitle || pageTitle) || item.poster || (/logo|favicon|icon/i.test(metaOf(ad, 'og:image')) ? '' : metaOf(ad, 'og:image'))), desc: synopsis(ad), genres: genresOf(ad), meta: infoRows(ad),
        episodes: list
      };
    },

    seasonEpisodes: async function (cfg, sx) {
      var base = baseOf(cfg), h0 = host(base), ex = await collectEps(sx.url, h0), out = [], seenN = {};
      ex.forEach(function (e) {
        var n = epNum(dec(e.href) + ' ' + e.t); if (n && seenN[n]) return; if (n) seenN[n] = 1;
        out.push({ id: e.href, url: e.href, title: n ? 'الحلقة ' + n : e.t, n: n });
      });
      out.sort(function (a, b) { return a.n - b.n; }); out.forEach(function (e) { delete e.n; });
      return out;
    },

    getLinks: async function (cfg, target) {
      var base = baseOf(cfg), page = target.url || target.id, rep = [];
      var lc = LC[page]; if (lc && Date.now() - lc.t < 240000) return lc.v;
      DQ = [];
      var html = await getHtml(page);
      if (WATCH_PAGE && !/\/watch\/?$/i.test(page)) {         // EgyDead keeps the servers on the /watch/ page of a title
        var wu = '';
        try { [].forEach.call(parse(html).querySelectorAll('a[href*="/watch"]'), function (a) { if (!wu && /مشاهد/.test(a.textContent)) wu = abs(a.getAttribute('href'), page); }); } catch (e) {}
        if (!wu) wu = page.replace(/[?#].*$/, '').replace(/\/?$/, '/') + 'watch/';
        try { var wh = await getHtml(wu); html = wh + '\n' + html; rep.push('watch ' + wh.length); }
        catch (e) { rep.push('watch ' + String((e && e.message) || e).slice(0, 40)); }
      }
      var doc = parse(html);
      var servers = collectServers(doc, html, page);
      if (WATCH_PAGE) {                                    // the download button carries the id of the MegaMax player
        var dmm = html.match(/https?:\/\/[^"'\s<>]+?\/download\/([A-Za-z0-9_-]{6,})/);
        if (dmm) { var eu = dmm[0].split('/download/')[0] + '/e/' + dmm[1]; if (!servers.some(function (x) { return x.url === eu; })) servers.push({ url: eu, name: 'megamax', q: '' }); }
      }
      function rk(x) { return serverRank(x.url, x.name) - (PREF && host(x.url) === PREF ? 50 : 0); }
      servers.sort(function (a, b) { return rk(a) - rk(b); });
      try { MediaHub.note('egydead list', servers.map(function (x) { var pu = ''; try { pu = new URL(x.url).pathname.slice(0, 16); } catch (e) {} return (x.name || '?').slice(0, 9) + '=' + host(x.url) + pu; }).join(' ; ')); } catch (e) {}
      var links = [], seenL0 = {};
      var live = servers.filter(function (x) { return !/mega\.nz|mega\.io/.test(host(x.url)); });
      var firstB = live.filter(function (x) { return !/mp4upload/.test(host(x.url)); }).slice(0, 8);
      var lastB = live.filter(function (x) { return /mp4upload/.test(host(x.url)); }).slice(0, 2);
      async function runBatch(list) {                  // all servers of a batch are opened at the same time
        var res = await Promise.all(list.map(function (sv) {
          return withTimeout(extractServer(sv, page, rep), 15000).then(function (got) {
            return got.map(function (g) { g.srv = host(sv.url); return g; });
          }, function (e) { rep.push(host(sv.url).slice(0, 12) + ' ' + String((e && e.message) || e).slice(0, 24)); return []; });
        }));
        res.forEach(function (arr) { arr.forEach(function (g) { if (links.length < 8 && !seenL0[g.url]) { seenL0[g.url] = 1; links.push(g); } }); });
      }
      await runBatch(firstB);
      if (!links.length && lastB.length) await runBatch(lastB);   // mp4upload rarely works on the TV: last resort only
      // mp4upload needs a Referer and a non-standard port, so it fails on the TV and through the relay: only keep it when nothing else worked
      if (links.some(function (l) { return !/mp4upload/i.test(host(l.url)) && !/mp4upload/i.test(l.name || '') && !/mp4upload/i.test(l.ref || ''); })) {
        links = links.filter(function (l) { return !/mp4upload/i.test(l.name || '') && !/mp4upload/i.test(l.ref || ''); });
      }
      try { MediaHub.note('egydead servers', servers.length + ' found: ' + rep.join('; ')); } catch (e) {}
      if (links.length > 1) {                          // keep the HLS/mp4 addresses the TV can really open
        var oks = await Promise.all(links.map(function (l) { return (l.relay || !/\.m3u8/i.test(l.url)) ? Promise.resolve(true) : verifyHls(l.url); }));
        var good = links.filter(function (l, i2) { return oks[i2]; });
        if (good.length) links = good;
      }
      if (!links.length) { if (CARDDIAG) DQ.push(CARDDIAG); DQ.forEach(function (x) { MediaHub.note(x[0], x[1]); }); DQ = []; }
      if (!links.length) throw new Error('No working server for this episode (' + servers.length + ' found) | ' + rep.join('; ').slice(0, 320));
      var seenLab = {};
      var outL = links.map(function (l) {
        var nm0 = String(l.name || '').replace(/\s*متعدد.*$/, '').trim();
        var nm = (nm0 || host(l.url).split('.').slice(-2, -1)[0] || 'Server') + (l.sq ? ' ' + l.sq : '') + (l.q ? ' ' + l.q : '');
        var lab = nm.trim() + ' \u00B7 ' + host(l.url).split('.').slice(-2).join('.');
        seenLab[lab] = (seenLab[lab] || 0) + 1; if (seenLab[lab] > 1) lab += ' #' + seenLab[lab];
        return { url: l.url, label: lab, referer: l.ref || page, relay: !!l.relay };
      });
      try { if (links[0] && links[0].srv) { PREF = links[0].srv; localStorage.setItem('egydead_pref', PREF); } } catch (e) {}
      var lk = Object.keys(LC); if (lk.length > 30) LC = {};
      LC[page] = { t: Date.now(), v: outL };
      return outL;
    }
  });
})();
