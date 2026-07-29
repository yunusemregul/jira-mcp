# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.1] - 2026-07-29

### Changed

- `attachment_to_markdown` now distinguishes a missing converter from a failing one: unusable commands (`ENOENT`, `EACCES`, `EPERM`, `ENOTDIR`) fall through to the next candidate, while errors from markitdown itself surface immediately with its stderr
- A conversion that hits `JIRA_MARKITDOWN_TIMEOUT_MS` now reports the timeout and the setting to raise, instead of an opaque failure
- The "markitdown is not available" error now lists every command tried and how to install it, and notes that no other tool is affected
- Documented markitdown as an optional dependency in the README and `.env.example`, including the `JIRA_MARKITDOWN_*` settings

## [1.1.0] - 2026-07-29

### Added

- `download_attachment` tool: streams an attachment to a local file and returns its path, so clients can open or parse spreadsheets, PDFs, and documents directly instead of decoding base64
- `attachment_to_markdown` tool: converts an attachment (xlsx, docx, pptx, PDF, HTML, CSV, and more) to Markdown via Microsoft markitdown, with `uvx markitdown` fallback

## [1.0.0] - 2026-07-17

### Added

- Streamable HTTP and legacy SSE MCP transports
- Jira Cloud issue, comment, transition, project, and attachment tools
- Multiple-site Web UI and local activity log
- Local OAuth compatibility endpoints for MCP clients
- Loopback-only default binding and protected credential storage
- Automated tests, linting, CI, and trusted publishing workflow
