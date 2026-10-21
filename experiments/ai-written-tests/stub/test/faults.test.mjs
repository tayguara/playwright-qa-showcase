import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FAULTS, createFaultHooks, parseFault } from '../faults.mjs';

const booking = () => ({
  firstname: 'Jim',
  lastname: 'Brown',
  totalprice: 100,
  depositpaid: true,
  bookingdates: { checkin: '2030-01-01', checkout: '2030-01-05' },
  additionalneeds: 'Breakfast',
});

describe('FAULTS registry', () => {
  test('lists ids 1..10 with unique slugs and descriptions', () => {
    assert.deepEqual(
      FAULTS.map((f) => f.id),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    assert.equal(new Set(FAULTS.map((f) => f.slug)).size, 10);
    for (const fault of FAULTS) {
      assert.match(fault.slug, /^[a-z0-9-]+$/);
      assert.ok(fault.description.length > 10);
    }
  });

  test('uses the pre-registered slugs', () => {
    assert.deepEqual(
      FAULTS.map((f) => f.slug),
      [
        'get-wrong-totalprice',
        'get-omits-additionalneeds',
        'patch-changes-unsent-fields',
        'put-without-token-accepted',
        'delete-not-deleting',
        'name-filter-ignored',
        'auth-accepts-any-credentials',
        'dates-swapped-on-read',
        'depositpaid-as-string',
        'every-5th-request-500',
      ],
    );
  });

  test('is frozen', () => {
    assert.ok(Object.isFrozen(FAULTS));
    assert.ok(Object.isFrozen(FAULTS[0]));
  });
});

describe('parseFault', () => {
  test('treats undefined, empty and "0" as clean', () => {
    assert.equal(parseFault(undefined), 0);
    assert.equal(parseFault(''), 0);
    assert.equal(parseFault('0'), 0);
  });

  test('parses 1..10', () => {
    for (let n = 1; n <= 10; n++) assert.equal(parseFault(String(n)), n);
  });

  test('rejects anything else with a RangeError', () => {
    for (const raw of ['11', '-1', 'abc', '1.5', '01', ' 3', '3 ', '1e1', 'null']) {
      assert.throws(() => parseFault(raw), RangeError, `value ${JSON.stringify(raw)}`);
    }
  });
});

describe('createFaultHooks: clean (fault 0)', () => {
  const hooks = createFaultHooks(0);

  test('leaves reads and serialisation untouched', () => {
    assert.deepEqual(hooks.readBooking(booking()), booking());
    assert.deepEqual(hooks.serializeBooking(booking()), booking());
  });

  test('patch is a shallow merge that keeps unsent fields', () => {
    const merged = hooks.applyPatch(booking(), { firstname: 'Sue', totalprice: 5 });
    assert.deepEqual(merged, { ...booking(), firstname: 'Sue', totalprice: 5 });
  });

  test('patch replaces bookingdates as a whole', () => {
    const dates = { checkin: '2031-01-01', checkout: '0NaN-aN-aN' };
    assert.deepEqual(hooks.applyPatch(booking(), { bookingdates: dates }).bookingdates, dates);
  });

  test('flags are clean', () => {
    assert.equal(hooks.putRequiresAuth, true);
    assert.equal(hooks.deleteRemoves, true);
    assert.equal(hooks.ignoreNameFilters, false);
    assert.equal(hooks.acceptAnyCredentials, false);
  });

  test('never fails a request', () => {
    for (let i = 0; i < 20; i++) assert.equal(hooks.shouldFailRequest(), false);
  });

  test('does not mutate its input', () => {
    const input = booking();
    hooks.applyPatch(input, { firstname: 'X' });
    hooks.readBooking(input);
    hooks.serializeBooking(input);
    assert.deepEqual(input, booking());
  });
});

describe('fault 1: get-wrong-totalprice', () => {
  const hooks = createFaultHooks(1);

  test('readBooking adds 1 to totalprice and changes nothing else', () => {
    assert.deepEqual(hooks.readBooking(booking()), { ...booking(), totalprice: 101 });
  });

  test('does not touch the input object (the stored value stays)', () => {
    const input = booking();
    hooks.readBooking(input);
    assert.equal(input.totalprice, 100);
  });

  test('other hooks stay clean', () => {
    assert.deepEqual(hooks.serializeBooking(booking()), booking());
    assert.equal(hooks.putRequiresAuth, true);
  });
});

describe('fault 2: get-omits-additionalneeds', () => {
  const hooks = createFaultHooks(2);

  test('readBooking drops additionalneeds', () => {
    const read = hooks.readBooking(booking());
    assert.equal('additionalneeds' in read, false);
    assert.equal(read.firstname, 'Jim');
  });

  test('works when additionalneeds was never stored', () => {
    const without = booking();
    delete without.additionalneeds;
    assert.deepEqual(hooks.readBooking(without), without);
  });
});

describe('fault 3: patch-changes-unsent-fields', () => {
  const hooks = createFaultHooks(3);

  test('resets every unsent top-level field to its default', () => {
    const patched = hooks.applyPatch(booking(), { firstname: 'Sue' });
    assert.deepEqual(patched, {
      firstname: 'Sue',
      lastname: '',
      totalprice: 0,
      depositpaid: false,
      bookingdates: { checkin: '2030-01-01', checkout: '2030-01-05' },
    });
    assert.equal('additionalneeds' in patched, false);
  });

  test('applies sent fields normally, including additionalneeds', () => {
    const patched = hooks.applyPatch(booking(), {
      lastname: 'Green',
      totalprice: 42,
      depositpaid: true,
      additionalneeds: 'Late checkout',
    });
    assert.deepEqual(patched, {
      firstname: '',
      lastname: 'Green',
      totalprice: 42,
      depositpaid: true,
      bookingdates: { checkin: '2030-01-01', checkout: '2030-01-05' },
      additionalneeds: 'Late checkout',
    });
  });

  test('leaves bookingdates unchanged when not sent, applies it when sent', () => {
    assert.deepEqual(hooks.applyPatch(booking(), {}).bookingdates, booking().bookingdates);
    const dates = { checkin: '2031-02-02', checkout: '2031-02-09' };
    assert.deepEqual(hooks.applyPatch(booking(), { bookingdates: dates }).bookingdates, dates);
  });

  test('an empty patch resets the five resettable fields', () => {
    assert.deepEqual(hooks.applyPatch(booking(), {}), {
      firstname: '',
      lastname: '',
      totalprice: 0,
      depositpaid: false,
      bookingdates: booking().bookingdates,
    });
  });
});

describe('fault 4: put-without-token-accepted', () => {
  test('only PUT stops requiring auth', () => {
    const hooks = createFaultHooks(4);
    assert.equal(hooks.putRequiresAuth, false);
    assert.equal(hooks.deleteRemoves, true);
  });
});

describe('fault 5: delete-not-deleting', () => {
  test('delete no longer removes', () => {
    const hooks = createFaultHooks(5);
    assert.equal(hooks.deleteRemoves, false);
    assert.equal(hooks.putRequiresAuth, true);
  });
});

describe('fault 6: name-filter-ignored', () => {
  test('name filters are ignored', () => {
    assert.equal(createFaultHooks(6).ignoreNameFilters, true);
  });
});

describe('fault 7: auth-accepts-any-credentials', () => {
  test('any credentials are accepted', () => {
    assert.equal(createFaultHooks(7).acceptAnyCredentials, true);
  });
});

describe('fault 8: dates-swapped-on-read', () => {
  const hooks = createFaultHooks(8);

  test('readBooking swaps checkin and checkout', () => {
    assert.deepEqual(hooks.readBooking(booking()).bookingdates, {
      checkin: '2030-01-05',
      checkout: '2030-01-01',
    });
  });

  test('does not touch the input (the store is unchanged)', () => {
    const input = booking();
    hooks.readBooking(input);
    assert.deepEqual(input.bookingdates, { checkin: '2030-01-01', checkout: '2030-01-05' });
  });
});

describe('fault 9: depositpaid-as-string', () => {
  const hooks = createFaultHooks(9);

  test('serializeBooking turns the boolean into "true" / "false"', () => {
    assert.equal(hooks.serializeBooking({ ...booking(), depositpaid: true }).depositpaid, 'true');
    assert.equal(hooks.serializeBooking({ ...booking(), depositpaid: false }).depositpaid, 'false');
  });

  test('is a serialiser concern only: readBooking and the input stay boolean', () => {
    const input = booking();
    hooks.serializeBooking(input);
    assert.equal(input.depositpaid, true);
    assert.equal(hooks.readBooking(booking()).depositpaid, true);
  });
});

describe('fault 10: every-5th-request-500', () => {
  test('fails calls 5, 10, 15 and only those', () => {
    const hooks = createFaultHooks(10);
    const results = Array.from({ length: 15 }, () => hooks.shouldFailRequest());
    const failing = results.flatMap((failed, index) => (failed ? [index + 1] : []));
    assert.deepEqual(failing, [5, 10, 15]);
  });

  test('every hooks instance has its own counter', () => {
    const a = createFaultHooks(10);
    const b = createFaultHooks(10);
    for (let i = 0; i < 4; i++) a.shouldFailRequest();
    assert.equal(a.shouldFailRequest(), true);
    assert.equal(b.shouldFailRequest(), false);
  });

  test('other faults never fail requests', () => {
    for (let fault = 1; fault <= 9; fault++) {
      const hooks = createFaultHooks(fault);
      for (let i = 0; i < 10; i++) assert.equal(hooks.shouldFailRequest(), false);
    }
  });
});

describe('createFaultHooks', () => {
  test('rejects an unknown fault', () => {
    assert.throws(() => createFaultHooks(11), RangeError);
    assert.throws(() => createFaultHooks(-1), RangeError);
  });

  test('each fault touches only its own hook', () => {
    // A fault-N hooks object differs from clean in exactly the places the spec names.
    const clean = createFaultHooks(0);
    const probe = booking();
    for (let fault = 1; fault <= 10; fault++) {
      const hooks = createFaultHooks(fault);
      if (![1, 2, 8].includes(fault)) {
        assert.deepEqual(hooks.readBooking(probe), clean.readBooking(probe), `fault ${fault} read`);
      }
      if (fault !== 9) {
        assert.deepEqual(hooks.serializeBooking(probe), probe, `fault ${fault} serialise`);
      }
      if (fault !== 3) {
        assert.deepEqual(
          hooks.applyPatch(probe, { firstname: 'Z' }),
          clean.applyPatch(probe, { firstname: 'Z' }),
          `fault ${fault} patch`,
        );
      }
      assert.equal(hooks.putRequiresAuth, fault !== 4);
      assert.equal(hooks.deleteRemoves, fault !== 5);
      assert.equal(hooks.ignoreNameFilters, fault === 6);
      assert.equal(hooks.acceptAnyCredentials, fault === 7);
    }
  });
});
