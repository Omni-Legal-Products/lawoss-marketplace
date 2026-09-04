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

[Manual local and self-hosted setup](docs/SETUP.md) is included in this wrapper.
It identifies the separate authorized server-source prerequisite, the exact
directory in which server commands run, local client registration, and the
authenticated remote deployment boundary.

The plugin metadata and skill are adapted only from the approved LAWOSS CRZ
revision `b46c3b62a59ef1d502db612dfa7b6511d6c3ff40`. Repository links that are not
anonymously available in the current pilot are deliberately omitted.
