# dsh-ssh-logs

[English](README.md) | 简体中文

为 DeepSeek Harness 提供受控 SSH 命令执行、可视化配置和 `@服务器` 选择。安装后在“设置 → 插件 → SSH 服务器”中新增、修改或删除服务器。

## 安装

需要 DSH `>=0.2.2-rc.1 <0.3.0-0` 和 Node.js 20 或更高版本。

```bash
dsh plugin --profile web add github:452926826/dsh-ssh-logs
```

重启 `dsh web` 并刷新页面。插件会同时加载 Host 配置服务、Web 设置页和受控 MCP 工具。

## SSH 配置

每个服务器支持：

- SSH 名称：对话中的稳定别名
- IP 或主机名、端口、账号
- 密码认证，旧版 YAML 可配置 SSH key
- `allowedCommands`：仅在读写模式下允许的命令名列表（旧版 YAML 可省略）
- `deniedCommands`：可选的禁止命令名列表，始终优先于允许规则

密码保存在当前 DSH 主机的 `$DSH_HOME/ssh-logs/servers.json`，文件权限为 `0600`。API 和浏览器不返回密码；仅连接身份不变时编辑留空才保留旧密码，变更主机、端口、账号、跳板机或密钥文件需要重新提供凭据。

密码认证不能与 `proxyJump` 同时使用；跳板机连接请使用 SSH key。密码认证通过 `-F /dev/null` 忽略用户和系统 SSH 配置，包括主机别名、代理命令及其他自定义选项；请明确配置真实主机、端口、账号和 known-hosts 文件。SSH key 认证保持原有 SSH 配置行为。

只读服务器通过 `read_log` 和 `search_log` 访问 YAML 中配置的日志根目录。通用 `run_remote_command` 需要显式开启远程命令（读写权限），且命令名必须在允许列表中。命令白名单不是沙箱：允许的程序及参数可能修改文件或执行其他程序，不能用于不可信用户或服务器。

旧配置缺少 `allowedCommands` 时仍可使用日志根目录工具，但不允许任何通用命令。设置页中的同名服务器会覆盖 YAML 配置；请为 YAML 日志根目录使用独立别名。根目录检查只处理路径字符串，远端符号链接可能越界；必须通过服务器端账号权限限制读取范围。

## 对话使用

在输入框输入 `@`，选择某个 SSH 服务器：

```text
@production 执行 tail -n 300 /var/log/nginx/access.log
@staging 执行 grep -nF request-id=abc123 /srv/app/backend.log
```

选择后会插入 `@服务器名`。只读服务器使用日志根目录工具，通用命令需要读写授权；密码不会进入对话上下文。

## 安全边界

- SSH 要求 `known_hosts` 中已有可信主机密钥。写入前应通过独立渠道核验指纹；`ssh-keyscan` 本身不能认证主机。
- 默认拒绝；禁止规则始终覆盖允许规则。
- 每次只能运行一个命令；拒绝 shell 控制操作符、管道、重定向、命令替换和换行。
- 命令输出受字节数和超时限制。
- 密码不通过 API、MCP 工具列表或 `@` 候选返回。
- 生产环境仍应使用专用低权限账号、受控来源 IP，并限制远端权限。

## YAML 示例

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
