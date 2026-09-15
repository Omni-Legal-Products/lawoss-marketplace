# Slov-Lex 1.1.1 acceptance

Source: `Omni-Legal-Products/mcp-slovlex` commit `69b16970d38f6232d8b5a3c1c6231ac5c864203b`.

- Source tests: 85 passed; 8 organization contract tests passed; TypeScript build passed.
- Six regression tests fail against the previous parser and pass with the fix.
- Independent parser review confirmed that every non-whitespace character of the captured 63/2024 article bodies is preserved in order.
- Catalog: 44 Python tests, 3 runtime policy tests, public-content validator, Codex plugin validator, Claude marketplace validator and instruction mirrors passed.
- Isolated Codex Git-marketplace install/update/rollback: version 1.1.0 returned 0 article characters, 1.1.1 returned 3,852 characters for 63/2024 at 2024-04-01, rollback to 1.1.0 returned 0. All three stages exposed 10 tools and supported warm startup without npm. Runtime caches were separated and rollback reused the original cache.
- Compatible transitive dependency patches cover xmldom, fast-uri, hono and qs. The matching dependency refresh passed a production npm audit in GitHub Actions.

Tests establish behavior for the captured HTML and selected live read. They do not establish legal applicability or universal coverage of every Slov-Lex document structure. Public plugin publication and hosted deployment remain separate operations.
