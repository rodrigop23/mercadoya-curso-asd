// Solo para el smoke de Kong. La suite polar-saga prueba los desenlaces de pago.
// Catalog conserva su worker real y recibe un fallo de autorización determinista.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname === 'sandbox-api.polar.sh')
    return Promise.resolve(Response.json({ detail: 'CI: no Polar credentials' }, { status: 401 }));
  return originalFetch(input, init);
};
