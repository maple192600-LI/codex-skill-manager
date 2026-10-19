# 验证范围 / Validation scope

## 0.1.1：Windows 技能卸载

- 用真实 Windows 文件读取句柄复现原有 EPERM 整目录移动失败，新增 6 项回归检查；完整源码与安装器检查为 95 项通过。
- 重建运行包后，通过实际 MCP 请求验证共享读取下卸载、独占读取下保留文件与清单、释放占用后重试成功，以及恢复文件的内容一致性。原生 Codex 强制重读也确认入口已移除。
- 修复版本在 Windows Codex 的真实侧栏重新加载，逐项操作隔离项目技能：共享读取时卸载成功；独占读取时明确报告未完成、保留两项技能且不显示旧成功提示；释放占用后同项卸载成功并清除错误；普通卸载正常；刷新后测试技能未重新出现。清除筛选并返回个人环境后清单完整。
- 验收不卸载或切换日常使用的插件和技能；真实界面验收期间个人配置字节未变。恢复文件逐一核对，不只检查成功提示或编译结果。

The Windows removal regression was reproduced with real file handles. Six new regression checks bring the full source/installer suite to 95 passing checks. The rebuilt MCP runtime and native Codex readback were tested separately from the actual desktop sidebar. The sidebar was then verified with isolated project skills for shared-reader removal, honest exclusive-reader failure with retained content, successful retry after release, ordinary removal, and refresh without resurrecting removed entries. Existing user skills and plugins were not uninstalled or toggled.

## 首次公开发布

实际测试环境：Windows、Node.js 24.18.0、npm 12.0.2、Codex CLI 0.163.0-alpha.10.2。

- 89 项源码与安装器检查通过，包含原生配置隔离、技能开关保护、卸载确认、并发刷新、历史缺失与实际技能记录口径。
- 单独对 npm 打出的完整包做安装验收：注册市场、原生安装、重复安装回读；从 Codex 缓存启动 MCP；读取内嵌界面和隔离清单；在空的合成 SQLite 历史表上完成统计；原生 Codex 发现 12 个工具。
- 创建公开仓库后，实际运行 README 中的 `npx --yes --allow-git=root github:maple192600-LI/codex-skill-manager install`，从 GitHub 获取并安装成功。随后从这次安装的缓存启动插件，读取内嵌界面和原生清单、完成合成历史统计，并由原生 Codex 发现全部 12 个工具。
- 这些安装流程使用单独的 CODEX_HOME，不在真实使用中的插件或技能上测试卸载，不复制个人聊天数据。
- 包中包含运行包和统计 worker；不包含 node_modules、个人配置、聊天历史、统计缓存、本机验收截图或诊断日志。
- 两份依赖清单在发布前的 npm audit 检查均为零项已知漏洞。这是当时的检查结果，不是永久安全保证。

界面功能来自已在 Windows Codex 真实侧栏操作过的版本：清除筛选、分类切换、单独启停与卸载提示、慢刷新与查询失败恢复、个人/项目环境双向切换。公共分发包的原生安装与 MCP 启动单独验证；没有把独立网页当成真实宿主。

其他系统、Claude Code 和未来 Codex 版本尚未完成相同客户端验收。全新或格式不兼容的历史库可能暂时无法统计，页面会保持未知；缺失记录不能补成“未使用”。

## English

The tested environment is Windows, Node.js 24.18.0, npm 12.0.2, and Codex CLI 0.163.0-alpha.10.2. The source/installer suite has 89 passing checks. A packed archive is separately installed into an isolated CODEX_HOME: native installation and repeat readback, cached MCP startup, embedded UI retrieval, inventory, indexing empty synthetic SQLite history, and discovery of 12 native MCP tools. The exact documented npx command was then run against the public GitHub repository, followed by the same cached-runtime and native-tool checks for that installation.

No personal chat history, configuration, caches, local acceptance screenshots, or diagnostic logs are distributed. Both dependency lockfiles had zero known npm audit findings at publication time; this is not a permanent security guarantee. Prior real Windows sidebar acceptance and public distribution-path acceptance are distinct. Other platforms and future host versions remain unverified.
