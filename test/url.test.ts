/**
 * Tests for the Brainfuck URL percent-encoder & decoder:
 * the pure Brainfuck state machines, round-trips, the compiler output and the HTTP API.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { compileUrlDecoder, compileUrlEncoder } from '../src/compiler.ts';
import { UrlEngine } from '../src/engine.ts';

const engine = new UrlEngine();

/** Reference RFC 3986 encoder for single-byte (ASCII) input. */
function referenceEncode(text: string): string {
  return [...text]
    .map((c) => (/[A-Za-z0-9\-_.~]/.test(c) ? c : `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`))
    .join('');
}

describe('URL encoder (Brainfuck)', () => {
  it('passes unreserved characters through', () => {
    const unreserved = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~';
    const res = engine.encode(unreserved);
    assert.equal(res.result, unreserved);
    assert.equal(res.escaped_count, 0);
  });

  it('encodes spaces', () => {
    const res = engine.encode('hello world');
    assert.equal(res.result, 'hello%20world');
    assert.equal(res.escaped_count, 1);
  });

  it('encodes URL delimiters', () => {
    const res = engine.encode('https://example.com/test?a=1&b=2#sec');
    assert.equal(res.result, 'https%3A%2F%2Fexample.com%2Ftest%3Fa%3D1%26b%3D2%23sec');
    assert.equal(res.escaped_count, 9);
  });

  it('encodes symbols', () => {
    assert.equal(engine.encode('price=$100').result, 'price%3D%24100');
  });

  it('handles the empty string', () => {
    const res = engine.encode('');
    assert.equal(res.result, '');
    assert.equal(res.escaped_count, 0);
  });

  it('matches the reference encoder for every ASCII character', () => {
    const all = Array.from({ length: 127 }, (_, i) => String.fromCharCode(i + 1)).join('');
    assert.equal(engine.encode(all).result, referenceEncode(all));
  });

  it('encodes UTF-8 multi-byte characters byte by byte', () => {
    assert.equal(engine.encode('é€').result, '%C3%A9%E2%82%AC');
    assert.equal(engine.encode('é€').character_count, 2);
  });
});

describe('URL decoder (Brainfuck)', () => {
  it('decodes %20', () => assert.equal(engine.decode('hello%20world').result, 'hello world'));
  it('decodes + as space', () => assert.equal(engine.decode('hello+world').result, 'hello world'));
  it('decodes uppercase hex', () => assert.equal(engine.decode('a%2Bb%3Dc%26x%3D1%202').result, 'a+b=c&x=1 2'));
  it('decodes lowercase hex', () => assert.equal(engine.decode('a%2bb%3dc%26x%3d1%202').result, 'a+b=c&x=1 2'));
  it('passes plain text through', () => assert.equal(engine.decode('plain_text-123.test~').result, 'plain_text-123.test~'));
  it('handles the empty string', () => assert.equal(engine.decode('').result, ''));
  it('decodes UTF-8 sequences', () => assert.equal(engine.decode('%C3%A9%E2%82%AC').result, 'é€'));
});

describe('round-trips', () => {
  for (const sample of [
    'https://api.github.com/repos/google/deepmind/issues?state=open&sort=created',
    "SELECT * FROM users WHERE name = 'Alice' AND age > 25;",
    '{"name": "Bob", "email": "bob@example.com", "active": true}',
    'Path/With/Special#Chars: !@$^&*()+=[]',
    'unicode: é€😀',
  ]) {
    it(sample.slice(0, 40), () => {
      assert.equal(engine.decode(engine.encode(sample).result).result, sample);
    });
  }
});

describe('compiler', () => {
  const stripped = (file: string) => readFileSync(new URL(`../bf/${file}`, import.meta.url), 'utf-8').replace(/[^><+\-.,[\]]/g, '');

  it('regenerates bf/url_encode.bf exactly', () => assert.equal(compileUrlEncoder(), stripped('url_encode.bf')));
  it('regenerates bf/url_decode.bf exactly', () => assert.equal(compileUrlDecoder(), stripped('url_decode.bf')));
});

describe('autoProcess', () => {
  it('detects direction', () => {
    assert.equal(engine.autoProcess('hello world').direction, 'encode');
    assert.equal(engine.autoProcess('hello%20world').direction, 'decode');
  });

  it('rejects unknown directions', () => {
    assert.throws(() => engine.autoProcess('x', 'sideways'), /Unsupported direction: sideways/);
  });
});

describe('HTTP API', () => {
  let app: FastifyInstance;
  before(async () => {
    app = await buildApp({ engine });
  });
  after(async () => {
    await app.close();
  });

  const json = (r: { json: () => unknown }) => r.json() as Record<string, any>;

  it('GET /health', async () => {
    const res = await app.inject('/health');
    assert.equal(res.statusCode, 200);
    const data = json(res);
    assert.equal(data.status, 'ok');
    assert.equal(data.app, 'bff-url-encoder-decoder');
    assert.equal(data.engine, 'brainfuck');
    assert.equal(data.backend_enabled, true);
  });

  it('GET / serves the web UI with the Brainfuck sources inlined', async () => {
    const res = await app.inject('/');
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] as string, /text\/html/);
    assert.ok(res.body.includes('URL Percent-Encoder & Decoder'));
    assert.ok(!res.body.includes('__BF_ENCODE__'));
    assert.ok(res.body.includes(JSON.stringify(engine.codeEncode)));
  });

  it('POST /encode (json)', async () => {
    const res = await app.inject({ method: 'POST', url: '/encode', payload: { text: 'hello world' } });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).result, 'hello%20world');
  });

  it('POST /encode (alternative fields)', async () => {
    for (const field of ['payload', 'content']) {
      const res = await app.inject({ method: 'POST', url: '/encode', payload: { [field]: 'a b' } });
      assert.equal(json(res).result, 'a%20b');
    }
  });

  it('POST /encode (text/plain)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/encode', payload: 'foo@bar.com', headers: { 'content-type': 'text/plain' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).result, 'foo%40bar.com');
  });

  it('POST /decode (json and text/plain)', async () => {
    const a = await app.inject({ method: 'POST', url: '/decode', payload: { text: 'hello%20world' } });
    assert.equal(json(a).result, 'hello world');
    const b = await app.inject({
      method: 'POST', url: '/decode', payload: 'foo%40bar.com', headers: { 'content-type': 'text/plain' },
    });
    assert.equal(json(b).result, 'foo@bar.com');
  });

  it('POST /process auto-detects direction', async () => {
    const enc = await app.inject({ method: 'POST', url: '/process', payload: { text: 'hello world' } });
    assert.equal(json(enc).direction, 'encode');
    assert.equal(json(enc).result, 'hello%20world');
    const dec = await app.inject({ method: 'POST', url: '/process', payload: { text: 'hello%20world' } });
    assert.equal(json(dec).direction, 'decode');
    assert.equal(json(dec).result, 'hello world');
  });

  it('POST /process honors an explicit direction and rejects bad ones', async () => {
    const ok = await app.inject({ method: 'POST', url: '/process', payload: { text: 'a%20b', direction: 'encode' } });
    assert.equal(json(ok).result, 'a%2520b');
    const bad = await app.inject({ method: 'POST', url: '/process', payload: { text: 'x', direction: 'nope' } });
    assert.equal(bad.statusCode, 422);
    assert.match(json(bad).detail, /Processing failed: Unsupported direction: nope/);
  });

  it('returns 400 with a detail message for invalid JSON', async () => {
    const res = await app.inject({
      method: 'POST', url: '/encode', payload: '{not json', headers: { 'content-type': 'application/json' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(typeof json(res).detail, 'string');
  });

  it('GET /bf returns metadata and optionally omits the code', async () => {
    const data = json(await app.inject('/bf'));
    assert.ok(data.url_encode.length > 1000);
    assert.ok(data.url_decode.length > 1000);
    assert.ok([...'><+-.,[]'].every((op) => op in data.url_encode.op_counts));
    assert.equal(typeof data.url_encode.code, 'string');
    const slim = json(await app.inject('/bf?include_code=false'));
    assert.equal('code' in slim.url_encode, false);
  });

  it('GET /bf/encode and /bf/decode return raw Brainfuck', async () => {
    for (const path of ['/bf/encode', '/bf/decode']) {
      const res = await app.inject(path);
      assert.equal(res.statusCode, 200);
      assert.match(res.headers['content-type'] as string, /text\/plain/);
      assert.ok(res.body.length > 1000);
      assert.match(res.body, /^[><+\-.,[\] \r\n]+$/);
    }
  });

  it('serves OpenAPI at /openapi.json and Swagger UI at /docs', async () => {
    const spec = json(await app.inject('/openapi.json'));
    assert.ok(spec.paths['/encode'].post);
    assert.ok(spec.paths['/decode'].post);
    assert.equal(spec.info.version, '1.0.0');
    const docs = await app.inject('/docs/');
    assert.equal(docs.statusCode, 200);
    assert.match(docs.body, /swagger/i);
  });
});

describe('DISABLE_BACKEND', () => {
  it('returns 503 for processing and hides the docs', async () => {
    const app = await buildApp({ engine, disableBackend: true });
    const res = await app.inject({ method: 'POST', url: '/encode', payload: { text: 'x' } });
    assert.equal(res.statusCode, 503);
    assert.match(res.json().detail, /DISABLE_BACKEND/);
    assert.equal((await app.inject('/openapi.json')).statusCode, 404);
    assert.equal((await app.inject('/health')).json().backend_enabled, false);
    await app.close();
  });
});
