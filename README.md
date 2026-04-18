# SphereScript (for SphereServer-X) Visual Studio Code Extension

* Work in progress. At the moment the syntax highlighting is pretty good but the extension doesn't feel complete yet, so it's not available in the VSCode store.
* Would like to contribute? See CONTRIBUTING.md and check GitHub issues for feature requests and issues!

## IntelliSense support

The extension now scans all `.scp` files in the workspace and builds autocomplete data from `[FUNCTION ...]` blocks.

- Function names are suggested automatically while typing.
- If a function maps locals from argv (e.g. `local.skill = <argv[0]>`), the completion inserts argument placeholders based on those names.
- Typing `local.` suggests known local names, prioritizing names from the current function block.

## Snippet support

This extension also includes static snippets:

- `f_setSkill` → expands to a function template with `skill` and `value` from `argv[0]`/`argv[1]`.
- `scp-fn-2args` (or `function-2args`) → generic 2-arguments function template with editable placeholders.
