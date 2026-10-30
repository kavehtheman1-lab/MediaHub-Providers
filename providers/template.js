/* MediaHub provider template
 * Required: id, name, getHome, search, load, getLinks
 * getHome returns [{ title: 'Section', items: [{id,title,poster,url}] }]
 * load returns { title, poster, desc, episodes: [{id,title,url}] }
 * getLinks returns [{ url, label, referer? }]
 */
(function () {
  MediaHub.registerProvider({
    id: 'provider-id',
    name: 'Provider name',
    fields: [],
    getHome: async function (cfg) { return []; },
    search: async function (cfg, query) { return []; },
    load: async function (cfg, item) { return { title: item.title, desc: '', episodes: [] }; },
    getLinks: async function (cfg, target) { return []; }
  });
})();
