// Anime4up provider for MediaHub (anime site, Arabic subtitles). Based on the Witanime provider.
// Mirror domains (e.g. 4p.xxx.shop) serve pages whose links point to the real domain (w1.anime4up.rest);
// every such link is rewritten to the address you typed so all requests go through the same domain.
// Written from screenshots of the site, not its HTML, so every step is heuristic and the error messages
// say what was found. Server pages (ok.ru, hgcloud, yonaplay ...) are opened from the TV itself first.
(function () {
  'use strict';

  var MEDIA = /https?:\\?\/\\?\/[^"'\s<>\\]+?\.(?:m3u8|mp4|mpd)(?![\w.-])(?:\?[^"'\s<>\\]*)?/gi;
  var NOTMEDIA = /\.(jpe?g|png|gif|webp|svg|css|js|ico|vtt|srt|json|woff2?|ttf)(\?|$)/i;
  var SKIPPATH = /\/(category|tag|genre|genres|page|author|wp-content|wp-json|feed|login|register|contact|dmca|privacy|anime-type|anime-status|season|studio)(\/|$)/i;
  var LABELS = 'الاستوديو|المصدر|الحلقات|الموسم|السنة|المدة|البلد|التصنيف العمري|التصنيف|النوع|الحالة|العرض|بداية العرض|نهاية العرض|studio|source|episodes|season|year|duration|country|rating|status|type';

  var SITE = '';
  var SELF = /https?:\/\/(?:[a-z0-9-]+\.)?anime4up\.(?:rest|com|tv|cc|net|org|site|shop|io|me|info|co)(?![a-z0-9.-]*[a-z0-9])/gi;
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
  async function getHtml(url) {
    var t = await MediaHub.getText(url);
    var m = t.match(/<link[^>]+rel=["']canonical["'][^>]*href=["'](https?:\/\/[^\/"']+)/i) || t.match(/<link[^>]+href=["'](https?:\/\/[^\/"']+)[^>]*rel=["']canonical["']/i) || t.match(/property=["']og:url["'][^>]*content=["'](https?:\/\/[^\/"']+)/i);
    if (m && /anime4up/i.test(m[1])) REAL = m[1];
    return SITE ? t.replace(SELF, SITE) : t;
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
  function h1Of(d) { var h = d.querySelector('h1'); return clean(h && h.textContent) || clean(metaOf(d, 'og:title')); }

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
    var m = t.match(/(?:الحلقة|حلقة|episode|\bep)[\s\-_.:]*0*(\d+)/i); if (m) return +m[1];
    for (var k in ORD) if (t.indexOf(k) >= 0) return ORD[k];
    return 0;
  }
  function cleanSeries(t) {
    return clean(String(t).replace(/^\s*(?:انمي|أنمي|مسلسل|فيلم)\s+/i, '').replace(/\s*(?:الحلقة|حلقة|episode)\s*\S+.*$/i, '').replace(/\s*مترجم[ةه]?\s*$/i, ''));
  }
  // words that identify an anime in a URL
  function slugOf(u) {
    var segs = []; try { segs = new URL(u).pathname.split('/').filter(Boolean); } catch (e) {}
    var seg = '';
    for (var i = 0; i < segs.length; i++) if (!/^(episode|episodes|anime|watch|series|movie|animes)$/i.test(segs[i])) { seg = segs[i]; break; }
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
    var img = a.querySelector('img') || (a.parentElement && a.parentElement.querySelector('img')), u = '';
    if (img) u = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || img.getAttribute('src') || '';
    if (!u || /^data:/.test(u)) {
      var el = a.querySelector('[style*="url("]') || (/url\(/.test(a.getAttribute('style') || '') ? a : null), st = el ? el.getAttribute('style') : '', m = st && st.match(/url\(["']?([^"')]+)/);
      if (m) u = m[1];
    }
    return u && !/^data:/.test(u) ? abs(u, base) : '';
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
  function imgUrl(img, base) {
    if (!img) return '';
    var u = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || img.getAttribute('src') || '';
    if (/^data:/.test(u)) u = '';
    if (!u) { var ss = img.getAttribute('data-srcset') || img.getAttribute('srcset') || ''; u = (ss.split(',')[0] || '').trim().split(/\s+/)[0]; }
    return u ? abs(u, base) : '';
  }
  function cards(doc, base) {
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
      if (words.length && !words.every(function (w) { return dh.indexOf(w) >= 0; }) && !/^(الحلقة|حلقة|episode)\s*[\d\u0660-\u0669]+/i.test(t)) return;
      if (/\/episode\/|الحلقة|حلقة|[-_/]ep-?\d+/i.test(dh) || /(?:الحلقة|حلقة|episode)\s*[\d\u0660-\u0669]+/i.test(t) || (isNum && /episode/i.test(dh))) out.push({ href: href, t: isNum ? 'الحلقة ' + latin(t) : t });
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
    [].forEach.call(d.querySelectorAll('a[href*="/anime/"],[class*="breadcrumb"] a[href]'), function (a) {
      var href = abs(a.getAttribute('href'), url), pth = ''; try { pth = new URL(href).pathname; } catch (e) {}
      if (!href || href === url || host(href) !== h0 || pth.length < 4 || /\/episode\//i.test(pth) || /الحلقة/.test(dec(pth)) || SKIPPATH.test(href)) return;
      if (!best || /\/anime\//i.test(pth)) best = href;
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

  async function vidstackLinks(sv, page, rep) {
    var u; try { u = new URL(sv.url); } catch (e) { return []; }
    var id = u.hash.replace(/^#/, '') || (u.searchParams && (u.searchParams.get('id') || u.searchParams.get('v'))) || '';
    if (!id) { var seg = u.pathname.split('/').filter(Boolean); if (seg.length > 1 && /^(e|embed|v|d|f|iframe)$/i.test(seg[seg.length - 2])) id = seg[seg.length - 1]; }
    if (!id) return [];
    var api = u.origin + '/api/v1/video?id=' + encodeURIComponent(id) + '&w=1920&h=1080&r=' + encodeURIComponent(realRef(page));
    var r = await relayFirst(api, { referer: sv.url }), t = String(r.t).trim();
    var plain = t;
    if (/^[0-9a-f]{32,}$/i.test(t)) plain = aesCbcHex(t, 'kiemtienmua911ca', '1234567890oiuytr');
    var urls = [], seenU = {};
    plain.replace(/\\\//g, '/').replace(/"(?:source|hls|file|url|cf)"\s*:\s*"(https?:\/\/[^"]+)"/gi, function (m0, x) { if (!seenU[x] && !NOTMEDIA.test(x)) { seenU[x] = 1; urls.push(x); } return m0; });
    if (!urls.length) { plain.replace(MEDIA, function (m0) { if (!seenU[m0]) { seenU[m0] = 1; urls.push(m0); } return m0; }); }
    if (!urls.length) { rep.push(host(sv.url).slice(0, 12) + ' api: ' + plain.replace(/\s+/g, ' ').slice(0, 38)); return []; }
    rep.push(host(sv.url).slice(0, 12) + ' api ok ' + urls.length);
    return urls.map(function (x) { return { url: x, q: '', relay: true, ref: u.origin + '/', name: sv.name, sq: sv.q }; });
  }
  async function extractServer(sv, page, rep) {
    var h = host(sv.url);
    if (/mega\.nz|mega\.io/.test(h)) return [];
    var r;
    var pri = /anime4up|megamax|share4max/i.test(sv.name + ' ' + h), rf = realRef(page);
    if (pri || /#./.test(sv.url)) try { var vsl = await vidstackLinks(sv, page, rep); if (vsl.length) return vsl; } catch (e) { rep.push(h.slice(0, 12) + ' vs ' + String((e && e.message) || e).slice(0, 30)); }
    var dd = /dood|playmogo|ds2play|d000d|mogo/i.test(h);
    try { r = (pri || dd) ? await relayFirst(sv.url, { referer: rf }) : await smartText(sv.url, { referer: rf }); } catch (e) { rep.push(h.slice(0, 14) + ' ' + String((e && e.message) || e).slice(0, 40)); return []; }
    var txt = r.t, found = [], seen = {};
    function push(u, q) { u = String(u).replace(/\\\//g, '/'); if (!isJunk(u) && !seen[u]) { seen[u] = 1; found.push({ url: u, q: q || '' }); } }
    if (/ok\.ru/.test(h)) okLinks(txt).forEach(function (x) { push(x.url, x.q); });
    if (/\/pass_md5\//.test(txt)) {
      try { var dl = await doodLinks(txt, sv); if (dl) { rep.push(h + ' dood ok'); return [{ url: dl.url, q: '', relay: dl.relay, ref: dl.ref, name: sv.name, sq: sv.q }]; } }
      catch (e) { rep.push(h + ' dood: ' + (e && e.message)); }
    }
    var vs = voeSource(txt);
    if (vs) push(vs);
    var all = unent(txt) + unpackAll(unent(txt)) + hiddenText(unent(txt));
    if (!found.length) {
      all.replace(/\\\//g, '/').replace(MEDIA, function (m0) { push(m0); return m0; });
      all.replace(FILEKEY, function (m0, u) { u = u.replace(/\\\//g, '/'); if (!NOTMEDIA.test(u) && /\.(m3u8|mp4|mpd)|\/hls\/|master|playlist|\/stream/i.test(u)) push(u); return m0; });
    }
    if (!found.length) {                                    // one nested player page
      var nest = parse(txt).querySelector('iframe[src],iframe[data-src]');
      if (nest) {
        var nu = abs(nest.getAttribute('src') || nest.getAttribute('data-src'), sv.url);
        if (/^https?:/i.test(nu) && !isJunk(nu) && nu !== sv.url) {
          try { var r2 = await smartText(nu, { referer: sv.url }), a2 = unent(r2.t) + unpackAll(unent(r2.t)) + hiddenText(unent(r2.t)); a2.replace(/\\\//g, '/').replace(MEDIA, function (m0) { push(m0); return m0; }); r.relay = r2.relay; } catch (e) {}
        }
      }
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
    id: 'anime4up',
    name: 'Anime4up',
    fields: [{ key: 'url', label: 'Site address (current Anime4up domain)', placeholder: 'https://4p.fabnkbo.shop' }],

    getHome: async function (cfg) {
      var base = baseOf(cfg), html = await getHtml(base + '/'), g = cards(parse(html), base);
      if (!g.length) {
        var t = (html.match(/<title[^>]*>([^<]*)/i) || [])[1] || '';
        throw new Error('No titles found at ' + base + ' - page "' + clean(t).slice(0, 50) + '", ' + html.length + ' chars' + (/just a moment|challenge-platform/i.test(html) ? ' [Cloudflare check]' : ''));
      }
      return g.slice(0, 14);
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
          return out;
        } catch (e) { last = (e && e.message) + ' ' + urls[ui].replace(base, '').slice(0, 30); }
      }
      throw new Error('Search found nothing (' + tried.length + ' addresses tried; last: ' + last + ')');
    },

    load: async function (cfg, item) {
      var base = baseOf(cfg), url = item.url || item.id, h0 = host(base), doc = parse(await getHtml(url));
      var pageTitle = h1Of(doc) || item.title, isEp = /\/episode\/|الحلقة|حلقة/i.test(dec(url));
      var animeUrl = isEp ? animePageLink(doc, url, h0) : url, ad = doc, aurl = url;
      if (isEp && animeUrl) { try { ad = parse(await getHtml(animeUrl)); aurl = animeUrl; } catch (e) { ad = doc; aurl = url; } }
      var seen = {}, list = [];
      function addAll(ex) { ex.forEach(function (e) { if (seen[e.href]) return; seen[e.href] = 1; list.push({ id: e.href, url: e.href, title: e.t, n: epNum(dec(e.href) + ' ' + e.t) }); }); }
      addAll(await collectEps(aurl, h0, ad));
      if (isEp) { addAll(extractEps(doc, url, h0)); if (!seen[url]) { seen[url] = 1; list.push({ id: url, url: url, title: pageTitle, n: epNum(dec(url) + ' ' + pageTitle) }); } }
      list = list.map(function (e, i) { e.k = i; return e; });
      if (list.some(function (e) { return e.n > 0; })) list.sort(function (a, b) { return (a.n - b.n) || (a.k - b.k); });
      var seenN = {};
      list = list.filter(function (e) { if (!e.n) return true; if (seenN[e.n]) return false; seenN[e.n] = 1; return true; });
      list.forEach(function (e) { if (e.n) e.title = 'الحلقة ' + e.n; delete e.n; delete e.k; });
      var aTitle = ad !== doc ? h1Of(ad) : '';
      return {
        title: item.title || pageTitle, series: cleanSeries(aTitle || pageTitle || item.title) || undefined,
        poster: metaOf(ad, 'og:image') || item.poster, desc: synopsis(ad), genres: genresOf(ad), meta: infoRows(ad),
        episodes: list
      };
    },

    getLinks: async function (cfg, target) {
      var base = baseOf(cfg), page = target.url || target.id, rep = [];
      var html = await getHtml(page), doc = parse(html);
      var servers = collectServers(doc, html, page);
      servers.sort(function (a, b) { return serverRank(a.url, a.name) - serverRank(b.url, b.name); });
      try { MediaHub.note('anime4up v3 list', servers.map(function (x) { var pu = ''; try { pu = new URL(x.url).pathname.slice(0, 16); } catch (e) {} return (x.name || '?').slice(0, 9) + '=' + host(x.url) + pu; }).join(' ; ')); } catch (e) {}
      var links = [], tried = 0, good0 = 0;
      for (var i = 0; i < servers.length && tried < 12 && good0 < 4; i++) {
        tried++;
        var got = await extractServer(servers[i], page, rep);
        got.forEach(function (g) { if (links.length < 8) { links.push(g); if (!/mp4upload/.test(host(servers[i].url))) good0++; } });
      }
      // mp4upload needs a Referer and a non-standard port, so it fails on the TV and through the relay: only keep it when nothing else worked
      if (links.some(function (l) { return !/mp4upload/i.test(host(l.url)) && !/mp4upload/i.test(l.name || '') && !/mp4upload/i.test(l.ref || ''); })) {
        links = links.filter(function (l) { return !/mp4upload/i.test(l.name || '') && !/mp4upload/i.test(l.ref || ''); });
      }
      try { MediaHub.note('anime4up servers', servers.length + ' found: ' + rep.join('; ')); } catch (e) {}
      if (links.length > 1) {                          // keep the HLS/mp4 addresses the TV can really open
        var oks = await Promise.all(links.map(function (l) { return (l.relay || !/\.m3u8/i.test(l.url)) ? Promise.resolve(true) : verifyHls(l.url); }));
        var good = links.filter(function (l, i2) { return oks[i2]; });
        if (good.length) links = good;
      }
      if (!links.length) {
        var dat = {}; [].forEach.call(doc.querySelectorAll('*'), function (el) { if (el.attributes) for (var j = 0; j < el.attributes.length; j++) if (/^data-/.test(el.attributes[j].name)) dat[el.attributes[j].name] = 1; });
        var lst = servers.filter(function (x) { return !/mega\./.test(host(x.url)); }).slice(0, 5).map(function (x) { var pu = ''; try { var uu = new URL(x.url); pu = (uu.pathname + uu.search + uu.hash).slice(0, 18); } catch (e) {} return (x.name || '?').slice(0, 8) + '@' + host(x.url) + pu; });
        try {                                            // show the page text around the server data, to see where the real ids are
          var allT = (unent(html) + hiddenText(unent(html))).replace(/\\\//g, '/'), keys = ['share4max'];
          var v0 = servers.filter(function (x) { return /voe\.sx/.test(host(x.url)); })[0];
          if (v0) { var sg = v0.url.split(/[?#]/)[0].split('/').filter(Boolean).pop(); if (sg && sg.length > 6) keys.unshift(sg); }
          keys.forEach(function (kw, ki) {
            var at = allT.indexOf(kw), cnt = allT.split(kw).length - 1;
            MediaHub.note('anime4up ctx' + (ki + 1) + ' x' + cnt, at < 0 ? 'not found: ' + kw : allT.slice(Math.max(0, at - 220), at + 280).replace(/\s+/g, ' '));
          });
        } catch (e) {}
        var btn = '';
        try {
          var cand = [].filter.call(doc.querySelectorAll('a,button,li,span,div'), function (el) { var t = clean(el.textContent); return t.length < 40 && /megamax|anime4up\s*\d/i.test(t); });
          var el0 = cand.filter(function (el) { return !el.querySelector('a,button,li,div'); })[0] || cand[cand.length - 1];
          if (el0) btn = el0.outerHTML.replace(/\s+/g, ' ').replace(/(class|style)="[^"]*"/g, '').slice(0, 170);
          var ax = doc.querySelector('[data-ajax-url]'); if (ax) btn += ' AJAX=' + String(ax.getAttribute('data-ajax-url')).slice(0, 40);
        } catch (e) {}
        throw new Error('v6 BTN ' + (btn || 'none') + ' | ' + rep.join('; ') + ' | servers ' + servers.length + ': ' + (lst.join(' ; ') || 'only mega'));
      }
      return links.map(function (l, n) {
        var nm = (l.name || host(l.url).split('.').slice(-2, -1)[0] || 'Server') + (l.sq ? ' ' + l.sq : '') + (l.q ? ' ' + l.q : '');
        return { url: l.url, label: nm.trim() + ' \u00B7 ' + host(l.url).split('.').slice(-2).join('.'), referer: l.ref || page, relay: !!l.relay };
      });
    }
  });
})();
