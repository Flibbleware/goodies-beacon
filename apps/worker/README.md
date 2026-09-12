# @goodies-beacon/worker

The pg-boss subscribers: polling source adapters on their schedules, running the matching pipeline, sending notifications, and pruning old candidates. It exports the queue registrations rather than a process of its own — the shared entrypoint in `apps/api` starts them, in the same process as the API (`ROLE=all`) or alone on another machine (`ROLE=worker`, optionally narrowed with `WORKER_SOURCES`).
