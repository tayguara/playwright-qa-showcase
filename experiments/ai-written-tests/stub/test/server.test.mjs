import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { after, describe, test } from 'node:test';
import { FAULTS } from '../faults.mjs';
import { SEED_BOOKINGS } from '../store.mjs';
import { startStub } from '../server.mjs';

// ---- helpers ---------------------------------------------------------------------------------

const stubs = [];

/** Starts a stub on a free port; every stub is closed after the whole file. */
async function stub(fault = 0) {
  const started = await startStub({ port: 0, fault });
  stubs.push(started);
  return started;
}
after(async () => {
  await Promise.all(stubs.map((s) => s.close()));
});

const JSON_TYPE = 'application/json; charset=utf-8';
const TEXT_TYPE = 'text/plain; charset=utf-8';

// fetch wrapper: the default Accept header is "*/*", as Playwright and Node's fetch send it.
async function call(s, method, path, { body, headers = {}, raw } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = raw ? body : JSON.stringify(body);
    init.headers['content-type'] ??= 'application/json';
  }
  const response = await fetch(s.url + path, init);
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, type: response.headers.get('content-type'), text, json };
}

/** node:http request, for cases that need full control of headers (no Accept at all). */
function rawCall(s, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(s.url + path, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          type: res.headers['content-type'],
          text: Buffer.concat(chunks).toString(),
        }),
      );
    });
    req.on('error', reject);
    req.end(body);
  });
}

const booking = (overrides = {}) => ({
  firstname: 'Ana',
  lastname: 'Silva',
  totalprice: 150,
  depositpaid: true,
  bookingdates: { checkin: '2030-05-01', checkout: '2030-05-04' },
  additionalneeds: 'Breakfast',
  ...overrides,
});

async function login(s) {
  const response = await call(s, 'POST', '/auth', {
    body: { username: 'admin', password: 'password123' },
  });
  return response.json.token;
}
const cookie = (token) => ({ cookie: `token=${token}` });
const basic = (user = 'admin', pass = 'password123') => ({
  authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
});

async function create(s, payload = booking()) {
  const response = await call(s, 'POST', '/booking', { body: payload });
  assert.equal(response.status, 200);
  return response.json.bookingid;
}

// ---- clean contract (spec 2.4) -----------------------------------------------------------------

describe('process basics', () => {
  test('binds to 127.0.0.1 only', async () => {
    const s = await stub();
    assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(s.port > 0);
    await assert.rejects(startStub({ host: '0.0.0.0' }), /127\.0\.0\.1/);
  });

  test('health reports fault, slug and a request count that ignores /__stub/ paths', async () => {
    const s = await stub();
    const first = await call(s, 'GET', '/__stub/health');
    assert.equal(first.status, 200);
    assert.equal(first.type, JSON_TYPE);
    assert.deepEqual(first.json, { fault: 0, slug: 'clean', requests: 0 });

    await call(s, 'GET', '/ping');
    await call(s, 'GET', '/nope');
    await call(s, 'GET', '/__stub/health');
    assert.equal((await call(s, 'GET', '/__stub/health')).json.requests, 2);
  });

  test('health names the active fault', async () => {
    const s = await stub(3);
    assert.deepEqual((await call(s, 'GET', '/__stub/health')).json, {
      fault: 3,
      slug: 'patch-changes-unsent-fields',
      requests: 0,
    });
  });

  test('unknown /__stub/ paths and unknown routes answer 404 text', async () => {
    const s = await stub();
    for (const [method, path] of [
      ['GET', '/__stub/other'],
      ['GET', '/'],
      ['GET', '/nope'],
      ['POST', '/ping'],
      ['GET', '/auth'],
      ['PUT', '/booking'],
      ['DELETE', '/booking'],
      ['POST', '/booking/1'],
    ]) {
      const response = await call(s, method, path);
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.equal(response.type, TEXT_TYPE);
      assert.equal(response.text, 'Not Found');
    }
  });

  test('a trailing slash on a booking path is accepted', async () => {
    const s = await stub();
    assert.equal((await call(s, 'GET', '/booking/1/')).status, 200);
  });
});

describe('GET /ping', () => {
  test('answers 201 text "Created"', async () => {
    const s = await stub();
    const response = await call(s, 'GET', '/ping');
    assert.deepEqual([response.status, response.type, response.text], [201, TEXT_TYPE, 'Created']);
  });

  test('HEAD answers 201 too', async () => {
    const s = await stub();
    assert.equal((await call(s, 'HEAD', '/ping')).status, 201);
  });
});

describe('POST /auth', () => {
  test('good credentials give a 15-hex token, deterministic per process', async () => {
    const s = await stub();
    const first = await call(s, 'POST', '/auth', {
      body: { username: 'admin', password: 'password123' },
    });
    assert.equal(first.status, 200);
    assert.equal(first.type, JSON_TYPE);
    assert.match(first.json.token, /^[0-9a-f]{15}$/);
    assert.equal(
      first.json.token,
      createHash('sha256').update('token-1').digest('hex').slice(0, 15),
    );

    const second = await call(s, 'POST', '/auth', {
      body: { username: 'admin', password: 'password123' },
    });
    assert.equal(
      second.json.token,
      createHash('sha256').update('token-2').digest('hex').slice(0, 15),
    );
  });

  test('bad credentials answer 200 with a reason', async () => {
    const s = await stub();
    for (const body of [
      { username: 'admin', password: 'nope' },
      { username: 'other', password: 'password123' },
      { username: 'admin' },
      {},
    ]) {
      const response = await call(s, 'POST', '/auth', { body });
      assert.equal(response.status, 200);
      assert.deepEqual(response.json, { reason: 'Bad credentials' });
    }
  });

  test('an empty body also answers Bad credentials', async () => {
    const s = await stub();
    const response = await call(s, 'POST', '/auth');
    assert.deepEqual([response.status, response.json], [200, { reason: 'Bad credentials' }]);
  });

  test('is not subject to the Accept check', async () => {
    const s = await stub();
    const response = await call(s, 'POST', '/auth', {
      body: { username: 'admin', password: 'password123' },
      headers: { accept: 'text/html' },
    });
    assert.equal(response.status, 200);
  });
});

describe('POST /booking', () => {
  test('stores a valid booking and answers { bookingid, booking }; ids continue after the seed', async () => {
    const s = await stub();
    const first = await call(s, 'POST', '/booking', { body: booking() });
    assert.equal(first.status, 200);
    assert.equal(first.type, JSON_TYPE);
    assert.deepEqual(first.json, { bookingid: 11, booking: booking() });
    const second = await call(s, 'POST', '/booking', { body: booking({ firstname: 'Bea' }) });
    assert.equal(second.json.bookingid, 12);
  });

  test('keeps the canonical key order and drops unknown fields', async () => {
    const s = await stub();
    const response = await call(s, 'POST', '/booking', {
      body: {
        foo: 'bar',
        additionalneeds: 'Late',
        bookingdates: { checkout: '2030-05-04', checkin: '2030-05-01' },
        depositpaid: false,
        totalprice: 9,
        lastname: 'L',
        firstname: 'F',
      },
    });
    assert.equal(
      response.text,
      '{"bookingid":11,"booking":{"firstname":"F","lastname":"L","totalprice":9,"depositpaid":false,' +
        '"bookingdates":{"checkin":"2030-05-01","checkout":"2030-05-04"},"additionalneeds":"Late"}}',
    );
  });

  test('additionalneeds is optional', async () => {
    const s = await stub();
    const { additionalneeds, ...payload } = booking();
    assert.ok(additionalneeds);
    const response = await call(s, 'POST', '/booking', { body: payload });
    assert.equal('additionalneeds' in response.json.booking, false);
  });

  test('a missing or invalid required field answers 500 text and stores nothing', async () => {
    const s = await stub();
    const bad = [
      {},
      { ...booking(), firstname: undefined },
      { ...booking(), lastname: 7 },
      { ...booking(), totalprice: null },
      { ...booking(), depositpaid: undefined },
      { ...booking(), bookingdates: { checkin: '2030-05-01' } },
      { ...booking(), bookingdates: undefined },
    ];
    for (const body of bad) {
      const response = await call(s, 'POST', '/booking', { body });
      assert.equal(response.status, 500);
      assert.equal(response.type, TEXT_TYPE);
      assert.equal(response.text, 'Internal Server Error');
    }
    assert.equal((await call(s, 'GET', '/booking')).json.length, 10);
  });

  test('coerces types like the real API (probe P10)', async () => {
    const s = await stub();
    const response = await call(s, 'POST', '/booking', {
      body: booking({
        totalprice: '99.9',
        depositpaid: 'false',
        bookingdates: { checkin: 'not-a-date', checkout: '2030-05-04T10:00:00Z' },
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.json.booking, {
      ...booking(),
      totalprice: 99,
      depositpaid: true,
      bookingdates: { checkin: '0NaN-aN-aN', checkout: '2030-05-04' },
    });
  });

  test('invalid JSON answers 400 text', async () => {
    const s = await stub();
    const response = await call(s, 'POST', '/booking', { body: '{"firstname":', raw: true });
    assert.deepEqual(
      [response.status, response.type, response.text],
      [400, TEXT_TYPE, 'Bad Request'],
    );
  });

  test('a body that is not sent as JSON is treated as empty and fails validation', async () => {
    const s = await stub();
    const response = await call(s, 'POST', '/booking', {
      body: JSON.stringify(booking()),
      raw: true,
      headers: { 'content-type': 'text/plain' },
    });
    assert.equal(response.status, 500);
  });
});

describe('GET /booking (search)', () => {
  test('lists the seed as ids in ascending order', async () => {
    const s = await stub();
    const response = await call(s, 'GET', '/booking');
    assert.equal(response.status, 200);
    assert.equal(response.type, JSON_TYPE);
    assert.deepEqual(
      response.json,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((bookingid) => ({ bookingid })),
    );
  });

  test('filters by exact, case-sensitive first and last name', async () => {
    const s = await stub();
    const id = await create(s, booking({ firstname: 'Unique', lastname: 'Person' }));
    const ids = async (query) =>
      (await call(s, 'GET', `/booking?${query}`)).json.map((e) => e.bookingid);
    assert.deepEqual(await ids('firstname=Unique&lastname=Person'), [id]);
    assert.deepEqual(await ids('firstname=Unique'), [id]);
    assert.deepEqual(await ids('lastname=Person'), [id]);
    assert.deepEqual(await ids('firstname=unique&lastname=person'), []);
    assert.deepEqual(await ids('lastname=Pers'), []);
    assert.equal((await ids('firstname=Jim')).length, 2);
  });

  test('checkin and checkout filters follow probe P6', async () => {
    const s = await stub();
    const id = await create(
      s,
      booking({
        lastname: 'Dates',
        bookingdates: { checkin: '2031-05-10', checkout: '2031-05-20' },
      }),
    );
    const ids = async (query) =>
      (await call(s, 'GET', `/booking?lastname=Dates&${query}`)).json.map((e) => e.bookingid);
    assert.deepEqual(await ids('checkin=2031-05-09'), [id]);
    assert.deepEqual(await ids('checkin=2031-05-10'), []);
    assert.deepEqual(await ids('checkout=2031-05-19'), []);
    assert.deepEqual(await ids('checkout=2031-05-20'), [id]);
    assert.deepEqual(await ids('checkin=2031-05-09&checkout=2031-05-21'), [id]);
  });

  test('an unparseable date filter answers 500', async () => {
    const s = await stub();
    const response = await call(s, 'GET', '/booking?checkin=garbage');
    assert.deepEqual([response.status, response.text], [500, 'Internal Server Error']);
  });

  test('unknown parameters and empty values are ignored', async () => {
    const s = await stub();
    assert.equal((await call(s, 'GET', '/booking?foo=bar&firstname=')).json.length, 10);
  });
});

describe('GET /booking/:id', () => {
  test('returns the booking as stored', async () => {
    const s = await stub();
    const response = await call(s, 'GET', '/booking/1');
    assert.equal(response.status, 200);
    assert.equal(response.type, JSON_TYPE);
    assert.deepEqual(response.json, SEED_BOOKINGS[0]);
  });

  test('an unknown, deleted or non-numeric id answers 404 text', async () => {
    const s = await stub();
    for (const path of [
      '/booking/99999',
      '/booking/abc',
      '/booking/-1',
      '/booking/1.5',
      '/booking/0',
    ]) {
      const response = await call(s, 'GET', path);
      assert.deepEqual(
        [response.status, response.type, response.text],
        [404, TEXT_TYPE, 'Not Found'],
        path,
      );
    }
  });
});

describe('PUT /booking/:id', () => {
  test('without or with a bad token answers 403 and changes nothing', async () => {
    const s = await stub();
    const id = await create(s);
    for (const headers of [
      {},
      cookie('deadbeefdeadbee'),
      basic('admin', 'wrong'),
      { cookie: 'foo=bar' },
    ]) {
      const response = await call(s, 'PUT', `/booking/${id}`, {
        body: booking({ firstname: 'Intruder' }),
        headers,
      });
      assert.deepEqual(
        [response.status, response.type, response.text],
        [403, TEXT_TYPE, 'Forbidden'],
      );
    }
    assert.deepEqual((await call(s, 'GET', `/booking/${id}`)).json, booking());
  });

  test('replaces the whole booking with cookie auth and answers a bare booking object', async () => {
    const s = await stub();
    const id = await create(s);
    const token = await login(s);
    const replacement = booking({
      firstname: 'Replaced',
      totalprice: 999,
      depositpaid: false,
      additionalneeds: 'Late',
    });
    const response = await call(s, 'PUT', `/booking/${id}`, {
      body: replacement,
      headers: cookie(token),
    });
    assert.equal(response.status, 200);
    assert.equal(response.type, JSON_TYPE);
    assert.deepEqual(response.json, replacement);
    assert.deepEqual((await call(s, 'GET', `/booking/${id}`)).json, replacement);
  });

  test('accepts Basic auth and a token among several cookies', async () => {
    const s = await stub();
    const id = await create(s);
    const token = await login(s);
    assert.equal(
      (await call(s, 'PUT', `/booking/${id}`, { body: booking(), headers: basic() })).status,
      200,
    );
    const multi = { cookie: `a=b; token=${token}; c=d` };
    assert.equal(
      (await call(s, 'PUT', `/booking/${id}`, { body: booking(), headers: multi })).status,
      200,
    );
  });

  test('a token issued by another process is rejected', async () => {
    const a = await stub();
    const b = await stub();
    const foreignToken = await login(a);
    // Tokens are deterministic, so b has not issued this one yet: the first login on b would.
    const id = await create(b);
    const response = await call(b, 'PUT', `/booking/${id}`, {
      body: booking(),
      headers: cookie(foreignToken),
    });
    assert.equal(response.status, 403);
  });

  test('keeps the stored additionalneeds when the body has none (probe P7)', async () => {
    const s = await stub();
    const id = await create(s, booking({ additionalneeds: 'Late' }));
    const { additionalneeds, ...withoutNeeds } = booking({ firstname: 'NoNeeds' });
    assert.ok(additionalneeds);
    const response = await call(s, 'PUT', `/booking/${id}`, {
      body: withoutNeeds,
      headers: basic(),
    });
    assert.equal(response.json.additionalneeds, 'Late');
    assert.equal(response.json.firstname, 'NoNeeds');
  });

  test('an unknown id with auth answers 405; without auth it answers 403 first', async () => {
    const s = await stub();
    const withAuth = await call(s, 'PUT', '/booking/99999', { body: booking(), headers: basic() });
    assert.deepEqual(
      [withAuth.status, withAuth.type, withAuth.text],
      [405, TEXT_TYPE, 'Method Not Allowed'],
    );
    assert.equal(
      (await call(s, 'PUT', '/booking/abc', { body: booking(), headers: basic() })).status,
      405,
    );
    assert.equal((await call(s, 'PUT', '/booking/99999', { body: booking() })).status, 403);
  });

  test('an invalid body answers 400 and changes nothing', async () => {
    const s = await stub();
    const id = await create(s);
    for (const body of [{ firstname: 'OnlyThis' }, { ...booking(), bookingdates: undefined }]) {
      const response = await call(s, 'PUT', `/booking/${id}`, { body, headers: basic() });
      assert.deepEqual(
        [response.status, response.type, response.text],
        [400, TEXT_TYPE, 'Bad Request'],
      );
    }
    assert.deepEqual((await call(s, 'GET', `/booking/${id}`)).json, booking());
  });

  test('a bad number is accepted and stored as null (probe P7)', async () => {
    const s = await stub();
    const id = await create(s);
    const response = await call(s, 'PUT', `/booking/${id}`, {
      body: booking({ totalprice: 'abc' }),
      headers: basic(),
    });
    assert.equal(response.status, 200);
    assert.equal(response.json.totalprice, null);
  });
});

describe('PATCH /booking/:id', () => {
  test('merges the given fields and answers the merged booking', async () => {
    const s = await stub();
    const id = await create(s);
    const token = await login(s);
    const response = await call(s, 'PATCH', `/booking/${id}`, {
      body: { firstname: 'Patched', totalprice: 321 },
      headers: cookie(token),
    });
    const expected = booking({ firstname: 'Patched', totalprice: 321 });
    assert.equal(response.status, 200);
    assert.equal(response.type, JSON_TYPE);
    assert.deepEqual(response.json, expected);
    assert.deepEqual((await call(s, 'GET', `/booking/${id}`)).json, expected);
  });

  test('replaces bookingdates as a whole (probe P8)', async () => {
    const s = await stub();
    const id = await create(s);
    const response = await call(s, 'PATCH', `/booking/${id}`, {
      body: { bookingdates: { checkin: '2031-07-01' } },
      headers: basic(),
    });
    assert.deepEqual(response.json.bookingdates, { checkin: '2031-07-01', checkout: '0NaN-aN-aN' });
  });

  test('an empty body changes nothing and unknown fields are dropped', async () => {
    const s = await stub();
    const id = await create(s);
    const response = await call(s, 'PATCH', `/booking/${id}`, {
      body: { foo: 'bar' },
      headers: basic(),
    });
    assert.deepEqual(response.json, booking());
  });

  test('without or with a bad token answers 403; unknown id with auth answers 405', async () => {
    const s = await stub();
    const id = await create(s);
    for (const headers of [{}, cookie('deadbeefdeadbee')]) {
      const response = await call(s, 'PATCH', `/booking/${id}`, {
        body: { firstname: 'X' },
        headers,
      });
      assert.deepEqual([response.status, response.text], [403, 'Forbidden']);
    }
    assert.deepEqual((await call(s, 'GET', `/booking/${id}`)).json, booking());
    const unknown = await call(s, 'PATCH', '/booking/99999', {
      body: { firstname: 'X' },
      headers: basic(),
    });
    assert.deepEqual([unknown.status, unknown.text], [405, 'Method Not Allowed']);
    assert.equal((await call(s, 'PATCH', '/booking/99999', { body: {} })).status, 403);
  });

  test('invalid JSON answers 400', async () => {
    const s = await stub();
    const id = await create(s);
    const response = await call(s, 'PATCH', `/booking/${id}`, {
      body: '{"firstname":',
      raw: true,
      headers: basic(),
    });
    assert.equal(response.status, 400);
  });
});

describe('DELETE /booking/:id', () => {
  test('without or with a bad token answers 403 and keeps the booking', async () => {
    const s = await stub();
    const id = await create(s);
    for (const headers of [{}, cookie('deadbeefdeadbee')]) {
      const response = await call(s, 'DELETE', `/booking/${id}`, { headers });
      assert.deepEqual(
        [response.status, response.type, response.text],
        [403, TEXT_TYPE, 'Forbidden'],
      );
    }
    assert.equal((await call(s, 'GET', `/booking/${id}`)).status, 200);
  });

  test('removes with cookie auth: 201 "Created", then GET is 404 and a repeat is 405', async () => {
    const s = await stub();
    const id = await create(s);
    const token = await login(s);
    const response = await call(s, 'DELETE', `/booking/${id}`, { headers: cookie(token) });
    assert.deepEqual([response.status, response.type, response.text], [201, TEXT_TYPE, 'Created']);
    assert.equal((await call(s, 'GET', `/booking/${id}`)).status, 404);
    const again = await call(s, 'DELETE', `/booking/${id}`, { headers: cookie(token) });
    assert.deepEqual(
      [again.status, again.type, again.text],
      [405, TEXT_TYPE, 'Method Not Allowed'],
    );
    assert.equal((await call(s, 'DELETE', `/booking/${id}`)).status, 403);
  });

  test('accepts Basic auth; an unknown or non-numeric id answers 405', async () => {
    const s = await stub();
    const id = await create(s);
    assert.equal((await call(s, 'DELETE', `/booking/${id}`, { headers: basic() })).status, 201);
    assert.equal((await call(s, 'DELETE', '/booking/99999', { headers: basic() })).status, 405);
    assert.equal((await call(s, 'DELETE', '/booking/abc', { headers: basic() })).status, 405);
  });
});

// ---- Accept check (probe P3 / P11) ---------------------------------------------------------------

describe('Accept check', () => {
  test('application/json and */* pass; everything else is 418, including absent and empty', async () => {
    const s = await stub();
    for (const accept of ['application/json', '*/*', ' application/json ']) {
      assert.equal(
        (await call(s, 'GET', '/booking/1', { headers: { accept } })).status,
        200,
        accept,
      );
    }
    for (const accept of [
      'text/html',
      'text/plain',
      'application/*',
      'application/json, text/html',
      'application/json;q=0.5',
      'application/json; charset=utf-8',
      'APPLICATION/JSON',
    ]) {
      const response = await call(s, 'GET', '/booking/1', { headers: { accept } });
      assert.deepEqual(
        [response.status, response.type, response.text],
        [418, TEXT_TYPE, "I'm a Teapot"],
        accept,
      );
    }
    assert.equal((await rawCall(s, 'GET', '/booking/1')).status, 418, 'no Accept header');
    assert.equal(
      (await rawCall(s, 'GET', '/booking/1', { headers: { accept: '' } })).status,
      418,
      'empty Accept',
    );
  });

  test('XML and form-urlencoded are the documented gap: 501', async () => {
    const s = await stub();
    for (const accept of ['application/xml', 'application/x-www-form-urlencoded']) {
      const response = await call(s, 'GET', '/booking/1', { headers: { accept } });
      assert.deepEqual(
        [response.status, response.type, response.text],
        [501, TEXT_TYPE, 'XML not supported by stub'],
        accept,
      );
    }
  });

  test('POST stores the booking before answering 418', async () => {
    const s = await stub();
    const response = await call(s, 'POST', '/booking', {
      body: booking({ lastname: 'Teapot' }),
      headers: { accept: 'text/html' },
    });
    assert.equal(response.status, 418);
    const found = await call(s, 'GET', '/booking?lastname=Teapot');
    assert.deepEqual(found.json, [{ bookingid: 11 }]);
  });

  test('PUT applies the change before answering 418', async () => {
    const s = await stub();
    const id = await create(s);
    const response = await call(s, 'PUT', `/booking/${id}`, {
      body: booking({ firstname: 'Teapot' }),
      headers: { ...basic(), accept: 'text/html' },
    });
    assert.equal(response.status, 418);
    assert.equal((await call(s, 'GET', `/booking/${id}`)).json.firstname, 'Teapot');
  });

  test('PATCH applies the change and answers 500 instead of 418 (probe P8)', async () => {
    const s = await stub();
    const id = await create(s);
    const response = await call(s, 'PATCH', `/booking/${id}`, {
      body: { firstname: 'Teapot' },
      headers: { ...basic(), accept: 'text/html' },
    });
    assert.deepEqual(
      [response.status, response.type, response.text],
      [500, TEXT_TYPE, 'Internal Server Error'],
    );
    assert.equal((await call(s, 'GET', `/booking/${id}`)).json.firstname, 'Teapot');
  });

  test('errors win over the check: 400, 403, 404, 405, 500 never become 418', async () => {
    const s = await stub();
    const html = { accept: 'text/html' };
    assert.equal((await call(s, 'GET', '/booking/99999', { headers: html })).status, 404);
    assert.equal(
      (await call(s, 'POST', '/booking', { body: '{"x":', raw: true, headers: html })).status,
      400,
    );
    assert.equal((await call(s, 'POST', '/booking', { body: {}, headers: html })).status, 500);
    assert.equal(
      (await call(s, 'PUT', '/booking/1', { body: booking(), headers: html })).status,
      403,
    );
    assert.equal(
      (
        await call(s, 'PUT', '/booking/99999', {
          body: booking(),
          headers: { ...basic(), ...html },
        })
      ).status,
      405,
    );
    assert.equal(
      (
        await call(s, 'PUT', '/booking/1', {
          body: { firstname: 'x' },
          headers: { ...basic(), ...html },
        })
      ).status,
      400,
    );
  });

  test('does not apply to /ping, /auth, the search, DELETE or unknown routes', async () => {
    const s = await stub();
    const html = { accept: 'text/html' };
    const id = await create(s);
    assert.equal((await call(s, 'GET', '/ping', { headers: html })).status, 201);
    assert.equal((await call(s, 'GET', '/booking', { headers: html })).status, 200);
    assert.equal(
      (await call(s, 'GET', '/booking', { headers: { accept: 'application/xml' } })).status,
      200,
    );
    assert.equal((await call(s, 'GET', '/nope', { headers: html })).status, 404);
    const deleted = await call(s, 'DELETE', `/booking/${id}`, { headers: { ...basic(), ...html } });
    assert.equal(deleted.status, 201);
    assert.equal((await call(s, 'GET', `/booking/${id}`)).status, 404);
  });
});

// ---- faults: one smoke per fault, with the clean counterpart --------------------------------------

describe('fault smoke tests', () => {
  test('registry and servers agree on the 10 faults', () => {
    assert.equal(FAULTS.length, 10);
  });

  test('fault 1: GET returns totalprice + 1, the store keeps the real value', async () => {
    const clean = await stub(0);
    const faulty = await stub(1);
    const id = await create(clean, booking({ totalprice: 150 }));
    assert.equal(await create(faulty, booking({ totalprice: 150 })), id);
    assert.equal((await call(clean, 'GET', `/booking/${id}`)).json.totalprice, 150);
    assert.equal((await call(faulty, 'GET', `/booking/${id}`)).json.totalprice, 151);
    // POST (and so the stored value) stays clean: the create response still shows 150.
    const created = await call(faulty, 'POST', '/booking', { body: booking({ totalprice: 150 }) });
    assert.equal(created.json.booking.totalprice, 150);
  });

  test('fault 2: GET omits additionalneeds even though it is stored', async () => {
    const clean = await stub(0);
    const faulty = await stub(2);
    const id = await create(clean);
    await create(faulty);
    assert.equal((await call(clean, 'GET', `/booking/${id}`)).json.additionalneeds, 'Breakfast');
    assert.equal('additionalneeds' in (await call(faulty, 'GET', `/booking/${id}`)).json, false);
    const created = await call(faulty, 'POST', '/booking', { body: booking() });
    assert.equal(created.json.booking.additionalneeds, 'Breakfast');
  });

  test('fault 3: PATCH resets unsent fields in the response and in the store', async () => {
    const clean = await stub(0);
    const faulty = await stub(3);
    const idClean = await create(clean);
    const idFaulty = await create(faulty);
    const patch = { firstname: 'Patched' };

    const cleanResponse = await call(clean, 'PATCH', `/booking/${idClean}`, {
      body: patch,
      headers: basic(),
    });
    assert.deepEqual(cleanResponse.json, booking({ firstname: 'Patched' }));

    const faultyResponse = await call(faulty, 'PATCH', `/booking/${idFaulty}`, {
      body: patch,
      headers: basic(),
    });
    const expected = {
      firstname: 'Patched',
      lastname: '',
      totalprice: 0,
      depositpaid: false,
      bookingdates: booking().bookingdates,
    };
    assert.deepEqual(faultyResponse.json, expected);
    assert.deepEqual((await call(faulty, 'GET', `/booking/${idFaulty}`)).json, expected);
  });

  test('fault 4: PUT without a token is accepted and applied; PATCH and DELETE still need auth', async () => {
    const clean = await stub(0);
    const faulty = await stub(4);
    const id = await create(clean);
    await create(faulty);
    const replacement = booking({ firstname: 'Intruder' });

    assert.equal((await call(clean, 'PUT', `/booking/${id}`, { body: replacement })).status, 403);
    assert.equal((await call(clean, 'GET', `/booking/${id}`)).json.firstname, 'Ana');

    const accepted = await call(faulty, 'PUT', `/booking/${id}`, { body: replacement });
    assert.equal(accepted.status, 200);
    assert.equal((await call(faulty, 'GET', `/booking/${id}`)).json.firstname, 'Intruder');
    assert.equal(
      (await call(faulty, 'PUT', `/booking/${id}`, { body: replacement, headers: cookie('bad') }))
        .status,
      200,
    );

    assert.equal(
      (await call(faulty, 'PATCH', `/booking/${id}`, { body: { firstname: 'X' } })).status,
      403,
    );
    assert.equal((await call(faulty, 'DELETE', `/booking/${id}`)).status, 403);
  });

  test('fault 5: an authorised DELETE answers 201 but the booking stays', async () => {
    const clean = await stub(0);
    const faulty = await stub(5);
    const id = await create(clean);
    await create(faulty);

    assert.equal((await call(clean, 'DELETE', `/booking/${id}`, { headers: basic() })).status, 201);
    assert.equal((await call(clean, 'GET', `/booking/${id}`)).status, 404);

    const response = await call(faulty, 'DELETE', `/booking/${id}`, { headers: basic() });
    assert.deepEqual([response.status, response.text], [201, 'Created']);
    assert.equal((await call(faulty, 'GET', `/booking/${id}`)).status, 200);
    assert.equal((await call(faulty, 'DELETE', `/booking/${id}`)).status, 403);
    assert.equal(
      (await call(faulty, 'DELETE', '/booking/99999', { headers: basic() })).status,
      405,
    );
  });

  test('fault 6: name filters are ignored, date filters still apply', async () => {
    const clean = await stub(0);
    const faulty = await stub(6);
    const query = '/booking?firstname=Nobody&lastname=Nowhere';
    assert.deepEqual((await call(clean, 'GET', query)).json, []);
    assert.equal((await call(faulty, 'GET', query)).json.length, 10);
    assert.equal((await call(faulty, 'GET', '/booking?firstname=Jim')).json.length, 10);
    assert.deepEqual((await call(faulty, 'GET', '/booking?checkin=2099-01-01')).json, []);
  });

  test('fault 7: POST /auth hands out a valid token for any credentials', async () => {
    const clean = await stub(0);
    const faulty = await stub(7);
    const bad = { username: 'nobody', password: 'wrong' };

    assert.deepEqual((await call(clean, 'POST', '/auth', { body: bad })).json, {
      reason: 'Bad credentials',
    });

    const response = await call(faulty, 'POST', '/auth', { body: bad });
    assert.match(response.json.token, /^[0-9a-f]{15}$/);
    assert.match((await call(faulty, 'POST', '/auth')).json.token, /^[0-9a-f]{15}$/);

    const id = await create(faulty);
    const deleted = await call(faulty, 'DELETE', `/booking/${id}`, {
      headers: cookie(response.json.token),
    });
    assert.equal(deleted.status, 201, 'the issued token is valid');
  });

  test('fault 8: GET swaps checkin and checkout, the store is unchanged', async () => {
    const clean = await stub(0);
    const faulty = await stub(8);
    const id = await create(clean);
    await create(faulty);
    assert.deepEqual((await call(clean, 'GET', `/booking/${id}`)).json.bookingdates, {
      checkin: '2030-05-01',
      checkout: '2030-05-04',
    });
    assert.deepEqual((await call(faulty, 'GET', `/booking/${id}`)).json.bookingdates, {
      checkin: '2030-05-04',
      checkout: '2030-05-01',
    });
    // The stored dates are intact: PUT answers them in the right order, and the date filters match.
    const put = await call(faulty, 'PUT', `/booking/${id}`, { body: booking(), headers: basic() });
    assert.deepEqual(put.json.bookingdates, { checkin: '2030-05-01', checkout: '2030-05-04' });
  });

  test('fault 9: every booking body carries depositpaid as a string, the store keeps a boolean', async () => {
    const clean = await stub(0);
    const faulty = await stub(9);
    const id = await create(clean);
    await create(faulty);
    assert.equal((await call(clean, 'GET', `/booking/${id}`)).json.depositpaid, true);

    assert.equal((await call(faulty, 'GET', `/booking/${id}`)).json.depositpaid, 'true');
    const created = await call(faulty, 'POST', '/booking', {
      body: booking({ depositpaid: false }),
    });
    assert.equal(created.json.booking.depositpaid, 'false');
    const put = await call(faulty, 'PUT', `/booking/${id}`, {
      body: booking({ depositpaid: false }),
      headers: basic(),
    });
    assert.equal(put.json.depositpaid, 'false');
    const patch = await call(faulty, 'PATCH', `/booking/${id}`, {
      body: { depositpaid: true },
      headers: basic(),
    });
    assert.equal(patch.json.depositpaid, 'true');
    // The store holds a boolean: a PATCH that does not touch it still serialises it consistently.
    const other = await call(faulty, 'PATCH', `/booking/${id}`, {
      body: { firstname: 'Z' },
      headers: basic(),
    });
    assert.equal(other.json.depositpaid, 'true');
  });

  test('fault 10: every 5th request answers 500 with no side effect; /__stub/ is not counted', async () => {
    const clean = await stub(0);
    const faulty = await stub(10);
    for (let i = 0; i < 10; i++) assert.equal((await call(clean, 'GET', '/ping')).status, 201);

    const statuses = [];
    for (let i = 0; i < 10; i++) {
      statuses.push((await call(faulty, 'GET', '/ping')).status);
      await call(faulty, 'GET', '/__stub/health');
    }
    assert.deepEqual(statuses, [201, 201, 201, 201, 500, 201, 201, 201, 201, 500]);

    const failed = await call(faulty, 'GET', '/ping'); // request 11
    assert.equal(failed.status, 201);
    for (let i = 0; i < 3; i++) await call(faulty, 'GET', '/ping'); // 12, 13, 14
    const noEffect = await call(faulty, 'POST', '/booking', { body: booking() }); // 15th request
    assert.deepEqual(
      [noEffect.status, noEffect.type, noEffect.text],
      [500, TEXT_TYPE, 'Internal Server Error'],
    );
    assert.equal(
      (await call(faulty, 'GET', '/booking/11')).status,
      404,
      'the failed POST created nothing',
    );
    assert.equal((await call(faulty, 'GET', '/__stub/health')).json.requests, 16);
  });

  test('every fault is off on a clean server: a full sequence matches the clean contract', async () => {
    const s = await stub(0);
    const id = await create(s);
    const token = await login(s);
    assert.equal(
      (
        await call(s, 'PATCH', `/booking/${id}`, {
          body: { totalprice: 7 },
          headers: cookie(token),
        })
      ).json.totalprice,
      7,
    );
    const read = (await call(s, 'GET', `/booking/${id}`)).json;
    assert.deepEqual(read, booking({ totalprice: 7 }));
    assert.equal(
      (await call(s, 'DELETE', `/booking/${id}`, { headers: cookie(token) })).status,
      201,
    );
    assert.equal((await call(s, 'GET', `/booking/${id}`)).status, 404);
  });
});
