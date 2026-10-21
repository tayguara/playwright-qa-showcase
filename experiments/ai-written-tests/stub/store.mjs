// In-memory booking store, seed data and payload normalisation for the Restful Booker stub.
// Every rule here comes from the dated probe log in FIDELITY.md (probes P3, P6, P8, P10).

/** What the real API stores when a date cannot be parsed (probe P10). */
export const INVALID_DATE = '0NaN-aN-aN';

/** Ten fixed bookings. Ids are their 1-based positions; the first free id is 11. */
export const SEED_BOOKINGS = Object.freeze([
  seed('Jim', 'Brown', 111, true, '2019-01-01', '2019-01-05', 'Breakfast'),
  seed('Sally', 'Brown', 245, false, '2019-03-12', '2019-03-14'),
  seed('Jim', 'Smith', 312, true, '2019-06-17', '2019-06-24', 'Late checkout'),
  seed('Mary', 'Jones', 98, false, '2020-02-02', '2020-02-03'),
  seed('Eric', 'Wilson', 274, false, '2020-07-04', '2020-07-11', 'Breakfast'),
  seed('Susan', 'Jackson', 156, true, '2021-05-09', '2021-05-12'),
  seed('Mark', 'Ericsson', 420, true, '2021-09-30', '2021-10-07', 'Airport transfer'),
  seed('Ana', 'Pereira', 189, false, '2022-04-18', '2022-04-21'),
  seed('Tom', 'Taylor', 75, true, '2022-11-25', '2022-11-26', 'Extra bed'),
  seed('Lena', 'Fischer', 360, false, '2023-08-14', '2023-08-20'),
]);

function seed(firstname, lastname, totalprice, depositpaid, checkin, checkout, additionalneeds) {
  const booking = {
    firstname,
    lastname,
    totalprice,
    depositpaid,
    bookingdates: Object.freeze({ checkin, checkout }),
  };
  if (additionalneeds !== undefined) booking.additionalneeds = additionalneeds;
  return Object.freeze(booking);
}

/** Valid dates become YYYY-MM-DD (UTC); anything else becomes INVALID_DATE. */
export function normalizeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? INVALID_DATE : date.toISOString().slice(0, 10);
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPresent = (value) => value !== undefined && value !== null;

/** Truncates toward zero, like the real API. Non-numeric values become null (probe P10). */
function coerceTotalprice(value) {
  let number = null;
  if (typeof value === 'number') number = value;
  else if (typeof value === 'string' && value.trim() !== '') number = Number(value);
  // `+ 0` turns -0 into 0 so the JSON and strict comparisons stay predictable.
  return Number.isFinite(number) ? Math.trunc(number) + 0 : null;
}

/**
 * Validates and normalises a full booking body (POST and PUT).
 * Returns `{ ok: true, booking }` or `{ ok: false }`. Unknown fields are dropped. The key order
 * is fixed so that every response serialises the same way.
 */
export function normalizeBooking(input) {
  if (!isObject(input)) return { ok: false };
  const { firstname, lastname, totalprice, depositpaid, bookingdates, additionalneeds } = input;

  if (typeof firstname !== 'string' || typeof lastname !== 'string') return { ok: false };
  if (!isPresent(totalprice) || !isPresent(depositpaid)) return { ok: false };
  if (!isObject(bookingdates)) return { ok: false };
  if (!isPresent(bookingdates.checkin) || !isPresent(bookingdates.checkout)) return { ok: false };

  const booking = {
    firstname,
    lastname,
    totalprice: coerceTotalprice(totalprice),
    depositpaid: Boolean(depositpaid),
    bookingdates: {
      checkin: normalizeDate(bookingdates.checkin),
      checkout: normalizeDate(bookingdates.checkout),
    },
  };
  if (additionalneeds !== undefined) booking.additionalneeds = additionalneeds;
  return { ok: true, booking };
}

/**
 * Normalises a PATCH body into the partial booking to merge (probe P8). The real API does not
 * validate PATCH values; it replaces `bookingdates` as a whole, so a missing sub-field becomes
 * INVALID_DATE. Names or dates of an unusable type were not probed and are ignored.
 */
export function normalizeBookingChanges(input) {
  const changes = {};
  if (!isObject(input)) return changes;

  if (typeof input.firstname === 'string') changes.firstname = input.firstname;
  if (typeof input.lastname === 'string') changes.lastname = input.lastname;
  if ('totalprice' in input) changes.totalprice = coerceTotalprice(input.totalprice);
  if ('depositpaid' in input) changes.depositpaid = Boolean(input.depositpaid);
  if (isObject(input.bookingdates)) {
    changes.bookingdates = {
      checkin: normalizeDate(input.bookingdates.checkin),
      checkout: normalizeDate(input.bookingdates.checkout),
    };
  }
  if (input.additionalneeds !== undefined) changes.additionalneeds = input.additionalneeds;
  return changes;
}

/**
 * Creates a fresh store. Ids are 1-based positions in the seed, the next id follows the seed,
 * and ids are never reused. Every read and write works on a structuredClone copy.
 */
export function createStore(seedBookings = SEED_BOOKINGS) {
  const bookings = new Map();
  let nextId = 1;
  for (const booking of seedBookings) bookings.set(nextId++, structuredClone(booking));

  return {
    create(booking) {
      const id = nextId++;
      bookings.set(id, structuredClone(booking));
      return id;
    },

    get(id) {
      const booking = bookings.get(id);
      return booking === undefined ? undefined : structuredClone(booking);
    },

    /**
     * Ids in ascending order. Name filters are exact and case-sensitive. Probe P6: `checkin=D`
     * keeps bookings with checkin after D, `checkout=D` keeps bookings with checkout on or
     * before D. Date filters must already be normalised YYYY-MM-DD strings.
     */
    list({ firstname, lastname, checkin, checkout } = {}) {
      const ids = [];
      for (const [id, booking] of bookings) {
        if (firstname !== undefined && booking.firstname !== firstname) continue;
        if (lastname !== undefined && booking.lastname !== lastname) continue;
        if (checkin !== undefined && !(booking.bookingdates.checkin > checkin)) continue;
        if (checkout !== undefined && !(booking.bookingdates.checkout <= checkout)) continue;
        ids.push(id);
      }
      return ids; // Map iteration order is insertion order, which is ascending by id.
    },

    replace(id, booking) {
      if (!bookings.has(id)) return false;
      bookings.set(id, structuredClone(booking));
      return true;
    },

    remove(id) {
      return bookings.delete(id);
    },
  };
}
