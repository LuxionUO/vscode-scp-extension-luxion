# SphereScript (for SphereServer-X) Visual Studio Code Extension

* Work in progress. At the moment the syntax highlighting is pretty good but the extension doesn't feel complete yet, so it's not available in the VSCode store.
* Would like to contribute? See CONTRIBUTING.md and check GitHub issues for feature requests and issues!

## New: FUNCTION signature autocomplete

When you're editing an `.scp` file, the extension scans all `.scp` files recursively in the entire opened workspace/project and detects blocks like:

```scp
[FUNCTION getAurea]
local.player = <argv[0]>
local.skill = <argv[1]>
local.timer = <argv[2]>
```

Then it suggests:

- `getAurea (player, skill, timer)`

The inserted text is only the function name (`getAurea`), while the suggestion label helps you remember the expected locals.

Completions are triggered while typing (letters, numbers, `_`, `[` and `.`), including object-style names like `src.setbuff`.

## New: section autocomplete (ITEM/AREADEF/REGIONTYPE/TYPEDEF/DIALOG)

The extension now also scans section headers and suggests entries like:

- `[item] i_bandage`
- `[areadef] a_town`
- `[regiontype] r_default`
- `[type] t_custom`
- `[dialog] d_vendor`
- `[function] f_example (arg1, arg2)`

The inserted text remains the symbol name only, so selecting `[item] i_bandage` inserts `i_bandage`.
