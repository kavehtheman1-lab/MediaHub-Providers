
(function () {
  'use strict';

  var BASE = 'https://ak.sv';

  function abs(url, base) {
    try { return new URL(url, base || BASE).href; }
    catch (e) { return url || ''; }
  }

  function clean(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  function getPoster(el) {
    var img = el && el.querySelector('img');
    return img ? abs(
      img.getAttribute('data-src') ||
      img.getAttribute('src') || ''
    ) : '';
  }

  async function getDoc(url) {
    var html = await MediaHub.getText(url, { method: 'GET' });
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function parseCards(doc) {
    var out = [];
    var nodes = doc.querySelectorAll(
      'div.col-lg-auto.col-md-4.col-6'
    );

    Array.prototype.forEach.call(nodes, function (el) {
      var a = el.querySelector('h3.entry-title a') ||
              el.querySelector('a[href]');
      if (!a) return;

      var title = clean(a.textContent);
      var url = abs(a.getAttribute('href'));

      if (!title || !url) return;

      out.push({
        id: url,
        url: url,
        title: title,
        poster: getPoster(el)
      });
    });

    return out;
  }

  var categories = [
    ['/movies', 'أحدث الأفلام'],
    ['/series', 'أحدث المسلسلات'],
    ['/shows', 'العروض'],
    ['/series?section=29', 'مسلسلات عربي'],
    ['/series?section=32', 'مسلسلات تركي'],
    ['/series?section=33', 'مسلسلات آسيوية'],
    ['/series?section=30', 'مسلسلات أجنبي'],
    ['/movies?section=29', 'أفلام عربي'],
    ['/movies?section=32', 'أفلام تركي'],
    ['/movies?section=30', 'أفلام أجنبي']
  ];

  MediaHub.registerProvider({
    id: 'akwam',
    name: 'Akwam',
    fields: [],

    getHome: async function (cfg) {
      var result = [];

      for (var i = 0; i < categories.length; i++) {
        try {
          var cat = categories[i];
          var doc = await getDoc(abs(cat[0]));
          var items = parseCards(doc);

          if (items.length) {
            result.push({
              title: cat[1],
              items: items
            });
          }
        } catch (e) {}
      }

      return result;
    },

    search: async function (cfg, query) {
      var url = new URL('/search', BASE);
      url.searchParams.set('q', query);
      return parseCards(await getDoc(url.href));
    },

    load: async function (cfg, item) {
      var pageUrl = item.url || item.id;
      var doc = await getDoc(pageUrl);

      var titleEl = doc.querySelector('h1.entry-title');
      var title = clean(titleEl && titleEl.textContent) || item.title;

      var descEl = doc.querySelector(
        'meta[name="description"]'
      );

      var desc = descEl ? descEl.content : '';
      var episodes = [];

      var links = doc.querySelectorAll(
        '#series-episodes a[href*="/episode/"]'
      );

      Array.prototype.forEach.call(links, function (a) {
        var url = abs(a.getAttribute('href'), pageUrl);

        episodes.push({
          id: url,
          url: url,
          title: clean(a.textContent) || 'حلقة',
          poster: getPoster(a)
        });
      });

      return {
        title: title,
        poster: item.poster || getPoster(doc),
        desc: clean(desc),
        episodes: episodes
      };
    },

    getLinks: async function (cfg, target) {
      var url = target.url || target.id;
      var doc = await getDoc(url);
      var found = [];
      var pages = [];

      var anchors = doc.querySelectorAll(
        'a[href*="/download/"], a[href*="/watch/"]'
      );

      Array.prototype.forEach.call(anchors, function (a) {
        pages.push(abs(a.getAttribute('href'), url));
      });

      for (var i = 0; i < pages.length; i++) {
        try {
          var page = pages[i];
          var d = await getDoc(page);

          var sources = d.querySelectorAll(
            'source[src], video[src], a[href*=".mp4"], a.link-btn'
          );

          Array.prototype.forEach.call(sources, function (s) {
            var link = s.getAttribute('src') ||
                       s.getAttribute('href') || '';

            if (/^https?:\/\//i.test(link)) {
              found.push({
                url: link,
                label: 'Akwam',
                referer: page
              });
            }
          });
        } catch (e) {}
      }

      return found;
    }
  });
})();
      
