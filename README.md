# Jira MCP

[![npm version](https://img.shields.io/npm/v/%40yunusemregul%2Fjira-mcp.svg)](https://www.npmjs.com/package/@yunusemregul/jira-mcp)
[![CI](https://github.com/yunusemregul/jira-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/yunusemregul/jira-mcp/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.14-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT%20%2B%20Commons%20Clause-yellow.svg)](LICENSE)

A local [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for Jira Cloud. It lets AI clients such as Codex and Claude search issues, inspect descriptions and comments, create or update issues, add rich comments, transition statuses, and read attachments.

Jira access uses an Atlassian account email and API token. Credentials stay on your machine in `~/.jira-mcp/sites.json`; the server binds to `127.0.0.1` by default.

## Features

- Streamable HTTP MCP endpoint with legacy SSE compatibility
- Local Web UI for configuring multiple Jira Cloud sites
- JQL search using Jira Cloud's enhanced `/rest/api/3/search/jql` API
- Issue creation, updates, comments, rich ADF comments, and transitions
- Attachment discovery and bounded inline image downloads
- Tool and client activity log
- Write-only API tokens in the Web UI/API
- User-only config directory and file permissions
- Local MCP OAuth compatibility endpoints for clients that require discovery

## Requirements

- Node.js 22.14 or newer
- A Jira Cloud site
- An Atlassian account email and API token from [Atlassian account security](https://id.atlassian.com/manage-profile/security/api-tokens)
- Optional: [Microsoft markitdown](https://github.com/microsoft/markitdown) for the `attachment_to_markdown` tool

### Optional: markitdown

`attachment_to_markdown` is the one tool that shells out to an external program — [markitdown](https://github.com/microsoft/markitdown), a Python tool. Install it either way:

```bash
pip install "markitdown[all]"   # puts "markitdown" on PATH
# or install uv, and "uvx markitdown" is fetched on demand
```

Already have it in a virtualenv? Point at it directly instead:

```bash
JIRA_MARKITDOWN_CMD="/opt/venv/bin/markitdown"
```

If none of these are present, `attachment_to_markdown` returns an error naming each command it tried and how to install it. **Nothing else is affected** — the server starts normally and every other tool, including `download_attachment`, works with no Python installed.

## Installation

### Run with npx

```bash
npx --yes @yunusemregul/jira-mcp@latest
```

### Install globally

```bash
npm install --global @yunusemregul/jira-mcp
jira-mcp
```

The Web UI opens at `http://127.0.0.1:18433`. Add a Jira site, email, and API token there.

```text
Options:
  -p, --port    Port to listen on (default: 18433, env: PORT)
      --host    Host to bind (default: 127.0.0.1, env: HOST)
  -v, --version Print version
  -h, --help    Show help
```

## Connect an MCP client

### Codex

```bash
codex mcp add jira-mcp --url http://127.0.0.1:18433/mcp
```

Or add this to `~/.codex/config.toml`:

```toml
[mcp_servers.jira-mcp]
url = "http://127.0.0.1:18433/mcp"
```

### Claude Code

```bash
claude mcp add --transport sse jira-mcp http://127.0.0.1:18433/mcp/sse
```

### Other Streamable HTTP clients

```json
{
  "mcpServers": {
    "jira-mcp": {
      "url": "http://127.0.0.1:18433/mcp"
    }
  }
}
```

Some MCP clients require OAuth discovery even for a local server. Jira MCP exposes the same auto-approve compatibility endpoints as `hac-mcp`. They do not authenticate or authorize Jira access; the loopback bind is the security boundary.

## Available tools

| Tool | Description |
|---|---|
| `list_sites` | List configured Jira sites without exposing credentials |
| `get_projects` | List or filter accessible Jira projects |
| `search_issues` | Search issues with JQL and token-based pagination |
| `get_issue` | Read issue details, comments, custom text fields, and attachments |
| `create_issue` | Create an issue |
| `update_issue` | Update summary, description, priority, assignee, or labels |
| `add_comment` | Add a plain-text comment |
| `add_comment_rich` | Add an Atlassian Document Format comment |
| `get_comments` | Read comments |
| `update_comment` | Replace an existing comment |
| `get_attachments` | List issue attachments and referenced media IDs |
| `read_attachment` | Read a bounded attachment; images are returned inline |
| `download_attachment` | Download an attachment to a local file and return its path for direct parsing |
| `attachment_to_markdown` | Convert an attachment (xlsx, docx, pptx, PDF, HTML, CSV…) to Markdown via Microsoft markitdown |
| `get_transitions` | List available status transitions |
| `transition_issue` | Transition an issue, optionally with a comment |

## Configuration

The CLI accepts these optional environment variables:

| Variable | Default | Purpose |
|---|---:|---|
| `HOST` | `127.0.0.1` | HTTP bind host |
| `PORT` | `18433` | HTTP port |
| `JIRA_REQUEST_TIMEOUT_MS` | `30000` | Jira HTTP request timeout |
| `JIRA_MAX_ATTACHMENT_BYTES` | `20971520` | Maximum attachment download size (applies to `read_attachment` and `download_attachment`) |
| `JIRA_MCP_DATA_DIR` | `~/.jira-mcp` | Config directory; primarily useful for tests/isolated runs |
| `JIRA_MARKITDOWN_CMD` | `markitdown` (falls back to `uvx markitdown`) | Command used by `attachment_to_markdown` |
| `JIRA_MARKITDOWN_TIMEOUT_MS` | `120000` | `attachment_to_markdown` conversion timeout |
| `JIRA_MARKITDOWN_MAX_CHARS` | `200000` | Max Markdown characters returned by `attachment_to_markdown` |

## Security

- Keep the default loopback bind. Setting `HOST=0.0.0.0` exposes an unauthenticated local MCP service and Web UI; only do this behind a trusted authenticated reverse proxy.
- API tokens are stored locally in plaintext because the server must use them. The config directory is forced to mode `0700` and `sites.json` to `0600` on POSIX systems.
- API responses never return saved tokens. When editing a site, leave the token field blank to retain the existing token.
- Jira site URLs must use HTTPS and cannot embed credentials.
- The local OAuth compatibility endpoints auto-approve clients and are not a security mechanism.
- Attachment downloads default to a 20 MiB limit.

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Development

```bash
npm ci
npm run verify
npm start
```

`npm run verify` runs ESLint and the Node test suite. `npm publish` runs the same checks automatically through `prepublishOnly`.

## Publishing

The npm package name is `@yunusemregul/jira-mcp`. The first publish must be performed interactively after enabling npm 2FA:

```bash
npm login
npm run verify
npm publish --access public
```

After the package exists, configure npm Trusted Publishing for `.github/workflows/publish.yml`. Subsequent `v<package-version>` tags publish from GitHub Actions using OIDC and npm provenance without a long-lived write token.

## License

MIT License with the Commons Clause condition. See [LICENSE](LICENSE).
