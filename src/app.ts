/**
 * Fastify server, OpenAPI docs and interactive web UI for the Brainfuck URL encoder / decoder.
 */

import { readFileSync } from 'node:fs';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { UrlEngine } from './engine.ts';

export const APP_ID = 'bff-url-encoder-decoder';
export const VERSION = '1.0.0';

export interface AppOptions {
  /** Disable API processing and the OpenAPI docs (client-side VM only). */
  disableBackend?: boolean;
  engine?: UrlEngine;
  logger?: boolean;
}

/** Accepts `text`, `payload` or `content` as the input field, like the original API. */
interface ProcessBody {
  text?: string;
  payload?: string;
  content?: string;
  direction?: string;
}

const processBodySchema = {
  anyOf: [
    { type: 'string', description: 'Raw text body (any non-JSON content type)' },
    {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Input string to encode or decode' },
        payload: { type: 'string', description: 'Alternative field for input text' },
        content: { type: 'string', description: 'Alternative field for input text' },
      },
    },
  ],
} as const;

const resultSchema = {
  type: 'object',
  properties: {
    direction: { type: 'string', enum: ['encode', 'decode'], description: "'encode' or 'decode'" },
    source: { type: 'string', description: 'Original input string' },
    result: { type: 'string', description: 'Processed output string' },
    escaped_count: { type: 'integer', description: 'Count of percent escapes in result or source' },
    character_count: { type: 'integer', description: 'Length of source input' },
  },
} as const;

const errorSchema = {
  type: 'object',
  properties: { detail: { type: 'string' } },
} as const;

const errorResponses = { 400: errorSchema, 422: errorSchema, 503: errorSchema } as const;

function extractText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    const b = body as ProcessBody;
    return b.text || b.payload || b.content || '';
  }
  return '';
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const disableBackend = options.disableBackend ?? false;
  const engine = options.engine ?? new UrlEngine();
  const indexTemplate = readFileSync(new URL('./index.html', import.meta.url), 'utf-8');

  const app = Fastify({ logger: options.logger ?? false });

  // Any non-JSON content type is treated as UTF-8 text (invalid bytes become U+FFFD).
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, (body as Buffer).toString('utf-8'));
  });

  // Keep the `{ "detail": "..." }` error shape the web UI and API clients rely on.
  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const detail = status === 400 && /json/i.test(error.message) ? `Invalid JSON body: ${error.message}` : error.message;
    void reply.status(status).send({ detail });
  });

  if (!disableBackend) {
    await app.register(fastifySwagger, {
      openapi: {
        info: {
          title: 'Brainfuck URL Percent-Encoder / Decoder',
          description:
            'Microservice providing bidirectional URL percent-encoding and decoding using pure Brainfuck state machines.',
          version: VERSION,
        },
      },
    });
    await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
    app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  }

  const guard = () => {
    if (disableBackend) {
      throw Object.assign(new Error('Backend API processing is disabled (DISABLE_BACKEND=true).'), {
        statusCode: 503,
      });
    }
  };

  const unprocessable = (label: string, err: unknown) =>
    Object.assign(new Error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`), {
      statusCode: 422,
    });

  app.get(
    '/health',
    {
      schema: {
        summary: 'Health status',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              app: { type: 'string' },
              engine: { type: 'string' },
              version: { type: 'string' },
              backend_enabled: { type: 'boolean' },
            },
          },
        },
      },
    },
    async () => ({
      status: 'ok',
      app: APP_ID,
      engine: 'brainfuck',
      version: VERSION,
      backend_enabled: !disableBackend,
    }),
  );

  app.get<{ Querystring: { include_code: boolean } }>(
    '/bf',
    {
      schema: {
        summary: 'Brainfuck engine metadata',
        description: 'Returns metadata, instruction counts, and source code for both Brainfuck engines.',
        querystring: {
          type: 'object',
          properties: { include_code: { type: 'boolean', default: true } },
        },
      },
    },
    async (req) => engine.getBfInfo(req.query.include_code),
  );

  app.get(
    '/bf/encode',
    { schema: { summary: 'Encoder source', description: 'Raw Brainfuck source of the URL percent-encoder.', produces: ['text/plain'] } },
    async (_req, reply) => reply.type('text/plain; charset=utf-8').send(engine.codeEncode),
  );

  app.get(
    '/bf/decode',
    { schema: { summary: 'Decoder source', description: 'Raw Brainfuck source of the URL percent-decoder.', produces: ['text/plain'] } },
    async (_req, reply) => reply.type('text/plain; charset=utf-8').send(engine.codeDecode),
  );

  app.post(
    '/encode',
    {
      schema: {
        summary: 'Percent-encode text',
        body: processBodySchema,
        response: { 200: resultSchema, ...errorResponses },
      },
    },
    async (req) => {
      guard();
      try {
        return engine.encode(extractText(req.body));
      } catch (err) {
        throw unprocessable('Encoding', err);
      }
    },
  );

  app.post(
    '/decode',
    {
      schema: {
        summary: 'Percent-decode text',
        body: processBodySchema,
        response: { 200: resultSchema, ...errorResponses },
      },
    },
    async (req) => {
      guard();
      try {
        return engine.decode(extractText(req.body));
      } catch (err) {
        throw unprocessable('Decoding', err);
      }
    },
  );

  app.post(
    '/process',
    {
      schema: {
        summary: 'Auto-detect direction and process',
        description: "Uses `direction` ('encode', 'decode' or 'auto'); auto decodes when the input contains '%'.",
        body: {
          anyOf: [
            processBodySchema.anyOf[0],
            {
              ...processBodySchema.anyOf[1],
              properties: {
                ...processBodySchema.anyOf[1].properties,
                direction: { type: 'string', description: "'encode', 'decode', or 'auto' (default)" },
              },
            },
          ],
        },
        response: { 200: resultSchema, ...errorResponses },
      },
    },
    async (req) => {
      guard();
      const direction = req.body && typeof req.body === 'object' ? (req.body as ProcessBody).direction : undefined;
      try {
        return engine.autoProcess(extractText(req.body), direction);
      } catch (err) {
        throw unprocessable('Processing', err);
      }
    },
  );

  app.get('/', { schema: { hide: true } }, async (_req, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .send(
        indexTemplate
          .replace('__BF_ENCODE__', () => JSON.stringify(engine.codeEncode))
          .replace('__BF_DECODE__', () => JSON.stringify(engine.codeDecode)),
      ),
  );

  return app;
}
