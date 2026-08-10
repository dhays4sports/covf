(() => {
  'use strict';
  const VERSION = '1.0.0';
  const BUILD = '408-CRO-1.6.2.1';
  const title = 'You’re already narrowing the coverage questions most worth checking.';
  const copy = 'Finish your Snapshot to see your strongest areas and the first discussion priorities to bring to Dylan.';

  function apply() {
    if (document.documentElement.dataset.professionalIntent === 'true') return false;
    const early = document.getElementById('earlyInsight');
    if (!early || early.hidden) return false;
    const titleNode = document.getElementById('earlyInsightTitle');
    const copyNode = document.getElementById('earlyInsightCopy');
    if (titleNode) titleNode.textContent = title;
    if (copyNode) copyNode.textContent = copy;
    return true;
  }

  apply();
  const early = document.getElementById('earlyInsight');
  if (early && typeof MutationObserver === 'function') {
    new MutationObserver(apply).observe(early, {
      attributes: true,
      attributeFilter: ['hidden', 'style', 'class'],
      childList: true,
      subtree: true
    });
  }

  window.CoverageFitIntentPayoff = Object.freeze({ VERSION, BUILD, apply });
})();
