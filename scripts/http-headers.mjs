// Shared by local/container hosting and the generated Vercel deployment.
export const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};
