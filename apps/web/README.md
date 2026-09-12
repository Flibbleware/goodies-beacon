# @goodies-beacon/web

The React web UI: wanted items, interview chat, candidates and verdicts, grading scales, settings. Vite with TanStack Router and Query and Tailwind; dark and light follow the operating system.

`pnpm dev` serves it at `localhost:5173` with hot reload, proxying `/api` and `/healthz` to the local API so cookies and CSRF behave as they will in production. In production the API serves the built output instead, with a fallback to `index.html` so deep links survive a refresh. `pnpm e2e` runs the Playwright smoke test in `e2e/` against the built app.
