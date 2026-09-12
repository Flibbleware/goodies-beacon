# @goodies-beacon/api

The Hono HTTP server, and the one entrypoint every role starts from: it reads `ROLE` and serves the API, subscribes the workers from `@goodies-beacon/worker`, or both. Owns authentication, the JSON API, Server-Sent Events for the interview chat, the interviewer agent, and serving the built web app in production.
