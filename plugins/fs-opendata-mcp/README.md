# fs-opendata-mcp · LAWOSS

Installs usage skills and setup guidance. It does not install the server program, register an MCP, or connect to any hosted service.

## Your own instance

Obtain the [reviewed organization source](https://github.com/Omni-Legal-Products/mcp-financna-sprava/tree/435a0846e98c1d7ea5a77fb1c58325e772d8d25b) (GitHub access is required while the repository is private). Checkout revision `435a0846e98c1d7ea5a77fb1c58325e772d8d25b`, then follow the [local and remote setup guide](docs/SETUP.md) **in that server checkout**, not in this wrapper directory.

You supply your own machine, secrets and HTTPS domain. Plugin updates do not deploy or restart the server. Never reuse another operator's credentials or state.

## Provenance

Organization source: `Omni-Legal-Products/mcp-financna-sprava` at `435a0846e98c1d7ea5a77fb1c58325e772d8d25b`. [License and attribution](LICENSE) are preserved. Offline tests do not establish live data freshness or legal correctness.
