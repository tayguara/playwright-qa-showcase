// Local stand-in for the Restful Booker sandbox, with one optional pre-registered fault.
//
//   FAULT=3 STUB_PORT=4010 node server.mjs
//
// Zero dependencies (node:http). Behaviour follows the dated probe log in FIDELITY.md; the ten
// faults live in faults.mjs. The server binds to 127.0.0.1 only and keeps all state in memory.

import { createHash } from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { FAULTS, createFaultHooks, parseFault } from './faults.mjs';
import {
  INVALID_DATE,
  createStore,
  normalizeBooking,
  normalizeBookingChanges,
  normalizeDate,
} from './store.mjs';

const HOST = '127.0.0.1';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'password123';
const JSON_TYPE = 'application/json; charset=utf-8';
const TEXT_TYPE = 'text/plain; charset=utf-8';

const faultSlug = (fault) => (fault === 0 ? 'clean' : FAULTS[fault - 1].slug);

/** Builds the (not yet listening) HTTP server. Each server has its own store, tokens and counters. */
export function createStubServer({ fault = 0 } = {}) {
  const hooks = createFaultHooks(fault);
  const store = createStore();
  const tokens = new Set();
  let tokensIssued = 0;
  let requests = 0;

  function issueToken() {
    tokensIssued += 1;
    const token = createHash('sha256').update(`token-${tokensIssued}`).digest('hex').slice(0, 15);
    tokens.add(token);
    return token;
  }

  /** Cookie `token=<issued by this process>` or `Authorization: Basic admin:password123`. */
  function isAuthorised(req) {
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const [name, ...value] = part.trim().split('=');
      if (name === 'token' && tokens.has(value.join('='))) return true;
    }
    const authorization = req.headers.authorization ?? '';
    if (authorization.startsWith('Basic ')) {
      const decoded = Buffer.from(authorization.slice(6), 'base64').toString();
      return decoded === `${ADMIN_USERNAME}:${ADMIN_PASSWORD}`;
    }
    return false;
  }

  // The real API negotiates the response type when a handler is about to send a booking (probe
  // P3/P11): the trimmed Accept header must be exactly "application/json" or "*/*". Anything
  // else, including an absent header, is a 418, and the change has already been applied by then.
  // XML (and the form content type) work on the real API; the stub answers 501 instead.
  function acceptFailure(req) {
    const accept = req.headers.accept?.trim();
    if (accept === 'application/json' || accept === '*/*') return undefined;
    if (accept === 'application/xml' || accept === 'application/x-www-form-urlencoded') {
      return { status: 501, text: 'XML not supported by stub' };
    }
    return { status: 418, text: "I'm a Teapot" };
  }

  const send = (res, status, type, body) => {
    res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };
  const sendJson = (res, status, value) => send(res, status, JSON_TYPE, JSON.stringify(value));
  const sendText = (res, status, text) => send(res, status, TEXT_TYPE, text);

  /** Success response that carries a booking: subject to the Accept check (`patch` answers 500). */
  function sendBooking(req, res, value, { patch = false } = {}) {
    const failure = acceptFailure(req);
    if (!failure) return sendJson(res, 200, value);
    if (patch && failure.status === 418) return sendText(res, 500, 'Internal Server Error');
    return sendText(res, failure.status, failure.text);
  }

  /** Dates in search filters use the same parsing as stored dates; an unparseable one is a 500. */
  function dateFilter(value) {
    if (!value) return { value: undefined };
    const normalized = normalizeDate(value);
    return normalized === INVALID_DATE ? { invalid: true } : { value: normalized };
  }

  function handleSearch(url, res) {
    const filters = {};
    if (!hooks.ignoreNameFilters) {
      filters.firstname = url.searchParams.get('firstname') || undefined;
      filters.lastname = url.searchParams.get('lastname') || undefined;
    }
    const checkin = dateFilter(url.searchParams.get('checkin'));
    const checkout = dateFilter(url.searchParams.get('checkout'));
    if (checkin.invalid || checkout.invalid) return sendText(res, 500, 'Internal Server Error');
    filters.checkin = checkin.value;
    filters.checkout = checkout.value;
    return sendJson(
      res,
      200,
      store.list(filters).map((bookingid) => ({ bookingid })),
    );
  }

  function handleAuth(body, res) {
    const credentials = body !== null && typeof body === 'object' ? body : {};
    const valid =
      credentials.username === ADMIN_USERNAME && credentials.password === ADMIN_PASSWORD;
    if (valid || hooks.acceptAnyCredentials) return sendJson(res, 200, { token: issueToken() });
    return sendJson(res, 200, { reason: 'Bad credentials' });
  }

  function handleCreate(req, res, body) {
    const result = normalizeBooking(body);
    if (!result.ok) return sendText(res, 500, 'Internal Server Error');
    const bookingid = store.create(result.booking);
    return sendBooking(req, res, {
      bookingid,
      booking: hooks.serializeBooking(result.booking),
    });
  }

  function handleBookingById(req, res, id, body) {
    const existing = store.get(id);
    const { method } = req;

    if (method === 'GET') {
      if (!existing) return sendText(res, 404, 'Not Found');
      return sendBooking(req, res, hooks.serializeBooking(hooks.readBooking(existing)));
    }

    // PUT, PATCH and DELETE: auth first, then the id (so a missing id without auth is a 403).
    const needsAuth = method === 'PUT' ? hooks.putRequiresAuth : true;
    if (needsAuth && !isAuthorised(req)) return sendText(res, 403, 'Forbidden');
    if (!existing) return sendText(res, 405, 'Method Not Allowed');

    if (method === 'DELETE') {
      if (hooks.deleteRemoves) store.remove(id);
      return sendText(res, 201, 'Created');
    }

    if (method === 'PUT') {
      const result = normalizeBooking(body);
      if (!result.ok) return sendText(res, 400, 'Bad Request');
      const replacement = result.booking;
      // Probe P7: a PUT without additionalneeds keeps the stored value.
      if (!('additionalneeds' in replacement) && 'additionalneeds' in existing) {
        replacement.additionalneeds = existing.additionalneeds;
      }
      store.replace(id, replacement);
      return sendBooking(req, res, hooks.serializeBooking(replacement));
    }

    // PATCH
    const merged = hooks.applyPatch(existing, normalizeBookingChanges(body));
    store.replace(id, merged);
    return sendBooking(req, res, hooks.serializeBooking(merged), { patch: true });
  }

  function route(req, res, url, body) {
    // Express ignores one trailing slash; the real API does too.
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;
    const { method } = req;

    if ((method === 'GET' || method === 'HEAD') && path === '/ping') {
      return sendText(res, 201, 'Created');
    }
    if (method === 'POST' && path === '/auth') return handleAuth(body, res);
    if (method === 'POST' && path === '/booking') return handleCreate(req, res, body);
    if (method === 'GET' && path === '/booking') return handleSearch(url, res);

    const match = /^\/booking\/([^/]+)$/.exec(path);
    if (match && ['GET', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      // Only plain decimal ids exist; anything else behaves like an unknown id (see FIDELITY gaps).
      const id = /^\d+$/.test(match[1]) ? Number(match[1]) : NaN;
      return handleBookingById(req, res, id, body);
    }
    return sendText(res, 404, 'Not Found');
  }

  async function handle(req, res) {
    const url = new URL(req.url, `http://${HOST}`);

    // The control endpoint is not counted and no fault applies to it.
    if (url.pathname.startsWith('/__stub/')) {
      if (req.method === 'GET' && url.pathname === '/__stub/health') {
        return sendJson(res, 200, { fault, slug: faultSlug(fault), requests });
      }
      return sendText(res, 404, 'Not Found');
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);

    requests += 1;
    if (hooks.shouldFailRequest()) return sendText(res, 500, 'Internal Server Error');

    // JSON bodies only; a missing body (or any other content type) counts as `{}`.
    let body = {};
    const raw = Buffer.concat(chunks).toString();
    if (raw !== '' && (req.headers['content-type'] ?? '').includes('json')) {
      try {
        body = JSON.parse(raw);
      } catch {
        return sendText(res, 400, 'Bad Request');
      }
    }
    return route(req, res, url, body);
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      // A bug in a handler must not take the whole stub down: log it and answer 500.
      console.error(error);
      if (!res.headersSent) sendText(res, 500, 'Internal Server Error');
      else res.end();
    });
  });
}

/** Starts the stub on `host:port` (port 0 picks a free one). Resolves once it is listening. */
export async function startStub({ port = 0, host = HOST, fault = 0 } = {}) {
  if (host !== HOST) throw new Error(`The stub binds to ${HOST} only, got ${host}`);
  const server = createStubServer({ fault });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const { port: boundPort } = server.address();
  return {
    url: `http://${host}:${boundPort}`,
    port: boundPort,
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      });
    },
  };
}

// ---- CLI entry (runs only when this file is executed directly) -------------------------------------

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  let fault;
  try {
    fault = parseFault(process.env.FAULT);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const port = Number(process.env.STUB_PORT ?? 4010);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid STUB_PORT ${JSON.stringify(process.env.STUB_PORT)}`);
    process.exit(1);
  }

  const stub = await startStub({ port, fault });
  console.log(`restful-booker stub on ${stub.url} fault=${fault} (${faultSlug(fault)})`);

  const shutdown = () => {
    stub.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
