# orsr · LAWOSS

Installs usage skills and setup guidance. It does not install the server program, register an MCP, or connect to any hosted service.

## Your own instance

Obtain the [reviewed organization source](https://github.com/Omni-Legal-Products/mcp-orsr/tree/e2901bea9baaf574d5a834256d918604717a7dca) (GitHub access is required while the repository is private). Checkout revision `e2901bea9baaf574d5a834256d918604717a7dca`, then follow the [local and remote setup guide](docs/SETUP.md) **in that server checkout**, not in this wrapper directory.

You supply your own machine, secrets and HTTPS domain. Plugin updates do not deploy or restart the server. Never reuse another operator's credentials or state.

## Provenance

Organization source: `Omni-Legal-Products/mcp-orsr` at `e2901bea9baaf574d5a834256d918604717a7dca`. [License and attribution](LICENSE) are preserved. Offline tests do not establish live data freshness or legal correctness.
