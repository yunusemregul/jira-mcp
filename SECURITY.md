# Security Policy

## Supported versions

Security fixes are provided for the latest published version.

## Reporting a vulnerability

Please report vulnerabilities privately to `yunemregul@gmail.com`. Include reproduction steps, impact, and any suggested mitigation. Do not include real Jira API tokens, issue data, or other credentials.

Please allow a reasonable period for investigation and remediation before public disclosure.

## Deployment boundary

Jira MCP is designed as a single-user local service and binds to `127.0.0.1` by default. Its OAuth endpoints exist only for MCP client compatibility and auto-approve requests; they are not an authentication boundary. Do not expose the service to a network without adding an authenticated reverse proxy and transport security.
