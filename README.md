# SphereScript (for SphereServer-X) Visual Studio Code Extension

* Work in progress. At the moment the syntax highlighting is pretty good but the extension doesn't feel complete yet, so it's not available in the VSCode store.
* Would like to contribute? See CONTRIBUTING.md and check GitHub issues for feature requests and issues!

## New: FUNCTION signature autocomplete

When you're editing an `.scp` file, the extension now scans all `.scp` files in the same workspace folder and detects blocks like:

```scp
[FUNCTION getAurea]
local.player = <argv[0]>
local.skill = <argv[1]>
local.timer = <argv[2]>
```

Then it suggests:

- `getAurea (player, skill, timer)`

The inserted text is only the function name (`getAurea`), while the suggestion label helps you remember the expected locals.
