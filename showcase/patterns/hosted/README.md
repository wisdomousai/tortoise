# Host the lab desk with Postgres

This pattern runs the hypothetical [base application](../base/README.md) with Postgres workspace storage. The hosted platform holds a database lease and checks its fencing token during each commit. A competing instance can acquire the workspace after the current lease is released or expires.

Workforce sign-in uses a local identity-provider fixture. Its password-free account selection is development behavior and must not be exposed as a production identity service.

Start a Postgres server with a database the instance may create tables in, put its URL in `TORTOISE_DATABASE_URL`, issue a loopback certificate (`mkcert -install`, then `mkcert 127.0.0.1`), and run:

```sh
cd showcase/patterns/hosted
LAB_IDP_CERT=<dir>/127.0.0.1.pem LAB_IDP_KEY=<dir>/127.0.0.1-key.pem \
  LAB_IDP_CA="$(mkcert -CAROOT)/rootCA.pem" bun run dev:web
```

## What to try

Open the printed sign-in link, pick `ana@lab.example` and submit a request; sign in as `ben@lab.example` to read it as a viewer. The host retains unexpired workforce sessions in its instance directory. Preserve that directory when restarting the instance.

Start a second instance on the same workspace from the repository root: `TORTOISE_APPLICATION=@tortoise/pattern-hosted bun run cli serve --workspace <dir>/instance-b --hosted-workspace test-requests --port 4362`. It exits with code 5 and `CONFLICT`; stop the first instance and the same command takes over.

`POST /auth/sign-out` from the page's origin ends a session..

## References

[Hosting](../../../docs/hosting.md)

[run-a-hosted-instance](../../../packages/host/skills/run-a-hosted-instance/SKILL.md)

`bun test showcase/patterns/hosted` races instances on PGlite and runs the stand-in provider when it finds `openssl`
