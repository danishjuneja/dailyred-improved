// Vercel's framework-free Web Analytics integration. Keep initialization in
// an external file so the site's CSP does not need unsafe-inline.
if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
  window.va = window.va || function (...args) {
    (window.vaq = window.vaq || []).push(args);
  };
  const script = document.createElement('script');
  script.defer = true;
  script.src = '/_vercel/insights/script.js';
  document.head.append(script);
}
