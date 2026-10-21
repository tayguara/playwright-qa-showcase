# Stub fidelity log

The stub in `server.mjs` mimics the public Restful Booker sandbox (`https://restful-booker.herokuapp.com`). This file records what the real API was observed to do, how the stub follows it, and where it deliberately does not.

Change rule: the stub may change only to match a real-API behaviour shown in a new dated entry here. Fault semantics (the fault table in the README) are frozen.

## Probe 1: 2026-10-20 (23:28Z to 23:36Z)

- Tool: `curl` 8.11.1 over HTTPS, one machine, default `Accept: */*` unless stated.
- Header noise omitted below: `date`, `etag`, `nel`, `report-to`, `reporting-endpoints`, `server: Heroku`, `via`, `x-powered-by: Express`, `content-length`.
- `B=https://restful-booker.herokuapp.com`, `J='Content-Type: application/json'`, `TOK` is a token obtained from `POST /auth` earlier in the same script.
- Every booking created got the lastname `Zed-4711`, `Zed-4712` or `Zed-4713` and the firstnames `FidProbe`, `FidPut`, `FidPatch`, `FidDel` and similar. They were found by lastname search and deleted at the end of each step. A final search by every probe lastname/firstname returned `[]`.

Two incidents during the probe, kept here because they affect how to read the data:

1. **The sandbox database was reset while the probe ran** (about 23:30Z). Booking ids restarted from the seed and the content of booking 1 changed from Eric Wilson to Eric Smith. Results that depended on a booking created before the reset were redone on a fresh booking.
2. **A PUT whose body contained `"bookingid":1` re-numbered my booking to id 1** (the API let a client-supplied `bookingid` overwrite the id; the booking I created as id 499 answered 405 afterwards, and `GET /booking/1` returned my data). My cleanup then deleted "booking 1", which also removed the sandbox's own seed booking 1 until the next reset. No other third-party data was touched. This is recorded as a known gap and the probe never sent `bookingid` again.

The sandbox is a public test target that anyone can write to and that resets itself periodically. The probe kept every write small and deleted what it created.

**Findings that decide whether a suite passes on the clean stub** (details in the probes and in "How the stub differs" below): an absent or empty `Accept` header gets 418 (the default `*/*` of Playwright and Node's `fetch` passes); the `Accept` check runs after the change is applied; a failed check answers 418 on POST and PUT but **500 on PATCH**; `Accept: application/xml` works on the real API (200 with an XML body), while the stub answers **501**, a documented fidelity gap; PATCH replaces `bookingdates` as a whole; `checkin=D` matches strictly after D.

### P1 `GET /ping`

```
curl -si $B/ping
HTTP/2 201   content-type: text/plain; charset=utf-8   body: Created
```

`HEAD /ping` also answers 201. `POST /ping` answers 404.

### P2 `POST /auth`

```
curl -si $B/auth -H "$J" -d '{"username":"admin","password":"password123"}'
200  application/json; charset=utf-8  {"token":"9dac60d406e08ca"}          (15 hex chars)
curl -si $B/auth -H "$J" -d '{"username":"admin","password":"nope"}'
200  application/json; charset=utf-8  {"reason":"Bad credentials"}
curl -si $B/auth -H "$J" -d '{}'
200  application/json; charset=utf-8  {"reason":"Bad credentials"}
curl -si -X POST $B/auth -H "$J"          (no body)
200  application/json; charset=utf-8  {"reason":"Bad credentials"}
curl -si $B/auth                           (GET)
404  text/plain; charset=utf-8  Not Found
```

Matches the clean contract.

### P3 `POST /booking`

```
V='{"firstname":"FidProbe","lastname":"Zed-4711","totalprice":123,"depositpaid":true,"bookingdates":{"checkin":"2027-03-10","checkout":"2027-03-15"},"additionalneeds":"Lunch"}'
curl -si $B/booking -H "$J" -d "$V"
200  application/json; charset=utf-8
{"bookingid":4017,"booking":{"firstname":"FidProbe","lastname":"Zed-4711","totalprice":123,"depositpaid":true,"bookingdates":{"checkin":"2027-03-10","checkout":"2027-03-15"},"additionalneeds":"Lunch"}}

curl -si $B/booking -H "$J" -d '{"firstname":"FidProbe","lastname":"Zed-4711","totalprice":123,"depositpaid":true}'   (no bookingdates)
500  text/plain; charset=utf-8  Internal Server Error

curl -si $B/booking -H "$J" -d '{"firstname":'
400  text/plain; charset=utf-8  Bad Request

curl -si $B/booking -H "$J" -H 'Accept: text/html' -d "$V"        -> 418  text/plain  I'm a Teapot   (booking STORED anyway: found by lastname search)
curl -si $B/booking -H "$J" -H 'Accept:' -d "$V"                  -> 418  I'm a Teapot  (curl removes the header, so NO Accept header is sent; booking stored)
curl -si $B/booking -H "$J" -H 'Accept;' -d "$V"                  -> 418  I'm a Teapot  (empty Accept value sent; booking stored)
curl -si $B/booking -H "$J" -H 'Accept' -d "$V"                   -> 200  (curl ignored the malformed option and sent its default `Accept: */*`)
```

Finding that changes the contract: **an absent Accept header is answered with 418, not accepted.** `docs/KNOWN_ISSUES.md` says a missing header is fine; that note referred to curl's default `*/*`. The three stored 418 bookings were confirmed by `GET /booking?lastname=Zed-4711` listing their ids.

### P3 and P11 follow-up: which Accept values pass, and where the check runs

`GET /booking/1` with each Accept value (status only):

| Accept value                                                                                                                                       | Status                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `application/json`                                                                                                                                 | 200                                                                                                       |
| `*/*`                                                                                                                                              | 200                                                                                                       |
| `application/xml`                                                                                                                                  | 200 (body is XML, content-type `text/html`, with an empty `<booking>` element for the seed row; see gaps) |
| `application/x-www-form-urlencoded`                                                                                                                | 200, body `formurlencoded is not a function` (an app bug, see gaps)                                       |
| `text/html`, `text/plain`, `text/xml`, `text/*`, `application/*`, `application/jsonp`, `text/json`, `*/json`                                       | 418                                                                                                       |
| `application/json, text/html`, `text/html, */*`, `*/*, application/json`, `application/json, application/xml`, `application/xml, application/json` | 418                                                                                                       |
| `application/json;q=0.5`, `*/*;q=0.1`                                                                                                              | 418                                                                                                       |
| `application/json; charset=utf-8`, `application/json;charset=utf-8`, `application/xml; charset=utf-8`                                              | 418                                                                                                       |
| `APPLICATION/JSON`                                                                                                                                 | 418                                                                                                       |
| leading or trailing space around `application/json`                                                                                                | 200 (header values are trimmed)                                                                           |
| header absent, or present and empty                                                                                                                | 418                                                                                                       |

So the real API compares the (trimmed) header value **exactly** against a short list. Quality values, parameters, lists, wildcards other than `*/*`, and case differences all give 418.

Scope of the check (probed with `Accept: text/html`, or with the header removed):

| Request                                        | Result                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /ping`                                    | 201, no check                                                                                           |
| `POST /auth`                                   | 200, no check                                                                                           |
| `GET /booking` (list)                          | 200, no check (also with `Accept: application/xml`: JSON body)                                          |
| `DELETE /booking/:id` (authorised)             | 201 and the booking is deleted, no check                                                                |
| unknown route                                  | 404, no check                                                                                           |
| `POST /booking` valid                          | 418 **after storing**                                                                                   |
| `POST /booking` invalid JSON or missing field  | 400 / 500, the check is never reached                                                                   |
| `GET /booking/:id` existing                    | 418                                                                                                     |
| `GET /booking/:id` unknown                     | 404 (the error wins)                                                                                    |
| `PUT /booking/:id` valid, authorised           | 418 **after applying the change** (readback showed the new data)                                        |
| `PUT` with no auth / unknown id / invalid body | 403 / 405 / 400 (the error wins)                                                                        |
| `PATCH /booking/:id` valid, authorised         | **500** "Internal Server Error" (not 418), **after applying the change** (readback showed the new data) |
| `PATCH` with no auth / unknown id              | 403 / 405                                                                                               |

Findings that change the contract: the check runs when a handler is about to send a successful booking response, never before. The mutation has already happened when it fails. PATCH answers 500 instead of 418.

### P4 `GET /booking/:id`

```
curl -si $B/booking/4017    200 application/json; charset=utf-8  {"firstname":"FidProbe",...,"additionalneeds":"Lunch"}
curl -si $B/booking/99999999   404 text/plain; charset=utf-8  Not Found
curl -si $B/booking/abc        404 Not Found
curl -si $B/booking/-1         404 Not Found
```

Matches the clean contract for the cases above. The key order is firstname, lastname, totalprice, depositpaid, bookingdates, additionalneeds; `additionalneeds` is absent when it was never stored.

Odd id forms: `/booking/2abc`, `/booking/02`, `/booking/2.0`, `/booking/%202` and `/booking/0x2` all returned booking 2 (the id is parsed leniently); `/booking/1e1` returned 404. A trailing slash (`/booking/2022/`) returns the booking too.

### P5 name filters

```
curl -si "$B/booking?firstname=FidProbe&lastname=Zed-4711"   200 application/json; charset=utf-8  [{"bookingid":4017},{"bookingid":4026},...]   (ascending)
curl -si "$B/booking?firstname=FidProbe&lastname=Zed-47"     200 []        (partial lastname: no match)
curl -si "$B/booking?firstname=fidprobe&lastname=zed-4711"   200 []        (case-sensitive)
curl -si "$B/booking?firstname=NoSuchFirstnameQQ"            200 []
curl -si "$B/booking?lastname=Zed-4711"                      200 [ids]     (one filter alone works)
curl -si "$B/booking?lastname=Zed-4711&foo=bar"              200 [ids]     (unknown parameter ignored)
```

Matches the clean contract: exact, case-sensitive, ascending ids, unknown parameters ignored.

### P6 `checkin` / `checkout` filter semantics

Booking with `checkin=2031-05-10`, `checkout=2031-05-20` (lastname filter added to isolate it), repeated on a second booking `2032-02-10` to `2032-02-20` with the same result:

| Query                                    | Result                                           |
| ---------------------------------------- | ------------------------------------------------ |
| `checkin=2031-05-09`                     | match                                            |
| `checkin=2031-05-10`                     | **no match**                                     |
| `checkin=2031-05-11`                     | no match                                         |
| `checkout=2031-05-19`                    | no match                                         |
| `checkout=2031-05-20`                    | match                                            |
| `checkout=2031-05-21`                    | match                                            |
| `checkin=2031-05-10&checkout=2031-05-20` | no match (checkin fails)                         |
| `checkin=2031-05-09&checkout=2031-05-21` | match                                            |
| `checkin=2031-05-11&checkout=2031-05-19` | no match                                         |
| `checkin=2032-02-10T00:00:00Z`           | no match; `checkin=2032-02-09T23:59:59Z` matches |
| `checkin=garbage`                        | 500 `Internal Server Error`                      |

Finding that changes the contract: `checkin=D` matches bookings whose checkin is **strictly after** D, and `checkout=D` matches bookings whose checkout is on or **before** D. The planned default ("checkin >= D") was wrong for `checkin`. The stub follows the probe.

### P7 PUT

```
curl -si -X PUT $B/booking/$ID -H "$J" -H "Cookie: token=$TOK" -d '{...full body...}'   200 application/json; charset=utf-8  bare booking object; readback shows it persisted
curl -si -X PUT ... -u admin:password123 -d '{...}'              200 (Basic auth works)
curl -si -X PUT ... -u admin:wrong                              403 text/plain  Forbidden
curl -si -X PUT $B/booking/$ID -H "$J" -d '{...}'                403 Forbidden  (no auth)
curl -si -X PUT ... -H "Cookie: token=deadbeefdeadbee"         403 Forbidden  (bad token)
curl -si -X PUT ... -H "Cookie: a=b; token=$TOK; c=d"          200 (token found among several cookies)
... -d '{"firstname":"OnlyThis"}'                              400 text/plain  Bad Request
... -d '{"firstname":"x","lastname":"y","totalprice":5,"depositpaid":true}'   (no bookingdates)   400 Bad Request
... -d '{"firstname":'                                         400 Bad Request
PUT $B/booking/99999999 with auth                               405 text/plain  Method Not Allowed
PUT $B/booking/99999999 without auth                            403 Forbidden  (auth is checked before the id)
PUT $B/booking/abc with auth                                    405 Method Not Allowed
PUT with "totalprice":"abc" (otherwise valid)                   200, stored and returned totalprice null
PUT with an unknown field "foo":"bar"                           200, the field is dropped
PUT without additionalneeds, booking previously had "Late"      200, response and readback still have "additionalneeds":"Late"
PUT with "additionalneeds":""                                   200, stored as ""
```

Findings that change the contract:

- A PUT without `additionalneeds` **keeps the existing value** (the field is not cleared). Every other required field is replaced.
- PUT validation is `400` for a missing required field, a non-string name, or a missing `bookingdates`. A bad number (`"abc"`) is accepted and stored as `null`.

### P8 PATCH

```
curl -si -X PATCH $B/booking/$ID -H "$J" -H "Cookie: token=$TOK" -d '{"firstname":"Patched","totalprice":321}'
200  application/json; charset=utf-8  full merged booking, other fields unchanged; readback identical
-d '{"bookingdates":{"checkin":"2031-07-01"}}'     200  "bookingdates":{"checkin":"2031-07-01","checkout":"0NaN-aN-aN"}   (checkout is NOT kept)
-d '{"bookingdates":{"checkout":"2031-07-09"}}'    200  "bookingdates":{"checkin":"0NaN-aN-aN","checkout":"2031-07-09"}
-u admin:password123 -d '{"lastname":"Zed-4713","depositpaid":false}'   200 (Basic auth works)
no auth / bad token                                403 text/plain  Forbidden
unknown id with auth                               405 Method Not Allowed
unknown id without auth                            403 Forbidden
-d '{}'                                            200 booking unchanged
-d '{"firstname":'                                 400 Bad Request
-d '{"foo":"bar","firstname":"WithFoo"}'           200, foo dropped
-d '{"totalprice":"abc"}'                          200, totalprice null (no validation)
-d '{"bookingdates":{"checkin":"nope"}}'           200, both dates become "0NaN-aN-aN"
```

Finding that changes the contract: PATCH replaces `bookingdates` **as a whole**. A missing sub-field becomes the invalid-date string `0NaN-aN-aN`. The pre-registered contract left this to the probe (P8), so the stub copies what was observed. A PATCH body with only top-level fields behaves as a shallow merge.

### P9 DELETE

```
curl -si -X DELETE $B/booking/$ID                              403 text/plain  Forbidden; the booking is still there
... -H "Cookie: token=deadbeefdeadbee"                        403 Forbidden
... -H "Cookie: token=$TOK"                                   201 text/plain; charset=utf-8  Created; GET -> 404 Not Found
repeat with the cookie                                         405 Method Not Allowed
repeat without auth                                            403 Forbidden
-u admin:password123                                           201 Created (Basic auth works)
unknown id / abc with auth                                     405 Method Not Allowed
with Accept: text/html                                         201, deleted (no Accept check)
```

Matches the clean contract.

### P10 type coercion on `POST /booking`

| Body change (rest valid)                                                                                       | Result                                                            |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `totalprice: 99.5`                                                                                             | 200, stored `99` (truncated toward zero)                          |
| `totalprice: 99.9` / `-1.5`                                                                                    | `99` / `-1`                                                       |
| `totalprice: "150"`                                                                                            | 200, `150`                                                        |
| `totalprice: "12.7"`                                                                                           | 200, `12`                                                         |
| `totalprice: "abc"`, `""` or `true`                                                                            | 200, `null`                                                       |
| `totalprice: null` or missing                                                                                  | 500                                                               |
| `depositpaid: "true"`, `"false"`, `"yes"`                                                                      | 200, `true` (JavaScript truthiness: any non-empty string is true) |
| `depositpaid: ""` or `0`                                                                                       | 200, `false`                                                      |
| `depositpaid: null` or missing                                                                                 | 500                                                               |
| `firstname: 123`, `true`, `["A"]`, `lastname: null`                                                            | 500                                                               |
| `firstname: ""`                                                                                                | 200, stored as `""`                                               |
| `bookingdates.checkin: "not-a-date"`                                                                           | 200, `0NaN-aN-aN`                                                 |
| `checkin: ""`                                                                                                  | 200, `0NaN-aN-aN`                                                 |
| `checkin: 1`                                                                                                   | 200, `1970-01-01` (a number is read as epoch milliseconds)        |
| `checkin: "2031-06-01T23:30:00"`                                                                               | 200, `2031-06-01`                                                 |
| `checkin: "2031/06/01"`                                                                                        | 200, `2031-06-01`                                                 |
| `checkin: null`, `bookingdates: null` or `"x"`                                                                 | 500                                                               |
| missing `firstname`, `lastname`, `totalprice`, `depositpaid`, `checkout` or `bookingdates`; body `{}` or `[1]` | 500                                                               |
| `additionalneeds` null / `5` / `""`                                                                            | stored and returned as `null` / `5` / `""` (not coerced)          |
| unknown field `foo`                                                                                            | dropped                                                           |
| form-urlencoded or `text/plain` body                                                                           | 500 (body not parsed as JSON)                                     |

### P11 content types

| Endpoint                                                | Content-Type                              |
| ------------------------------------------------------- | ----------------------------------------- |
| `/ping`                                                 | `text/plain; charset=utf-8`               |
| `/auth`                                                 | `application/json; charset=utf-8`         |
| `/booking` list, `/booking/:id`, POST/PUT/PATCH success | `application/json; charset=utf-8`         |
| DELETE success                                          | `text/plain; charset=utf-8` (`Created`)   |
| every error (400, 403, 404, 405, 418, 500)              | `text/plain; charset=utf-8`               |
| `/`                                                     | `text/html; charset=utf-8` (welcome page) |
| `OPTIONS /booking`                                      | 200 `text/plain`, `GET, HEAD, POST`       |

### P12 unknown routes

`GET /nope`, `POST /nope`, `GET /auth`, `POST /ping`, `PUT /booking` (no id), `DELETE /booking` (no id) and `POST /booking/:id` all answer `404 text/plain Not Found`.

## How the stub differs from the clean contract (changes made because of the probe)

1. **Accept check** (the planned request pipeline). The stub compares the trimmed header value exactly: `application/json` or `*/*` pass. An absent header, an empty header and any other value give 418. The check runs only where a handler is about to send a successful booking body (`POST /booking`, `GET /booking/:id`, `PUT`, `PATCH`), after the change has been applied. PATCH answers `500 Internal Server Error` instead of 418. `/ping`, `/auth`, `GET /booking`, `DELETE` and errors are never checked.
2. **Normalisation** follows P10: `totalprice` is truncated and coerced (`null` when not numeric), `depositpaid` uses truthiness, dates are coerced with an invalid date becoming `0NaN-aN-aN`, `additionalneeds` is kept as sent, and a missing or null required field is a 500 on POST and a 400 on PUT.
3. **PUT** keeps the stored `additionalneeds` when the body has none.
4. **PATCH** replaces `bookingdates` as a whole, with the missing sub-field set to `0NaN-aN-aN`, and performs no value validation.
5. **Date filters**: `checkin=D` matches `checkin > D`, `checkout=D` matches `checkout <= D`, an invalid date gives 500.
6. A trailing slash on `/booking/:id` is accepted; `HEAD /ping` answers 201.

## Known gaps (not implemented)

- `Accept: application/xml` and `application/x-www-form-urlencoded`: the real API answers 200 with an XML (or error text) body. The stub answers `501 text/plain "XML not supported by stub"` for both, after applying the mutation like any other Accept failure. A suite that asks for XML would fail on the stub for a reason unrelated to its quality.
- Form-urlencoded request bodies are not parsed (the real API answers 500, so the stub matches by accident).
- A client-supplied `bookingid` in a PUT body renumbers the booking in the real API. The stub drops unknown fields, so it never does.
- Odd id forms (`2abc`, `02`, `2.0`, `0x2`) resolve to booking 2 on the real API. The stub accepts only plain decimal digits and answers 404 otherwise.
- `OPTIONS`, the `/` welcome page and the `/apidoc` documentation are not served.
- Tokens: the real ones are random 15-hex strings that expire server-side after some time; the stub issues deterministic ones that never expire.
- The real sandbox is shared and is reset periodically. Its seed is random data; the stub's seed is fixed (10 bookings, two with firstname `Jim`).
- Response headers other than `Content-Type` (etag, Heroku routing headers) are not reproduced.
- Latency, concurrency effects and rate limits of the hosted service are not reproduced.
- Large `totalprice` values, unicode normalisation and very long strings were not probed.
