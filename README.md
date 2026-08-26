# dsh-ssh-logs

English | [简体中文](README.zh-CN.md)

A read-only SSH log tool for DeepSeek Harness. It uses the built-in `@deepseek-ai/dsh-mcp-client` bridge to expose three MCP tools to the model:

- `mcp__ssh_logs__list_log_servers`
- `mcp__ssh_logs__read_log`
- `mcp__ssh_logs__search_log`

Servers are configured under fixed aliases. The model cannot select arbitrary hosts, execute arbitrary commands, or modify remote files. Every requested file must remain under an allowlisted log root.

## Installation

```bash
git clone https://github.com/452926826/dsh-ssh-logs.git
cd dsh-ssh-logs
npm install
dsh plugin --profile web add "$PWD"
```

It can also be installed directly from GitHub:

```bash
dsh plugin --profile web add github:452926826/dsh-ssh-logs
```

Create `~/.dsh/ssh-logs.yml` using `config.example.yml` as a reference. Use a dedicated read-only account on each server and authenticate with an SSH key or ssh-agent. Do not store passwords or private key contents in the YAML file.

Restart `dsh web` and refresh the page after configuring the plugin. The Bundle registers an MCP client so agent presets can discover the log tools.

## Conversation examples

```text
Read the last 300 lines of service/api.log from the app log root on production.

Search logs/backend.log under staging/app for request-id=abc123 and include 3 lines of context.
```

If a request names a physical directory instead of a root alias, the model should call `list_log_servers` first, map the directory to a configured root, and then call the read or search tool.

## Configuration

```yaml
defaults:
  maxBytes: 131072
  connectTimeoutSeconds: 10
  commandTimeoutMs: 120000

servers:
  production:
    description: Production application server
    host: prod-app.example.com
    user: log-reader
    port: 22
    identityFile: ~/.ssh/prod_log_reader
    knownHostsFile: ~/.ssh/known_hosts
    proxyJump: bastion.example.com
    roots:
      app: /srv/myapp/logs
      nginx: /var/log/nginx
```

Each server supports `description`, `host`, `user`, `port`, `identityFile`, `knownHostsFile`, `proxyJump`, `roots`, `maxBytes`, `connectTimeoutSeconds`, and `commandTimeoutMs`.

## Security boundaries

- SSH always uses `BatchMode=yes`, `StrictHostKeyChecking=yes`, and an explicit `known_hosts` path.
- Servers and log roots must be configured in advance. Absolute paths, backslashes, and `..` traversal are rejected.
- The plugin only generates fixed `head`, `tail`, `sed`, and `grep -F` commands. Dynamic values are shell-quoted.
- A request can read at most 5,000 lines or return 1,000 search matches. Output defaults to 128 KiB and has a hard 4 MiB limit.
- Password prompts, sudo, arbitrary commands, SFTP writes, deletion, and file modification are not supported.

Enforce least privilege on the server as well: use a dedicated `log-reader` account, read-only ACLs, restricted source IPs, and `authorized_keys` restrictions when appropriate.
