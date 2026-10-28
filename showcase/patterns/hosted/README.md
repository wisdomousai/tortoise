# Host the lab desk with Postgres

The [base oil-lab desk](../base/README.md) can run on a server with its workspace in Postgres. This pattern adds a [workspace lease](../../../docs/primitives.md#workspace-lease) and external workforce sign-in. Only one instance can commit to the workspace at a time; another can take over after the holder stops or its lease expires.

## Run on this machine

Run the pattern on this machine:

1. Start a Postgres server the instance can create tables in, and put its URL in `AGENT_NATIVE_DATABASE_URL`.
2. Issue a certificate for `127.0.0.1` from a CA the browser trusts, such as mkcert's: `mkcert -install`, then `mkcert 127.0.0.1`.
3. Start the launch:

   ```sh
   cd showcase/patterns/hosted
   LAB_IDP_CERT=<dir>/127.0.0.1.pem LAB_IDP_KEY=<dir>/127.0.0.1-key.pem \
     LAB_IDP_CA="$(mkcert -CAROOT)/rootCA.pem" bun run dev:web
   ```

4. Open the sign-in link the launch prints, pick `ana@lab.example`, and submit a test request. Sign in again as `ben@lab.example` to read it as a viewer. Workforce sessions live in memory, so a restart signs everyone out.
5. From the repository root, start a second instance of the same workspace:

   ```sh
   AGENT_NATIVE_APPLICATION=@agent-native/pattern-hosted \
     bun run cli serve --workspace <dir>/instance-b --hosted-workspace test-requests --port 4362
   ```

   The second instance exits with code 5 and `CONFLICT` while the first holds the lease. Stop the first instance, and the same command takes over and serves the requests. Without `AGENT_NATIVE_SITE_POLICY` the second instance runs as the local owner, and its connection file reaches it from the CLI.

The frame has no sign-out control. `POST /auth/sign-out` from the page's origin ends the session.

## Identity and ownership

The development identity provider is a stand-in: it signs in whichever lab user is chosen without a password and redirects only to loopback. A real deployment must bind `workforce-idp` to its own provider. With `identity: external`, the host issues no local owner session, launch link or connection file; people sign in at `/auth/sign-in`, and the verified email selects the lab role.

Every commit checks the lease's fence in the transaction. An instance that loses the lease can no longer commit. The database URL comes from `AGENT_NATIVE_DATABASE_URL`, not the deployment policy or a command-line argument.

## Code and checks

[`application.ts`](application.ts) defines lab members and composes the host; [`dev.ts`](dev.ts) starts the stand-in identity provider and development policy.

```sh
bun test showcase/patterns/hosted
```

The tests race instances on PGlite and exercise the stand-in provider with a throwaway CA when `openssl` is available. They do not establish a deployment against an organization's identity provider.
