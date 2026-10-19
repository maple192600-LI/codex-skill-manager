# 安装与验收 / Installation and acceptance

## 安装

1. 检查 `node --version`（24+）、`git --version`、`codex plugin add --help`。Windows 桌面安装器可自动寻找 Codex 自带的 CLI；也可用环境变量 `SKILL_MANAGER_CODEX_PATH` 指定可信的原生 Codex 程序。
2. 阅读仓库源码及权限说明后执行：

   ```sh
   npx --yes github:maple192600-LI/codex-skill-manager install
   ```

3. 安装器先读取现有安装。已有同一安装则保留；其他来源的同名插件则停止，不替用户卸载或迁移。
4. 新安装使用原生 marketplace add / plugin add，并再次读取原生清单确认 `skill-manager@codex-skill-manager`。不手工覆盖配置、不追加 AGENTS.md。
5. 重启 Codex 后说“打开技能管理器”。在实际侧栏检查清单、中文说明和管理器版本。命令返回成功不等于已打开的宿主进程完成重载。

`npx` 与原生 marketplace clone 都需要访问 GitHub。运行包已提交到仓库；不需要额外下载本项目提供的未知二进制。

## 不使用 npx

```sh
codex plugin marketplace add maple192600-LI/codex-skill-manager --ref main
codex plugin add skill-manager@codex-skill-manager
```

本地开发也可以注册仓库的完整路径，再执行同一 plugin add 命令。不要把已经使用中的其他安装当作测试对象。

## English

Check Node.js 24+, Git, and native Codex plugin support. The one-command installer registers this repository marketplace and installs only `skill-manager@codex-skill-manager`, followed by native readback. It preserves an existing same-market installation and stops on a same-name plugin from another source. It does not edit AGENTS.md.

Restart Codex, ask to open Skill Manager, and verify the actual host sidebar. A successful CLI result does not prove the running desktop process has reloaded. Use the two native commands above if you prefer not to use npx. Installation requires GitHub access. Other operating systems remain unverified in the real desktop client.
