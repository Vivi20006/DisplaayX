// Runs synchronously in <head>: enables JS-only styles and decides whether the intro plays
// (home page only, once per browser session; ?intro forces it; never with reduced motion).
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  try {
    if (root.hasAttribute('data-intro') &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches &&
        (/[?&]intro\b/.test(location.search) || !sessionStorage.getItem('dx.intro'))) {
      root.classList.add('intro-pending');
    }
  } catch (e) { /* storage blocked: just show the page */ }
})();
