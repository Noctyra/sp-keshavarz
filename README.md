# sp-keshavarz

A personal code-generation extension for VS Code. It scaffolds the folder-shaped
patterns you write over and over, wires the imports up correctly for whatever
project you are in, and drops you into the new file with the cursor already on
the first thing you have to type.

It is fully offline. No network calls, no AI, no runtime dependencies — every
line it emits comes from a template in `templates/`.

## Using it

Press **`Ctrl+Alt+N`** (`Cmd+Alt+N` on macOS), or right-click a folder in the
explorer and choose **My Workflow**, or run **My Workflow** from the command
palette. Only the explorer route needs the mouse; the other two generate
relative to the file you already have open.

Pick what you want, type a camelCase name, and the files appear:

| Generator | Creates |
| --- | --- |
| Component | `<name>/` with `.tsx`, `.types.ts`, `.biz.ts` |
| Icon | `<name>Icon.tsx` — a `createSvgIcon` wrapper |
| Query | `<name>Query/` with `.function.ts`, `.options.ts`, `.types.ts` |
| Mutation | `<name>Mutation/` with `.function.ts`, `use<Name>.ts`, `.types.ts` |

The main file opens automatically with its placeholders live: press `Tab` to jump
between them and `Tab` past the last one to finish. For a query that means you
land on the URL, `Tab` to the params, and you are done.

## Turning a response into a type

Writing the response type is the expensive half of adding a query — the skeleton
is four lines, the type is forty. Copy a sample response, put the cursor where
the type belongs and press **`Ctrl+Alt+J`** (`Cmd+Alt+J` on macOS).

It reads the JSON from your selection if you have one (so JSON already pasted
into the file is replaced by its type in place), otherwise from the clipboard,
otherwise it asks. Then it writes an `export type` at the cursor.

The envelope is stripped for you: a `GlobalData` payload is unwrapped to its
`response`, and a paginated one further to `results`, because the generated type
is what goes in `GlobalData<T>`. Detection requires a sibling envelope field, so
a payload that happens to have its own `response` key is left alone.

Inference is structural and merges every sample it can see: a list where one row
carries an extra field makes that field optional, and a value that is sometimes
null becomes `string | null`. Keys are emitted exactly as the API sends them,
quoted only when they are not valid identifiers. Empty arrays become
`unknown[]`, and a field that is null in every sample becomes `null` — both are
signals that the sample did not tell it enough, and are yours to fix.

You do not have to tidy the JSON first. Trailing commas and comments are
tolerated, and so is a bare fragment — copying just `"response": { ... }` out of
a larger body works, because a fragment is retried as the body of an object.

## Duplicating what you already wrote

For anything more specific than the canonical shapes above, the most accurate
template is a folder you already wrote. Right-click one and choose
**Duplicate As...**

It works out what to rename by scoring every plausible name against the folder's
own file names and keeping the one that actually accounts for most of them. A
`getWalletQuery` folder holding `getWallet.*` is renaming `getWallet`; an
`activateUserMutation` folder holding `activateUser.*` plus `useActivateUser.ts`
is renaming `activateUser`, even though those files share no common prefix. The
prompt tells you which name it settled on before anything happens.

In a folder whose files have nothing in common — `utils`, `locales`,
`assets/icons` — no name accounts for the folder, so only the folder itself is
renamed and the files are copied as they are. Type the new name and the copy
appears beside it with every casing rewritten — `getWallet`, `GetWallet`,
`GET_WALLET`, `get-wallet`, `get_wallet` — across file contents, file names,
nested folders and import paths alike. Binary files are copied untouched.

There is no dry-run mode because the whole duplicate is a single `Ctrl+Z`.

Two things it deliberately leaves alone, because it cannot know the answer:
URLs and query keys inside the copied code. Duplicating a query gives you a
working file still pointing at the old endpoint — that is yours to change.
Renaming is also substring-based, so an identifier that merely contains the
stem is rewritten too; that is what makes the surrounding folder and type names
come along.

## Binding a key to one generator

`Ctrl+Alt+N` opens the picker. To skip the picker and go straight to one
generator, bind `sp-keshavarz.generate` with the recipe's folder name as an
argument — in `keybindings.json`:

```json
[
  { "key": "ctrl+alt+q", "command": "sp-keshavarz.generate", "args": { "recipe": "query" } },
  { "key": "ctrl+alt+c", "command": "sp-keshavarz.generate", "args": { "recipe": "component" } }
]
```

Any recipe can be bound this way, including ones you add later — the argument is
just the directory name under `recipes/`. Binding a name that does not exist
reports the available ids rather than failing silently.

## Working in any repo

Imports are resolved per project, not hardcoded. When you generate, the
extension walks up from the target folder to the first `tsconfig.json` whose
`paths` actually cover it, and writes imports against that alias — so it emits
`@/...` in one project and `#shared/...` in another without being told. In a
monorepo it lands on the owning app or package rather than the repo root, and it
follows `extends` chains and `references` (a solution-style `tsconfig.json` that
only points at `tsconfig.app.json` resolves correctly).

If no alias covers the folder, imports fall back to relative paths and a warning
explains why. Import specifiers never include a `.ts`/`.tsx` extension, which is
valid whether or not a project enables `allowImportingTsExtensions`.

The **My Workflow** output channel logs which tsconfig and alias were used for
every run, which is the first place to look if an import comes out wrong.

## Installing

Build it, then symlink the repo into your extensions folder:

```bash
pnpm install
pnpm run compile
ln -s "$PWD" ~/.vscode/extensions/noctyra.sp-keshavarz-dev
```

Reload VS Code (`Ctrl+Shift+P` → **Developer: Reload Window**). Because it is a
symlink, `pnpm run compile` plus a reload is all it takes to pick up changes —
no repackaging.

## Recipes

Every generator is a folder in `recipes/` containing a `recipe.json` and its
templates. Adding a generator means adding a folder — there is no TypeScript to
change and no list to register it in. Recipes are re-read on every run, so
editing one takes effect on the next generate without reloading the window.

```json
{
  "label": "$(symbol-method) Component",
  "detail": "component.tsx + .types.ts + .biz.ts",
  "noun": "Component",
  "placeholder": "myComponent",
  "example": "myComponent, userCard",
  "order": 10,
  "folder": "<<name>>",
  "files": [
    { "id": "component", "path": "<<name>>.tsx", "template": "component.tsx.txt", "primary": true },
    { "id": "types", "path": "<<name>>.types.ts", "template": "types.txt" },
    { "id": "biz", "path": "<<name>>.biz.ts", "template": "biz.txt" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `label` / `detail` | How it reads in the picker (`$(icon)` codicons work) |
| `noun` | Used in prompts and messages |
| `placeholder` / `example` | Shown while typing the name |
| `order` | Position in the picker; lower is higher up |
| `hints` | Folder names that float this recipe to the top of the picker |
| `anchor` | Folder names (or paths) searched upwards for when there is no clicked folder; defaults to `hints` |
| `prompts` | Values chosen before generating, read out of the project |
| `target` | Package-root-relative folder to generate into, instead of the clicked one |
| `folder` | Templated subfolder to create, or `"."` to write in place |
| `files[].id` | How other templates refer to this file: `<<import id>>` |
| `files[].path` | Templated file name, relative to `folder` |
| `files[].template` | Template file, resolved inside the recipe's own folder |
| `files[].primary` | The file that opens with its tab stops live |
| `files[].when` | Only write this file when the named option is on |
| `options` | Yes/no toggles, asked before generating |

A recipe that fails to parse is skipped with an explanation in the **My
Workflow** output channel rather than breaking the others.

## Choosing where it goes

A recipe can work out its own destination instead of making you navigate there.

```json
"hints": ["queries"],
"prompts": [
  { "name": "module", "label": "Which module?", "dirs": "src/modules" }
],
"target": "src/modules/<<module>>/queries"
```

`prompts` are answered before generating, and the choices are read out of the
project as it is right now — never a list kept in sync by hand:

| Source | Choices |
| --- | --- |
| `"dirs": "src/modules"` | Subdirectory names of that package-root-relative folder |
| `"exports": "src/types/responses/responsesTypes.ts"` | Names exported from that file |
| `"values": ["a", "b"]` | A fixed list |

`target` then says where to write, relative to the package root. Together they
mean you never navigate: from anywhere in `modules/logistics`, generating a
query writes to `modules/logistics/queries` whether or not that folder exists
yet.

**A `dirs` prompt answers itself when it can.** If the folder you invoked from
is already inside one of the choices, that is the answer and you are not asked —
right-clicking anything under `modules/finance` means the module is `finance`.
Set `"alwaysAsk": true` on the prompt to be asked regardless. The output channel
logs which values were inferred.

When a recipe would redirect you somewhere else and the value could not be
inferred, the chooser offers **Here** first, which generates into the folder you
actually clicked and ignores `target`. A chooser can never trap you.

`hints` are folder names that make a recipe the obvious pick: with
`"hints": ["queries"]`, right-clicking a `queries` folder puts Query at the top
of the list.

### Keyboard invocation and anchors

A folder you picked in the explorer is an instruction and is always obeyed. A
folder that merely happens to contain the file you have open is not — so when
invoked from a key or the palette, a recipe without a `target` searches upwards
for the folder its output belongs in, using `anchor` (which defaults to
`hints`).

Editing `modules/finance/pages/dashboard/dashboard.tsx` and generating a
component puts it in `modules/finance/components`, not inside the page folder.
The nearest match wins, so from a component that has its own `components/`
subfolder you get that one. An anchor entry may also be a path, which is how
`"anchor": ["icons", "assets/icons"]` finds `src/assets/icons` from anywhere.

If nothing matches, the folder of the open file is used unchanged.

## Template syntax

Templates are plain text with one marker syntax, `<<...>>`:

| Marker | Meaning |
| --- | --- |
| `<<name>>` | The name you typed, verbatim |
| `<<pascal name>>` | The name through a case filter |
| `<<import types>>` | Import specifier for the recipe file with id `types` |
| `<<1>>` | A tab stop — where the cursor lands |
| `<<1:text>>` | A tab stop pre-filled with selected text |
| `<<0>>` | The final cursor position |
| `<<#if flag>>` … `<<#else>>` … `<</if>>` | Conditional block, driven by `options` |

Filters are `camel`, `pascal`, `kebab`, `snake`, `constant`, `lower` and
`upper`. They work on any input casing, so `<<kebab name>>` turns `getUserProfile`
into `get-user-profile`, and they work in `path` and `folder` too. Acronyms are
normalised rather than preserved: `parseURLPath` becomes `ParseUrlPath`.

Besides the recipe's own files, `<<import apiClient>>` and
`<<import responseTypes>>` resolve to wherever the current project keeps its
axios instance and its `GlobalData` type.

Tab stops are only live in the file the recipe marks `primary`; in the other
generated files they collapse to their fallback text.

An unknown `<<marker>>` is left in the output verbatim rather than silently
dropped, so a typo in a template is visible immediately.

## Development

```bash
pnpm run compile    # or: pnpm run watch
pnpm run lint
```

Press `F5` to launch an Extension Development Host with the extension loaded.
