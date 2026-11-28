# Runtime and supply-chain updates

Supported Node minimum: 22.18.0 (native TypeScript stripping); CI and the container use Node 22.
The container base is pinned to the multi-platform digest of the official node:22-bookworm-slim image.
GitHub Actions are pinned to commit SHA; comments retain the original major release track.

Monthly, resolve each action's tracked release tag with git ls-remote (dereference annotated tags),
review upstream release notes, and update the SHA in all workflows together. Resolve the official
Docker registry manifest digest for Node 22, inspect its architectures and security updates, then
update both Dockerfile stages. Do not infer a digest from a local image ID.

Run frozen-lockfile install, typecheck, all tests, harness, desktop/Web builds and container health
smoke before merging. Trigger credential-smoke manually on Windows/macOS. Updating runtime packages
or the lockfile is a separate reviewed change. Debian apt packages remain repository-resolved;
byte-for-byte container reproducibility is not guaranteed by a base digest alone.
