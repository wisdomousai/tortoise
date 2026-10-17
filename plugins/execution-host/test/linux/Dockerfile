# The Linux environment for the execution host's sandbox tests: bubblewrap and Bun, run as an
# unprivileged user. `bun run test:execution-host:linux` builds it and mounts the checkout.
FROM alpine:3.23
ARG BUN_VERSION=1.4.0
RUN set -e; \
    apk add --no-cache bubblewrap libstdc++ libgcc curl unzip; \
    case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=aarch64 ;; *) exit 1 ;; esac; \
    curl -fsSL -o /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${arch}-musl.zip"; \
    unzip -q /tmp/bun.zip -d /tmp; \
    mv "/tmp/bun-linux-${arch}-musl/bun" /usr/local/bin/bun; \
    rm -rf /tmp/bun*; \
    adduser -D -u 1100 runner
USER runner
ENTRYPOINT ["/usr/local/bin/bun"]
