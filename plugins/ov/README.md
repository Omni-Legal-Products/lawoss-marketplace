# ov · LAWOSS

Installs usage skills and setup guidance. It does not install the server program, register an MCP, or connect to any hosted service.

## Your own instance

Obtain the [reviewed organization source](https://github.com/Omni-Legal-Products/mcp-obchodny-vestnik/tree/8574d8dfb6cfa60b31a65ded2590d2819a96f8b3) (GitHub access is required while the repository is private). Checkout revision `8574d8dfb6cfa60b31a65ded2590d2819a96f8b3`, then follow the [local and remote setup guide](docs/SETUP.md) **in that server checkout**, not in this wrapper directory.

You supply your own machine, secrets and HTTPS domain. Plugin updates do not deploy or restart the server. Never reuse another operator's credentials or state.

## Provenance

Organization source: `Omni-Legal-Products/mcp-obchodny-vestnik` at `8574d8dfb6cfa60b31a65ded2590d2819a96f8b3`. [License and attribution](LICENSE) are preserved. Offline tests do not establish live data freshness or legal correctness.
