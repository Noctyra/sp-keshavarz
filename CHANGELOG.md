# Change Log

All notable changes to the "sp-keshavarz" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.7.1]

### Fixed

- **Type from JSON rejected copied fragments.** Pasting `"response": { ... }` —
  which is what copying one field out of a response body gives you — is not
  valid JSON and failed to parse. A fragment is now retried as the body of an
  object, and a trailing comma is trimmed.
- A lone `response` or `results` key is now treated as an envelope and unwrapped;
  previously it needed a sibling field like `is_success`, which a copied
  fragment does not have.

## [0.7.0]

- Added **Type from JSON** (`Ctrl+Alt+J`): turns a sample API response into an
  `export type` at the cursor, read from the selection, the clipboard, or a
  prompt.
- `GlobalData` and `PaginatedData` envelopes are unwrapped automatically, so
  what you get is the `T` that goes inside them.
- Inference merges every sample: fields missing from some rows become optional,
  values that are sometimes null become unions, and API key names are preserved
  verbatim.

## [0.6.0]

### Fixed

- **Duplicate As... renamed file contents but not file or folder names** in any
  folder whose files share no common prefix — which included every `*Mutation`
  folder, because `use<Name>.ts` breaks the prefix. Candidate names are now
  scored by how many of the folder's file names they actually occur in, and the
  best-covering one wins.
- Duplicating a folder whose name does not contain the detected name no longer
  fails with "already exists"; the name you type becomes the folder name.
- Acronyms survive duplication: `getFileSMSStatus` is matched verbatim instead
  of being normalised to `getFileSmsStatus` and matching nothing.
- **Generating from the keyboard wrote into the open file's own folder.** A
  recipe without a `target` now searches upwards for the folder its output
  belongs in, so a component generated while editing a page lands in the
  module's `components` folder. Explorer right-clicks are still obeyed exactly.

## [0.5.0]

- Added **Duplicate As...** on the explorer folder menu: copies a folder and
  rewrites every casing of its name through contents, file names, nested folders
  and import paths.
- What gets renamed is detected from the folder's contents rather than assumed:
  a `getWalletQuery` folder whose files are `getWallet.*` renames `getWallet`.
- The whole duplicate is one WorkspaceEdit, so `Ctrl+Z` undoes it — which is why
  there is no dry-run or validate mode.
- Binary files are copied byte-for-byte instead of being run through the rename.

## [0.4.0]

- `Ctrl+Alt+N` (`Cmd+Alt+N` on macOS) opens the generator picker, so the whole
  flow is reachable without the mouse.
- Added `sp-keshavarz.generate`, which takes a `{ "recipe": "<id>" }` argument so
  a key can be bound straight to one generator, including recipes added later.
  Binding an unknown id reports the available ones.

## [0.3.0]

- Recipes can read their choices out of the project: a `prompts` entry backed by
  `dirs` (subfolder names), `exports` (names exported from a file) or a fixed
  `values` list.
- A `dirs` prompt infers its answer from the folder you invoked from and does
  not ask at all — generating from anywhere under `modules/finance` knows the
  module is `finance`. `"alwaysAsk": true` opts out.
- Recipes can declare a `target`, a package-root-relative destination, so
  generating no longer depends on having navigated to the right folder first.
  The folder is created if it does not exist.
- When a recipe would redirect and the value could not be inferred, the chooser
  offers "Here" first, which generates into the folder you clicked.
- `hints` float a recipe to the top of the picker when it matches the folder
  name, so right-clicking `queries` offers Query first.

## [0.2.0]

- Generators are now recipes: a folder in `recipes/` with a `recipe.json` and its
  templates. Adding one no longer means touching TypeScript, and recipes are
  re-read on each run so edits apply without reloading the window.
- Templates gained case filters (`<<pascal name>>`, `<<kebab name>>`, and
  `camel`/`snake`/`constant`/`lower`/`upper`), which work in file and folder
  paths as well as file bodies.
- Templates gained `<<#if flag>>` / `<<#else>>` / `<</if>>`, driven by yes/no
  `options` a recipe declares. Files can be skipped entirely with `"when"`.
- `<<import id>>` resolves the alias-correct specifier for another file in the
  same recipe, replacing the hand-computed import paths.
- A malformed recipe is skipped with an explanation instead of breaking the
  other generators.

## [0.1.0]

- Generated files now open as live snippets: `Tab` jumps between the placeholders
  you have to fill in, instead of leaving you to hunt for the empty `{}`s.
- Generation runs inside the extension rather than in a spawned `node` process.
  Creating the files is a single undo, and the editor can drive the tab stops.
- Templates use an explicit `<<Name>>` / `<<1>>` marker syntax, replacing the
  sentinel-string replacement that rewrote any text containing `myComponent`.
- Import specifiers no longer carry a `.ts` extension, so generated code is valid
  whether or not a project enables `allowImportingTsExtensions`.
- Generating over existing files now asks before overwriting instead of silently
  replacing them.
- The command works from the command palette, generating into the open file's
  folder when it is invoked without a folder selection.
- Requires VS Code 1.74+ (for `WorkspaceEdit.createFile` contents).

## [0.0.5]

- Initial release
