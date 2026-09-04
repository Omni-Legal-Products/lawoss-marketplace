# CRZ marketplace wrapper

Installing `crz@lawoss` provides:

- public LAWOSS plugin metadata;
- the `crz-register-zmluv` usage skill for CRZ research workflows; and
- this installation boundary and setup guidance.

It does **not** include the CRZ MCP server program, create `.mcp.json`, change a
client's MCP registrations, or connect to a hosted endpoint. The user must run
and register an instance they control before the tools named by the skill can be
called.

## Set up your own CRZ server

- [Local stdio installation](https://github.com/Omni-Legal-Products/mcp-crz/blob/main/INSTALL.md#1-lok%C3%A1lny-stdio-server)
- [Authenticated self-hosting](https://github.com/Omni-Legal-Products/mcp-crz/blob/main/INSTALL.md#3-docker-compose-s-oauth)
- [CRZ MCP project documentation](https://github.com/Omni-Legal-Products/mcp-crz#readme)

Use an absolute path when registering a local build. For a remote deployment,
use only your own HTTPS domain and require authentication. The example domain in
the source documentation is a placeholder, not an operated service.

The plugin manifest and skill were copied from the approved LAWOSS CRZ revision
`b46c3b62a59ef1d502db612dfa7b6511d6c3ff40`.
