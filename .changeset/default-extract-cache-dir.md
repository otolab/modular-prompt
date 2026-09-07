---
"@modular-prompt/extract": minor
---

feat(extract): change the default CLI cache container to `~/.modular-prompt/extract-cache`

`modular-extract` create / extract / list now use the user-level cache container when `-d` is omitted. Existing `./.extract-cache` data is not automatically migrated; see the manual migration instructions in the README.

Closes #352
