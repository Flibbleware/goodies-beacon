# Goodies Beacon — API

Generated from the route table by `pnpm docs:api`. Do not edit by hand.

**Auth** is `session` where a valid `gb_session` cookie is required — every `/api` path that is
not listed as `public` answers 401 without one, including paths with no route. **CSRF** is required
on state-changing methods: send the `gb_csrf` cookie's value back in `X-CSRF-Token` (§12).

Errors always take the shape `{ error: { code, message } }`. Every response carries an
`X-Request-Id`; quote it when reporting a 500.

| Method | Path | Auth | CSRF |
|---|---|---|---|
| `POST` | `/api/auth/first-run` | public | required |
| `POST` | `/api/auth/login` | public | required |
| `POST` | `/api/auth/logout` | public | required |
| `POST` | `/api/auth/password` | session | required |
| `GET` | `/api/auth/session` | public | — |
| `GET` | `/api/settings` | session | — |
| `PUT` | `/api/settings` | session | required |
| `GET` | `/healthz` | public | — |

Anything outside `/api` and `/healthz` is served by the web app in production, with a fallback to
`index.html` so deep links survive a refresh.
