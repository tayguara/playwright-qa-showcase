// The ten pre-registered faults and the hooks that implement them.
//
// Exactly one fault is active per stub process (FAULT=<n>, 0 or unset means clean). Each hook is
// a small pure function (apart from the request counter of fault 10) and every hook stays clean
// unless its own fault is active. The meaning of each fault is frozen by the spec; do not edit.

const defineFaults = (list) => Object.freeze(list.map((fault) => Object.freeze(fault)));

export const FAULTS = defineFaults([
  {
    id: 1,
    slug: 'get-wrong-totalprice',
    description:
      'GET /booking/:id returns the stored totalprice plus 1; the stored value is unchanged.',
  },
  {
    id: 2,
    slug: 'get-omits-additionalneeds',
    description: 'GET /booking/:id leaves out additionalneeds even when it is stored.',
  },
  {
    id: 3,
    slug: 'patch-changes-unsent-fields',
    description:
      'PATCH resets every top-level field that is absent from the body (bookingdates excepted).',
  },
  {
    id: 4,
    slug: 'put-without-token-accepted',
    description: 'PUT skips the auth check; PATCH and DELETE still enforce it.',
  },
  {
    id: 5,
    slug: 'delete-not-deleting',
    description: 'An authorised DELETE answers 201 but the booking stays.',
  },
  {
    id: 6,
    slug: 'name-filter-ignored',
    description: 'GET /booking ignores the firstname and lastname filters.',
  },
  {
    id: 7,
    slug: 'auth-accepts-any-credentials',
    description: 'POST /auth answers 200 with a valid token for any or missing credentials.',
  },
  {
    id: 8,
    slug: 'dates-swapped-on-read',
    description: 'GET /booking/:id returns checkin and checkout swapped; the store is unchanged.',
  },
  {
    id: 9,
    slug: 'depositpaid-as-string',
    description: 'Every booking in a response body has depositpaid as "true" or "false".',
  },
  {
    id: 10,
    slug: 'every-5th-request-500',
    description: 'Every 5th request since the process started answers 500 with no side effect.',
  },
]);

/** FAULT env value to a fault number. Unset, empty and '0' mean clean; anything else throws. */
export function parseFault(raw) {
  if (raw === undefined || raw === '' || raw === '0') return 0;
  const match = /^(?:[1-9]|10)$/.exec(raw);
  if (!match) {
    throw new RangeError(`Invalid FAULT value ${JSON.stringify(raw)}: use 0 (clean) or 1..10`);
  }
  return Number(raw);
}

/** Fields that fault 3 resets when a PATCH body does not mention them. */
const FAULT3_DEFAULTS = Object.freeze({
  firstname: '',
  lastname: '',
  totalprice: 0,
  depositpaid: false,
});

export function createFaultHooks(fault) {
  if (!Number.isInteger(fault) || fault < 0 || fault > 10) {
    throw new RangeError(`Unknown fault ${String(fault)}`);
  }
  let calls = 0;

  return {
    /** Applied only to GET /booking/:id (faults 1, 2 and 8). Never mutates its input. */
    readBooking(booking) {
      const copy = structuredClone(booking);
      if (fault === 1) copy.totalprice += 1;
      if (fault === 2) delete copy.additionalneeds;
      if (fault === 8) {
        const { checkin, checkout } = copy.bookingdates;
        copy.bookingdates = { checkin: checkout, checkout: checkin };
      }
      return copy;
    },

    /** Applied to every booking body in a response (fault 9). Never mutates its input. */
    serializeBooking(booking) {
      if (fault !== 9) return booking;
      return { ...booking, depositpaid: String(booking.depositpaid) };
    },

    /**
     * Merges a normalised PATCH body into an existing booking. Clean: shallow merge. Fault 3:
     * a replacement with defaults, so every unsent top-level field is reset except bookingdates.
     */
    applyPatch(existing, changes) {
      if (fault !== 3) return { ...existing, ...changes };
      const patched = {
        firstname: 'firstname' in changes ? changes.firstname : FAULT3_DEFAULTS.firstname,
        lastname: 'lastname' in changes ? changes.lastname : FAULT3_DEFAULTS.lastname,
        totalprice: 'totalprice' in changes ? changes.totalprice : FAULT3_DEFAULTS.totalprice,
        depositpaid: 'depositpaid' in changes ? changes.depositpaid : FAULT3_DEFAULTS.depositpaid,
        bookingdates: 'bookingdates' in changes ? changes.bookingdates : existing.bookingdates,
      };
      if (changes.additionalneeds !== undefined) patched.additionalneeds = changes.additionalneeds;
      return patched;
    },

    putRequiresAuth: fault !== 4,
    deleteRemoves: fault !== 5,
    ignoreNameFilters: fault === 6,
    acceptAnyCredentials: fault === 7,

    /** Stateful: true on every 5th call under fault 10, always false otherwise. */
    shouldFailRequest() {
      if (fault !== 10) return false;
      calls += 1;
      return calls % 5 === 0;
    },
  };
}
