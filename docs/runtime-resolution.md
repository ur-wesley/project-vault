# Runtime resolution (mise)

When a project directory or any ancestor contains `.mise.toml`, `mise.toml`, or `.tool-versions`, and the `mise` executable is available on `PATH`, task commands are run as:

`mise exec -- <your task argv…>`

Otherwise the task runs with the argv from discovery (for example `npm run dev`, `go test`, …) without a mise wrapper.

## Future fallbacks

Planned or optional extensions: honor `.nvmrc` / `package.json` `engines`, Go toolchain directives, and other version files when mise is not used.
