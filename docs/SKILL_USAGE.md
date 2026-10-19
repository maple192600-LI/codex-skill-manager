# 可选：记录实际技能使用 / Optional actual skill-use recording

工具调用历史可以直接在本机读取。技能是否实际采用，无法仅凭读取说明或聊天中的一句话可靠确认，因此需要 agent 的实际使用记录。

安装器不会改写全局 `AGENTS.md`。若你希望启用记录，可先让 agent 展示拟追加内容，再明确同意追加到自己的全局或项目规则。已有相同规则时保留原规则，不重复追加。

可采用下面的规则；宿主可能给工具名增加前缀，应按实际可发现的工具调用：

```text
每轮真实工作结束前，若提供 skill_manager_record_usage 工具，调用一次。
skillPaths 只填本轮已经实际采用的 Skill 的完整 SKILL.md 路径；同轮同技能只记一次。
没有采用技能时传空数组，以区分未使用和没有记录。
不记录仅作为安装、盘点或审查目标而读取的技能；实际采用的辅助技能可记录。
只提交路径，不提交聊天正文、任务内容或用户资料。不补造历史使用。
工具不可用时继续原任务，不反复重试，不声称记录成功。
```

开始记录前的历史无法补齐。记录不完整时，页面保留已确认的使用次数，不输出完整频率，也不判为从未使用。

## English

Tool calls can be analyzed from local history. Actual skill adoption requires explicit agent receipts; reading a skill or mentioning it is insufficient. The installer never modifies global instructions.

If you opt in, review and explicitly approve a corresponding global/project instruction: once per completed turn, submit full paths of skills actually applied to `skill_manager_record_usage`; deduplicate within the turn; submit an empty array if no skill was applied. Exclude skills only inspected as installation/audit targets. Send paths only, never message content. Continue the original task if the tool is unavailable and do not fabricate success or past usage. Preserve existing equivalent instructions rather than adding duplicates.
