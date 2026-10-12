(function () {
  'use strict';

  var CSS = [
    '[data-irpa-hero]{display:flex!important;flex-direction:row!important;align-items:stretch!important;gap:0!important;flex-wrap:nowrap!important}',
    '[data-irpa-title]{flex:0 0 auto!important;max-width:28%!important;margin-right:16px!important;align-self:center!important}',
    '[data-irpa-weather]{flex:1 1 auto!important;min-width:0!important;width:auto!important;max-width:none!important;align-self:stretch!important;margin:0!important;border-radius:14px 0 0 14px!important;display:flex!important;flex-direction:row!important;flex-wrap:wrap!important;align-content:center!important;justify-content:space-between!important;align-items:center!important;gap:10px 24px!important;padding:14px 18px!important;min-height:0!important;height:auto!important;box-sizing:border-box!important}',
    '[data-irpa-weather] *{color:#1565c0!important}',
    '[data-irpa-weather] > *{flex:1 1 auto!important;min-width:0!important}',
    '[data-irpa-weather] [data-irpa-forecast]{display:flex!important;flex-direction:row!important;flex-wrap:wrap!important;gap:10px!important;flex:1 1 100%!important}',
    '[data-irpa-access]{flex:0 0 300px!important;width:300px!important;max-width:300px!important;margin:0!important;border-radius:0 14px 14px 0!important;background:#2a2018!important;border:1px solid #6b5420!important;box-sizing:border-box!important}',
    '[data-irpa-access],[data-irpa-access] *{color:#ffffff!important;background-image:none!important}',
    '[data-irpa-access] *{background-color:transparent!important;border-color:#8a6d1f!important;box-shadow:none!important}',
    '[data-irpa-access] h1,[data-irpa-access] h2,[data-irpa-access] h3,[data-irpa-access] h4,[data-irpa-access] strong,[data-irpa-access] b,[data-irpa-access] [class*="label"],[data-irpa-access] [class*="badge"],[data-irpa-access] [class*="chip"],[data-irpa-access] [class*="pill"]{color:#f5c542!important}',
    '@media(max-width:900px){[data-irpa-hero]{flex-direction:column!important}[data-irpa-title],[data-irpa-weather],[data-irpa-access]{max-width:100%!important;width:100%!important;flex:1 1 auto!important;border-radius:14px!important;margin:0 0 12px 0!important}}'
  ].join('\n');

  function injectCSS() {
    var s = document.getElementById('irpa-hero-fix-css');
    if (!s) {
      s = document.createElement('style');
      s.id = 'irpa-hero-fix-css';
      document.head.appendChild(s);
    }
    if (s.textContent !== CSS) s.textContent = CSS;
  }

  function findByText(re) {
    var best = null, bestLen = 1e9;
    var all = document.body.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
      var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length < bestLen && re.test(t)) { best = el; bestLen = t.length; }
    }
    return best;
  }

  function childOf(parent, node) {
    while (node && node.parentElement !== parent) node = node.parentElement;
    return node;
  }

  function commonAncestor(a, b) {
    var p = a;
    while (p && !p.contains(b)) p = p.parentElement;
    return p;
  }

  function apply() {
    var w = findByText(/^live weather\b/i);
    var a = findByText(/^authori[sz]ed user\b.*access/i);
    var t = findByText(/improvement of rangeland/i);
    if (!w || !a) return;

    var hero = commonAncestor(w, a);
    if (!hero || hero === document.body) return;

    var wCol = childOf(hero, w);
    var aCol = childOf(hero, a);
    var tCol = t ? childOf(hero, t) : null;
    if (!wCol || !aCol || wCol === aCol) return;

    if (wCol.nextElementSibling !== aCol) hero.insertBefore(wCol, aCol);

    hero.setAttribute('data-irpa-hero', '');
    wCol.setAttribute('data-irpa-weather', '');
    aCol.setAttribute('data-irpa-access', '');
    if (tCol && tCol !== wCol && tCol !== aCol) tCol.setAttribute('data-irpa-title', '');

    var f = findByText(/^forecast\b.*\\d/i);
    if (f && wCol.contains(f) && f !== wCol) {
      var fc = f.parentElement && f.parentElement !== wCol ? f.parentElement : f;
      fc.setAttribute('data-irpa-forecast', '');
    }
  }

  var timer = null;
  function run() {
    try { injectCSS(); apply(); } catch (e) { console.warn('IRPA hero fix:', e); }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(run, 150); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
  window.addEventListener('hashchange', schedule);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
})();