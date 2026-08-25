# dsh-ssh-logs

[English](README.md) | 简体中文

DeepSeek Harness 的只读 SSH 日志工具。它使用 DSH 自带的 `@deepseek-ai/dsh-mcp-client`，向模型提供三个 MCP 工具：

- `mcp__ssh_logs__list_log_servers`
- `mcp__ssh_logs__read_log`
- `mcp__ssh_logs__search_log`

服务器使用固定别名配置。模型不能指定任意主机、执行任意命令或写远端文件；文件路径必须位于配置好的日志根目录内。

## 安装

```bash
git clone https://github.com/452926826/dsh-ssh-logs.git
cd dsh-ssh-logs
npm install
dsh plugin --profile web add "$PWD"
```

创建 `~/.dsh/ssh-logs.yml`，参考 `config.example.yml`。推荐为每台服务器创建只能读取日志的系统用户，并使用 SSH key 或 ssh-agent；不要在 YAML 中保存密码或私钥内容。

配置完成后重启当前 `dsh web` 进程并刷新页面。Bundle 会注册一个 MCP client，让 agent preset 能够发现这些日志工具。

## 对话示例

```text
去 production 服务器 app 日志目录读取 service/api.log 最后 300 行。

在 staging 的 app 根目录搜索 logs/backend.log 里的 request-id=abc123，带 3 行上下文。
```

如果用户说的是物理目录而不是 root 别名，模型应先调用 `list_log_servers`，把目录匹配到配置中的 root，然后调用读取或搜索工具。

## 配置

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

每台服务器支持：`description`、`host`、`user`、`port`、`identityFile`、`knownHostsFile`、`proxyJump`、`roots`、`maxBytes`、`connectTimeoutSeconds`、`commandTimeoutMs`。

## 安全边界

- SSH 强制 `BatchMode=yes`、`StrictHostKeyChecking=yes` 和独立的 `known_hosts` 路径。
- 服务器和日志根目录必须预配置；拒绝绝对路径、反斜杠和 `..` 越界。
- 只生成固定的 `head`、`tail`、`sed`、`grep -F` 远端命令，所有动态值都经过 shell quoting。
- 每次最多读取 5000 行、搜索 1000 个匹配，默认输出上限 128 KiB，可配置但硬上限 4 MiB。
- 不支持密码交互、sudo、任意命令、SFTP 写入、删除或修改文件。

仍应在服务器端实施最小权限：专用 `log-reader` 账户、只读 ACL、受控来源 IP，必要时在 `authorized_keys` 中增加命令或能力限制。
