# @goodies-beacon/worker

The pg-boss subscribers: polling source adapters on their schedules, running the matching pipeline, sending notifications, and pruning old candidates. Can run in the same process as the API (`ROLE=all`) or on a different machine (`ROLE=worker`, optionally restricted with `WORKER_SOURCES`).
