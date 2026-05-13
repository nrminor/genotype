# Consumer E2E tests

This directory contains a small package template used to test GenoType as an external consumer would install it. The `scripts/consumer-check.mjs` script copies `template/` into a temporary directory, rewrites its dependencies to point at freshly packed local tarballs, runs `bun install`, and then executes the template project's smoke scripts.
