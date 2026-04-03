---
"@modular-prompt/process": patch
---

toolAgentProcess: 毎ターン re-compile + handler に context を渡す拡張。ToolAgentContext 型を追加し、ToolSpec の handler シグネチャに context 引数を追加。
