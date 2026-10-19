# 更新记录 / Changelog

## 0.1.1

修复 Windows 下独立技能被正常读取时，整目录移动可能返回 EPERM 而无法卸载的问题。保留快速整目录移动，短暂占用自动重试；仍受阻时逐项移出并保留恢复文件。确实无法移动时回退已移动内容，明确报告未完成，不误报卸载成功，也不跟随技能内部链接移走共享目标。

Fix standalone skill removal under Windows readers: retry transient sharing failures and recover files individually when a whole-directory move is blocked. Failed moves roll back without replacing new source files, and link targets remain untouched. The same fix was verified in the actual Codex sidebar using isolated project skills: shared reader, exclusive-reader failure, retry after release, normal removal, and refresh after removal.

## 0.1.0

首次公开发布。基于已在 Windows Codex 真实侧栏验证的本地版本：中文清单、来源与位置、实际使用记录、独立启停与卸载确认、部分读取失败保护、并发刷新合并及环境切换提示清除。

提供 GitHub 仓库市场和 npx 安装器；安装器不迁移其他来源的同名插件、不修改全局规则。新增安装器的隔离安装验证与运行包检查独立记录，不把旧安装的侧栏结果当成新分发入口已验证。

First public release of the Chinese-first Codex manager. Includes inventory and explanations, provenance, usage evidence, distinct management actions, partial-failure handling, refresh merging, and scope-specific notices. Adds a GitHub marketplace and npx installer. New distribution-path verification is separate from prior local sidebar acceptance.
