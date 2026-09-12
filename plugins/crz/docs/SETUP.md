# CRZ local runtime setup

The plugin now includes a reviewed local runtime and CLI. Follow the [plugin installation guide](../README.md). The correct stdio entrypoint is `dist/index.js`, wrapped by `scripts/run.mjs`; `dist/server.js` is a library and must not be used as a standalone MCP process.

No remote MCP connection is included. Operators who independently deploy the organization source should use that source's deployment documentation.
