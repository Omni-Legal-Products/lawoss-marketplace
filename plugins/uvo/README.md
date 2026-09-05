# uvo · LAWOSS

Installs usage skills and setup guidance. It does not install the server program, register an MCP, or connect to any hosted service.

## Your own instance

Obtain the [reviewed organization source](https://github.com/Omni-Legal-Products/mcp-uvo/tree/6219716c9d149067360627486aa1f0cdf4d92878) (GitHub access is required while the repository is private). Checkout revision `6219716c9d149067360627486aa1f0cdf4d92878`, then follow the [local and remote setup guide](docs/SETUP.md) **in that server checkout**, not in this wrapper directory.

You supply your own machine, secrets and HTTPS domain. Plugin updates do not deploy or restart the server. Never reuse another operator's credentials or state.

## Provenance

Organization source: `Omni-Legal-Products/mcp-uvo` at `6219716c9d149067360627486aa1f0cdf4d92878`. [License and attribution](LICENSE) are preserved. Offline tests do not establish live data freshness or legal correctness.
