import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createTokenVerifier } from '../dist/index.js';

test('JWKS verifica firma, claims, algoritmo y claves rotadas', async () => {
  const first = await generateKeyPair('RS256');
  const second = await generateKeyPair('RS256');
  const firstJwk = { ...(await exportJWK(first.publicKey)), kid: 'first', alg: 'RS256' };
  const secondJwk = { ...(await exportJWK(second.publicKey)), kid: 'second', alg: 'RS256' };
  let keys = [firstJwk];
  const server = createServer((_, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ keys }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const jwksURL = `http://127.0.0.1:${server.address().port}/jwks`;
  const verify = createTokenVerifier({ jwksURL, issuer: 'issuer', audience: 'services' });
  const sign = (payload = {}, header = {}, key = first.privateKey) =>
    new SignJWT({
      sub: 'buyer',
      role: 'user',
      iss: 'issuer',
      aud: 'services',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      ...payload,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'first', ...header })
      .sign(key);
  try {
    assert.deepEqual(await verify(`Bearer ${await sign()}`), { sub: 'buyer', role: 'user' });
    assert.equal(await verify(null), null);
    for (const payload of [
      { iss: 'other' },
      { aud: 'other' },
      { exp: 1 },
      { nbf: 9999999999 },
      { sub: '' },
      { sub: undefined },
      { role: 'owner' },
    ]) {
      assert.equal(await verify(`Bearer ${await sign(payload)}`), null);
    }
    assert.equal(await verify(`Bearer ${await sign({}, { kid: undefined })}`), null);
    assert.equal(await verify(`Bearer ${await sign({}, { kid: 'missing' })}`), null);
    assert.equal(await verify(`Bearer ${await sign({}, {}, second.privateKey)}`), null);
    assert.equal(await verify('Bearer broken'), null);
    const hs = await new SignJWT({ sub: 'buyer' })
      .setProtectedHeader({ alg: 'HS256', kid: 'first' })
      .sign(new Uint8Array(32));
    assert.equal(await verify(`Bearer ${hs}`), null);
    // Introduce a new kid after the initial JWKS was cached.
    keys = [firstJwk, secondJwk];
    await new Promise((resolve) => setTimeout(resolve, 5100));
    // Rotation overlap: both the retired and current kid remain usable.
    assert.deepEqual(
      await verify(`Bearer ${await sign({}, { kid: 'second' }, second.privateKey)}`),
      { sub: 'buyer', role: 'user' },
    );
    keys = [secondJwk];
    const refreshed = createTokenVerifier({ jwksURL, issuer: 'issuer', audience: 'services' });
    assert.equal(await refreshed(`Bearer ${await sign()}`), null);
    assert.deepEqual(
      await refreshed(`Bearer ${await sign({}, { kid: 'second' }, second.privateKey)}`),
      { sub: 'buyer', role: 'user' },
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
