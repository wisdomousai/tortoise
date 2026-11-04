# Host the lab desk with Postgres

The [base lab desk](../base/README.md) also runs on a server with its workspace in Postgres. This pattern adds the workspace lease and workforce sign-in through an external identity provider: one instance commits at a time, each commit checks the lease's fencing token inside its transaction, and another takes over when the holder stops or its lease expires. The stand-in identity provider signs in any lab user without a password.

Start a Postgres server with a database the instance may create tables in, put its URL in `TORTOISE_DATABASE_URL`, issue a loopback certificate (`mkcert -install`, then `mkcert 127.0.0.1`), and run:

```sh
cd showcase/patterns/hosted
LAB_IDP_CERT=<dir>/127.0.0.1.pem LAB_IDP_KEY=<dir>/127.0.0.1-key.pem \
  LAB_IDP_CA="$(mkcert -CAROOT)/rootCA.pem" bun run dev:web
```

## What to try

- Open the printed sign-in link, pick `ana@lab.example` and submit a request; sign in as `ben@lab.example` to read it as a viewer. The host keeps sessions in memory, so a restart signs everyone out.
- Start a second instance on the same workspace from the repository root: `TORTOISE_APPLICATION=@tortoise/pattern-hosted bun run cli serve --workspace <dir>/instance-b --hosted-workspace test-requests --port 4362`. It exits with code 5 and `CONFLICT`; stop the first instance and the same command takes over.
- `POST /auth/sign-out` from the page's origin ends a session; the frame has no sign-out control.

## References

- [Hosting](../../../docs/hosting.md)
- [run-a-hosted-instance](../../../packages/host/skills/run-a-hosted-instance/SKILL.md)
- `bun test showcase/patterns/hosted` races instances on PGlite and runs the stand-in provider when it finds `openssl`
