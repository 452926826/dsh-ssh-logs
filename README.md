# dsh-ssh-logs

English | [Simplified Chinese](README.zh-CN.md)

Controlled SSH command execution for DeepSeek Harness, with a Web configuration page and `@server` composer selection. After installation, add, edit, or remove servers under Settings > Plugins > SSH servers.

## Install

Requires DSH `>=0.2.2-rc.1 <0.3.0-0` and Node.js 20 or later.

```bash
dsh plugin --profile web add github:452926826/dsh-ssh-logs
```

Restart `dsh web` and refresh the page. The bundle loads the Host configuration service, Web settings view, and constrained MCP tools.

## SSH configuration

Each server has:

- A stable SSH name used in conversations
- Host or IP address, port, and username
- Password authentication, with legacy YAML SSH-key configuration supported
- `allowedCommands`: the executable names permitted only in read-write mode (optional for legacy YAML)
- `deniedCommands`: an optional list that always overrides the allowlist

Passwords are stored on the DSH host in `$DSH_HOME/ssh-logs/servers.json` with mode `0600`. Neither the API nor browser returns passwords; editing with a blank password preserves it only if the connection identity is unchanged. Changing host, port, user, jump host, or identity file requires new credentials.

Password authentication cannot be combined with `proxyJump`; use an SSH key for jump-host connections. Password authentication runs SSH with `-F /dev/null`, ignoring user and system SSH configuration, including host aliases, proxy commands, and other custom options. Configure the real host, port, user and known-hosts file explicitly. Key-based authentication retains the normal SSH configuration behavior.

Read-only servers expose `read_log` and `search_log` for roots configured in YAML. General `run_remote_command` requires explicitly enabling remote commands (read-write) and a non-empty executable allowlist. The allowlist is not a sandbox: approved programs and arguments can modify files or execute other programs. Never enable this for untrusted users or servers.

Legacy configurations without `allowedCommands` remain usable for root-based log tools, but no general commands are allowed. A settings-page server overrides a same-name YAML server; configure log roots in YAML on a separate alias. Log-root checks are lexical and do not prevent remote symlinks from escaping the root. Enforce read-only access and path restrictions with server-side account permissions.

## Use in conversations

Type `@` in the composer and select an SSH server:

```text
@production run tail -n 300 /var/log/nginx/access.log
@staging run grep -nF request-id=abc123 /srv/app/backend.log
```

The picker inserts `@server-name`. Use the root-based log tools for read-only servers; general commands require read-write authorization. Credentials never enter conversation context.

## Security boundaries

- SSH requires a trusted host key in `known_hosts`. Verify the fingerprint through an independent channel before adding it; `ssh-keyscan` alone does not authenticate a host.
- Commands are default-deny and a denial always overrides an allow rule.
- Each request is one command: shell control operators, pipes, redirects, substitutions, and line breaks are rejected.
- Command output has byte and timeout limits.
- Passwords are never returned through the API, MCP server list, or `@` candidates.
- Production deployments should still use dedicated low-privilege accounts, source-IP restrictions, and server-side permissions.

## YAML example

```yaml
servers:
  production:
    host: prod-app.example.com
    user: log-reader
    port: 22
    identityFile: ~/.ssh/prod_log_reader
    roots:
      app: /srv/myapp/logs
    allowedCommands:
      - tail
      - grep
      - ls
    deniedCommands:
      - rm
      - sudo
      - sh
      - bash
```
