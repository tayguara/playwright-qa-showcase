import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  INVALID_DATE,
  SEED_BOOKINGS,
  createStore,
  normalizeBooking,
  normalizeBookingChanges,
  normalizeDate,
} from '../store.mjs';

const valid = () => ({
  firstname: 'Ana',
  lastname: 'Silva',
  totalprice: 150,
  depositpaid: true,
  bookingdates: { checkin: '2030-05-01', checkout: '2030-05-04' },
  additionalneeds: 'Breakfast',
});

describe('SEED_BOOKINGS', () => {
  test('holds 10 bookings, two with the firstname Jim', () => {
    assert.equal(SEED_BOOKINGS.length, 10);
    assert.equal(SEED_BOOKINGS.filter((b) => b.firstname === 'Jim').length, 2);
  });

  test('every seed booking is already normalised', () => {
    for (const seed of SEED_BOOKINGS) {
      assert.deepEqual(normalizeBooking(seed), { ok: true, booking: seed });
    }
  });

  test('is frozen so no process can edit the seed', () => {
    assert.ok(Object.isFrozen(SEED_BOOKINGS));
  });
});

describe('normalizeDate', () => {
  test('formats valid values as YYYY-MM-DD in UTC', () => {
    assert.equal(normalizeDate('2031-06-01'), '2031-06-01');
    assert.equal(normalizeDate('2031-06-01T23:30:00Z'), '2031-06-01');
    assert.equal(normalizeDate(0), '1970-01-01');
  });

  test('turns invalid values into the real API placeholder', () => {
    assert.equal(INVALID_DATE, '0NaN-aN-aN');
    for (const value of ['not-a-date', '', undefined]) {
      assert.equal(normalizeDate(value), INVALID_DATE, `value ${String(value)}`);
    }
  });
});

describe('normalizeBooking', () => {
  test('accepts a valid body and keeps the canonical key order', () => {
    const result = normalizeBooking({
      additionalneeds: 'Late',
      bookingdates: { checkout: '2030-05-04', checkin: '2030-05-01' },
      depositpaid: true,
      totalprice: 150,
      lastname: 'Silva',
      firstname: 'Ana',
    });
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.booking), [
      'firstname',
      'lastname',
      'totalprice',
      'depositpaid',
      'bookingdates',
      'additionalneeds',
    ]);
    assert.deepEqual(Object.keys(result.booking.bookingdates), ['checkin', 'checkout']);
  });

  test('drops unknown fields, also inside bookingdates', () => {
    const result = normalizeBooking({
      ...valid(),
      foo: 'bar',
      bookingid: 1,
      bookingdates: { checkin: '2030-05-01', checkout: '2030-05-04', nights: 3 },
    });
    assert.deepEqual(result, { ok: true, booking: valid() });
  });

  test('additionalneeds is optional and only present when provided', () => {
    const without = valid();
    delete without.additionalneeds;
    const result = normalizeBooking(without);
    assert.equal(result.ok, true);
    assert.equal('additionalneeds' in result.booking, false);
  });

  test('keeps additionalneeds exactly as sent (empty string, null, number)', () => {
    for (const value of ['', null, 5]) {
      const result = normalizeBooking({ ...valid(), additionalneeds: value });
      assert.equal(result.booking.additionalneeds, value);
    }
  });

  test('rejects a missing or null required field', () => {
    for (const key of ['firstname', 'lastname', 'totalprice', 'depositpaid', 'bookingdates']) {
      const missing = valid();
      delete missing[key];
      assert.deepEqual(normalizeBooking(missing), { ok: false }, `missing ${key}`);
      assert.deepEqual(normalizeBooking({ ...valid(), [key]: null }), { ok: false }, `null ${key}`);
    }
    for (const key of ['checkin', 'checkout']) {
      const dates = { ...valid().bookingdates };
      delete dates[key];
      assert.deepEqual(normalizeBooking({ ...valid(), bookingdates: dates }), { ok: false });
      assert.deepEqual(normalizeBooking({ ...valid(), bookingdates: { ...dates, [key]: null } }), {
        ok: false,
      });
    }
  });

  test('rejects non-string names and non-object bodies', () => {
    for (const value of [123, true, ['A'], {}]) {
      assert.deepEqual(normalizeBooking({ ...valid(), firstname: value }), { ok: false });
      assert.deepEqual(normalizeBooking({ ...valid(), lastname: value }), { ok: false });
    }
    for (const body of [undefined, null, [1], 'x', 7]) {
      assert.deepEqual(normalizeBooking(body), { ok: false });
    }
    for (const dates of ['x', 7, [], true]) {
      assert.deepEqual(normalizeBooking({ ...valid(), bookingdates: dates }), { ok: false });
    }
    assert.deepEqual(normalizeBooking({}), { ok: false });
  });

  test('accepts empty-string names', () => {
    const result = normalizeBooking({ ...valid(), firstname: '' });
    assert.equal(result.booking.firstname, '');
  });

  test('coerces totalprice like the real API (probe P10)', () => {
    const price = (totalprice) => normalizeBooking({ ...valid(), totalprice }).booking.totalprice;
    assert.equal(price(99.5), 99);
    assert.equal(price(99.9), 99);
    assert.equal(price(-1.5), -1);
    assert.equal(price('150'), 150);
    assert.equal(price('12.7'), 12);
    assert.equal(price('abc'), null);
    assert.equal(price(''), null);
    assert.equal(price(true), null);
    assert.ok(Object.is(price(-0.5), 0), 'never returns -0');
  });

  test('coerces depositpaid by truthiness (probe P10)', () => {
    const paid = (depositpaid) => normalizeBooking({ ...valid(), depositpaid }).booking.depositpaid;
    assert.equal(paid(true), true);
    assert.equal(paid(false), false);
    assert.equal(paid('true'), true);
    assert.equal(paid('false'), true);
    assert.equal(paid('yes'), true);
    assert.equal(paid(''), false);
    assert.equal(paid(0), false);
    assert.equal(paid(1), true);
  });

  test('normalises dates (probe P10)', () => {
    const dates = (checkin, checkout = '2030-05-04') =>
      normalizeBooking({ ...valid(), bookingdates: { checkin, checkout } }).booking.bookingdates;
    assert.deepEqual(dates('not-a-date'), { checkin: INVALID_DATE, checkout: '2030-05-04' });
    assert.equal(dates('2031-06-01T23:30:00Z').checkin, '2031-06-01');
    assert.equal(dates('').checkin, INVALID_DATE);
    assert.equal(dates(1).checkin, '1970-01-01');
  });

  test('does not mutate its input', () => {
    const input = valid();
    normalizeBooking(input);
    assert.deepEqual(input, valid());
  });
});

describe('normalizeBookingChanges (PATCH bodies)', () => {
  test('keeps only known fields that were sent, in canonical order', () => {
    assert.deepEqual(
      normalizeBookingChanges({ totalprice: 321, foo: 'bar', firstname: 'Patched' }),
      { firstname: 'Patched', totalprice: 321 },
    );
  });

  test('an empty body gives no changes', () => {
    assert.deepEqual(normalizeBookingChanges({}), {});
    assert.deepEqual(normalizeBookingChanges(undefined), {});
  });

  test('replaces bookingdates as a whole; a missing sub-field becomes the invalid date', () => {
    assert.deepEqual(normalizeBookingChanges({ bookingdates: { checkin: '2031-07-01' } }), {
      bookingdates: { checkin: '2031-07-01', checkout: INVALID_DATE },
    });
    assert.deepEqual(normalizeBookingChanges({ bookingdates: { checkout: '2031-07-09' } }), {
      bookingdates: { checkin: INVALID_DATE, checkout: '2031-07-09' },
    });
  });

  test('coerces numbers and booleans without rejecting anything', () => {
    assert.deepEqual(normalizeBookingChanges({ totalprice: 'abc', depositpaid: 'false' }), {
      totalprice: null,
      depositpaid: true,
    });
  });

  test('keeps additionalneeds as sent', () => {
    assert.deepEqual(normalizeBookingChanges({ additionalneeds: '' }), { additionalneeds: '' });
  });

  test('ignores values of an unusable type for names and bookingdates', () => {
    assert.deepEqual(normalizeBookingChanges({ firstname: 5, bookingdates: 'x' }), {});
  });
});

describe('createStore', () => {
  test('starts from the seed with ids 1..10 and gives 11 next', () => {
    const store = createStore();
    assert.deepEqual(store.list({}), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(store.create(valid()), 11);
    assert.equal(store.create(valid()), 12);
  });

  test('stores seeds verbatim', () => {
    const store = createStore();
    assert.deepEqual(store.get(1), SEED_BOOKINGS[0]);
    assert.deepEqual(store.get(10), SEED_BOOKINGS[9]);
  });

  test('get returns undefined for unknown ids', () => {
    const store = createStore();
    assert.equal(store.get(0), undefined);
    assert.equal(store.get(11), undefined);
    assert.equal(store.get(99999), undefined);
  });

  test('every process starts from the same state', () => {
    const first = createStore();
    first.create(valid());
    first.remove(1);
    assert.deepEqual(createStore().list({}), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('ids are never reused after a delete', () => {
    const store = createStore();
    const id = store.create(valid());
    store.remove(id);
    assert.equal(store.create(valid()), id + 1);
  });

  test('reads return clones: editing a result never changes the store', () => {
    const store = createStore();
    const id = store.create(valid());
    const copy = store.get(id);
    copy.firstname = 'Changed';
    copy.bookingdates.checkin = '1999-01-01';
    assert.deepEqual(store.get(id), valid());
  });

  test('create stores a clone of its input', () => {
    const store = createStore();
    const input = valid();
    const id = store.create(input);
    input.firstname = 'Changed';
    input.bookingdates.checkin = '1999-01-01';
    assert.deepEqual(store.get(id), valid());
  });

  test('replace swaps the whole booking and reports unknown ids', () => {
    const store = createStore();
    const id = store.create(valid());
    assert.equal(store.replace(id, { ...valid(), firstname: 'Bea' }), true);
    assert.equal(store.get(id).firstname, 'Bea');
    assert.equal(store.replace(9999, valid()), false);
    assert.equal(store.get(9999), undefined);
  });

  test('replace stores a clone of its input', () => {
    const store = createStore();
    const id = store.create(valid());
    const input = { ...valid() };
    store.replace(id, input);
    input.bookingdates = { checkin: 'x', checkout: 'y' };
    assert.deepEqual(store.get(id), valid());
  });

  test('remove deletes once, then reports the id as unknown', () => {
    const store = createStore();
    const id = store.create(valid());
    assert.equal(store.remove(id), true);
    assert.equal(store.get(id), undefined);
    assert.equal(store.remove(id), false);
    assert.equal(store.list({}).includes(id), false);
  });

  test('accepts a custom seed', () => {
    const store = createStore([valid()]);
    assert.deepEqual(store.list({}), [1]);
    assert.equal(store.create(valid()), 2);
  });
});

describe('store.list filters', () => {
  const store = createStore();
  const nameOf = (id) => store.get(id).firstname;

  test('no filters returns every id in ascending order', () => {
    const ids = store.list({});
    assert.deepEqual(
      ids,
      [...ids].sort((a, b) => a - b),
    );
    assert.equal(ids.length, 10);
  });

  test('firstname is an exact, case-sensitive match', () => {
    const jims = store.list({ firstname: 'Jim' });
    assert.equal(jims.length, 2);
    for (const id of jims) assert.equal(nameOf(id), 'Jim');
    assert.deepEqual(store.list({ firstname: 'jim' }), []);
    assert.deepEqual(store.list({ firstname: 'Ji' }), []);
    assert.deepEqual(store.list({ firstname: 'Jim ' }), []);
  });

  test('lastname is an exact, case-sensitive match', () => {
    const lastname = SEED_BOOKINGS[0].lastname;
    assert.ok(store.list({ lastname }).includes(1));
    assert.deepEqual(store.list({ lastname: lastname.toUpperCase() }), []);
    assert.deepEqual(store.list({ lastname: lastname.slice(0, -1) }), []);
  });

  test('firstname and lastname combine with AND', () => {
    const { firstname, lastname } = SEED_BOOKINGS[0];
    assert.ok(store.list({ firstname, lastname }).includes(1));
    assert.deepEqual(store.list({ firstname, lastname: 'Nobody' }), []);
  });

  test('checkin filter matches bookings whose checkin is strictly after the date (probe P6)', () => {
    const local = createStore([
      { ...valid(), bookingdates: { checkin: '2031-05-10', checkout: '2031-05-20' } },
    ]);
    assert.deepEqual(local.list({ checkin: '2031-05-09' }), [1]);
    assert.deepEqual(local.list({ checkin: '2031-05-10' }), []);
    assert.deepEqual(local.list({ checkin: '2031-05-11' }), []);
  });

  test('checkout filter matches bookings whose checkout is on or before the date (probe P6)', () => {
    const local = createStore([
      { ...valid(), bookingdates: { checkin: '2031-05-10', checkout: '2031-05-20' } },
    ]);
    assert.deepEqual(local.list({ checkout: '2031-05-19' }), []);
    assert.deepEqual(local.list({ checkout: '2031-05-20' }), [1]);
    assert.deepEqual(local.list({ checkout: '2031-05-21' }), [1]);
  });

  test('date filters combine with each other and with names', () => {
    const local = createStore([
      { ...valid(), bookingdates: { checkin: '2031-05-10', checkout: '2031-05-20' } },
    ]);
    assert.deepEqual(local.list({ checkin: '2031-05-09', checkout: '2031-05-21' }), [1]);
    assert.deepEqual(local.list({ checkin: '2031-05-11', checkout: '2031-05-19' }), []);
    assert.deepEqual(local.list({ lastname: 'Silva', checkin: '2031-05-09' }), [1]);
    assert.deepEqual(local.list({ lastname: 'Other', checkin: '2031-05-09' }), []);
  });

  test('unknown filter keys and undefined values are ignored', () => {
    assert.equal(store.list({ foo: 'bar', firstname: undefined }).length, 10);
  });
});
