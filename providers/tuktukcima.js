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
          seen[href] = 1; eps.push({ id: href, url: href, title: t || 'Episode ' + (eps.length + 1) });
        }
      });
      return { title: title, poster: item.poster || meta('og:image'), desc: clean(meta('og:description') || meta('description')), episodes: eps };
    },

    getLinks: async function (cfg, target) {
      var base = baseOf(cfg), page = target.url || target.id, tried = [page];
      var tail = page.charAt(page.length - 1) === '/' ? '' : '/';
      tried.push(page + tail + 'watch/');
      var direct = [], embeds = [];
      function scan(text) {
        String(text).replace(/\\\//g, '/').replace(MEDIA, function (m) { if (direct.indexOf(m) < 0) direct.push(m); return m; });
      }
      for (var i = 0; i < tried.length; i++) {
        var html; try { html = await getHtml(tried[i]); } catch (e) { continue; }
        scan(html);
        var doc = parse(html);
        [].forEach.call(doc.querySelectorAll('iframe[src],iframe[data-src],[data-url],[data-src],[data-embed],a[href*="embed"],a[href*="player"]'), function (n) {
          var u = n.getAttribute('src') || n.getAttribute('data-src') || n.getAttribute('data-url') || n.getAttribute('data-embed') || n.getAttribute('href') || '';
          u = abs(u, tried[i]);
          if (/^https?:/i.test(u) && !/\.(jpe?g|png|gif|webp|svg|css|js)(\?|$)/i.test(u) && embeds.indexOf(u) < 0) embeds.push(u);
        });
        if (direct.length) break;
      }
      for (var j = 0; j < embeds.length && j < 8 && !direct.length; j++) {
        try { scan(await MediaHub.getText(embeds[j], { headers: { Referer: page } })); } catch (e) {}
      }
      if (!direct.length) {
        throw new Error('No direct video link. Servers found: ' + (embeds.slice(0, 4).map(host).join(', ') || 'none'));
      }
      return direct.map(function (u, n) { return { url: u, label: 'Server ' + (n + 1), referer: page }; });
    }
  });
})();
