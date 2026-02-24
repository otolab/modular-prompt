---
"@modular-prompt/core": patch
"@modular-prompt/driver": patch
"@modular-prompt/experiment": patch
---

chore: npmパッケージにskillsを同梱する仕組みを追加

prepublishOnly時にskills/<skill-name>/SKILL.mdをパッケージ内にコピーし、npmパッケージに含めるようにした。
- core: skills/prompt-writing/SKILL.md
- driver: skills/driver-usage/SKILL.md
- experiment: skills/experiment/SKILL.md
