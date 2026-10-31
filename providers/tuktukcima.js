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
      if (!n.querySelector('img') && !(n.parentElement && n.parentElement.querySelector('img') && n.parentElement.querySelector('h1,h2,h3,h4,h5'))) return;
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
      b = b.slice(0, b.length - (b.length % 4));
      for (; b.length >= 16; b = b.slice(0, -4)) {
        try {
          var m = atob(b).match(/^https?:\/\/[\x21-\x7e]+/);
          if (m) return m[0];
        } catch (e) {}
      }
    } catch (e) {}
    return '';
  }

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
      var base = baseOf(cfg), url = base + '/?s=' + encodeURIComponent(q), html = await getHtml(url);
      var g = cards(parse(html), base), out = [];
      g.forEach(function (x) { out = out.concat(x.items); });
      if (!out.length) throw new Error(diag(html, url));
      return out;
    },

    load: async function (cfg, item) {
      var base = baseOf(cfg), url = item.url || item.id, html = await getHtml(url), doc = parse(html);
      function meta(p) { var m = doc.querySelector('meta[property="' + p + '"],meta[name="' + p + '"]'); return m ? m.getAttribute('content') : ''; }
      var h1 = doc.querySelector('h1'), title = clean(h1 && h1.textContent) || clean(meta('og:title')) || item.title;
      var eps = [], seen = {}, h0 = host(base);
      [].forEach.call(doc.querySelectorAll('a[href]'), function (a) {
        var href = abs(a.getAttribute('href'), url), t = clean(a.textContent);
        if (!href || href === url || seen[href] || host(href) !== h0) return;
        var dec = ''; try { dec = decodeURIComponent(href); } catch (e) { dec = href; }
        if (/episode|الحلقة|حلقة/i.test(dec) || /^(الحلقة|حلقة|episode)\s*\d+/i.test(t)) {
          seen[href] = 1; var sm = (dec + ' ' + t).match(/(?:الموسم|موسم|season|\bs)[\s\-_]*0*(\d+)/i);
          eps.push({ id: href, url: href, title: t || 'Episode ' + (eps.length + 1), season: sm ? sm[1] : undefined });
        }
      });
      return { title: title, poster: item.poster || meta('og:image'), desc: clean(meta('og:description') || meta('description')), episodes: eps };
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
      var queue = embeds.map(function (u) { return { u: u, d: 0, ref: page }; }), seenQ = {}, fetched = 0, eReport = [];
      while (queue.length && fetched < 10 && !direct.length) {
        var q = queue.shift();
        if (seenQ[q.u]) continue; seenQ[q.u] = 1; fetched++;
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
        try { txt = await MediaHub.getText(q.u, { referer: q.ref }); }
        catch (e1) {
          try { txt = await MediaHub.getText(q.u, { referrerPolicy: 'no-referrer' }); }
          catch (e2) { eReport.push(q.u.slice(0, 300) + ' -> ' + (e1 && e1.message)); continue; }
        }
        eReport.push(host(q.u) + ' ' + txt.length);
        var all = txt + unpackAll(txt) + decodeB64(txt);
        scan(all);
        all.replace(FILEKEY, function (m0, u) {
          u = u.replace(/\\\//g, '/');
          if (!NOTMEDIA.test(u) && direct.indexOf(u) < 0 && /\.(m3u8|mp4|mpd)|\/hls\/|master|playlist|\/stream/i.test(u)) direct.push(u);
          return m0;
        });
        if (!direct.length && q.d < 2) {
          [].forEach.call(parse(txt).querySelectorAll('iframe[src],iframe[data-src]'), function (n) {
            var u2 = abs(n.getAttribute('src') || n.getAttribute('data-src'), q.u);
            if (/^https?:/i.test(u2) && !/youtube|youtu\.be/i.test(u2)) queue.push({ u: u2, d: q.d + 1, ref: q.u });
          });
        }
      }
      if (!direct.length) {
        throw new Error('No direct video link. Servers: ' + (embeds.slice(0, 4).map(host).join(', ') || 'none') +
          ' | embed pages: ' + eReport.join('; ') + ' | pages: ' + report.join('; ') + ' | iframes ' + stats.iframe + ', buttons ' + stats.nume +
          ' | urls: ' + Object.keys(hosts).slice(0, 4).map(function (h) { return hosts[h].slice(0, 80); }).join(' ; '));
      }
      return direct.map(function (u, n) { return { url: u, label: 'Server ' + (n + 1), referer: page }; });
    }
  });
})();
