(function () {
  'use strict';

  function ensureStylesheet() {
    var link = document.getElementById('irpa-hero-fix-css');
    if (!link) {
      link = document.createElement('link');
      link.id = 'irpa-hero-fix-css';
      link.rel = 'stylesheet';
      link.href = '/dashboard-hero-fix.css?v=20261012';
      document.head.appendChild(link);
    }
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

    ensureStylesheet();

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
    try { apply(); } catch (e) { console.warn('IRPA hero fix:', e); }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(run, 150); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
  window.addEventListener('hashchange', schedule);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
})();