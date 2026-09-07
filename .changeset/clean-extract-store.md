---
"@modular-prompt/extract": minor
---

feat(extract): add `modular-extract clean` for store and container removal

`modular-extract clean <storename>` removes one named store, while `modular-extract clean --all` removes the entire cache container. Missing stores and containers are treated as successful no-ops.

Closes #351
