# cz-agents · LAWOSS

Installs setup guidance only (no bundled usage skill). It does not install the server program, register an MCP, or connect to any hosted service.

## Your own instance

Obtain the [reviewed organization source](https://github.com/Omni-Legal-Products/mcp-cz-agents/tree/fea07bf6076e8b548da2d715b082fa04556abde9) (GitHub access is required while the repository is private). Checkout revision `fea07bf6076e8b548da2d715b082fa04556abde9`, then follow the [local and remote setup guide](docs/SETUP.md) **in that server checkout**, not in this wrapper directory.

You supply your own machine, secrets and HTTPS domain. Plugin updates do not deploy or restart the server. Never reuse another operator's credentials or state.

## Provenance

Organization source: `Omni-Legal-Products/mcp-cz-agents` at `fea07bf6076e8b548da2d715b082fa04556abde9`. [License and attribution](LICENSE) are preserved. Offline tests do not establish live data freshness or legal correctness.
