---
'@tortoise/adapters': minor
'@tortoise/deployment': minor
'@tortoise/workstation-sign-in': minor
---

Sessions that survive a restart and a reload, and stop a request when they end. `Sessions.signal(token)` aborts when the host revokes or expires a session, and the HTTP handler runs each request with it, so a command still running then returns `CANCELLED` and commits nothing. A plugin credential does the same when the context it resolves has a signal. Workforce sign-in keeps sessions by token digest in `workforce-sessions.sqlite` in the workspace directory, so a restart keeps people signed in, and sign-out aborts the session's signal. Station sign-in aborts an operator session's signal at sign-out and expiry, adds `POST /api/v1/station/session`, and the terminal screen keeps the operator token in the tab's session storage, so a reload keeps the operator signed in.
