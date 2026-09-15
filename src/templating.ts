/**
 * Templates are plain text with one marker syntax: `<<...>>`.
 *
 *   `<<name>>`            a variable, verbatim
 *   `<<pascal name>>`     a variable through a case filter
 *   `<<import types>>`    the import specifier for another file in the recipe
 *   `<<1>>`               a tab stop — where the cursor lands when you Tab through
 *   `<<1:fallback>>`      a tab stop pre-filled with selected text
 *   `<<0>>`               the final cursor position (Tab exits the snippet here)
 *   `<<#if flag>>`        conditional block, with optional `<<#else>>`, closed
 *   `<</if>>`             by `<</if>>`
 *
 * `<<>>` was chosen over `{{}}` and `%%` because both of those collide with
 * real code we emit: JSX spreads (`sx={{ ... }}`) and CSS percentages.
 */

export type RenderContext = {
  /** Substituted by `<<name>>` and the case filters. */
  vars: Record<string, string>;
  /** Import specifiers, keyed by recipe file id. Read by `<<import id>>`. */
  imports: Record<string, string>;
  /** Booleans read by `<<#if flag>>`. */
  flags: Record<string, boolean>;
};

/** A literal run of text, or a tab stop to be handed to VS Code. */
type Segment = { text: string } | { stop: number; fallback: string };

const MARKER = /<<([^<>]*)>>/g;
const TAB_STOP = /^(\d+)(?::([\s\S]*))?$/;
const IF = /^#if\s+([A-Za-z0-9_]+)$/;
const FILTERED = /^([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)$/;

/**
 * Splits an identifier in any casing into its lowercase words, so a recipe can
 * ask for a name in a casing the user never typed. The first replace keeps
 * acronyms together: `parseURLPath` -> `parse URL Path`, not `parse U R L Path`.
 */
const words = (value: string) =>
  value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

type Filter = (value: string) => string;

/** Exported because naming things is not only a templating concern. */
export const pascalCase = (value: string) =>
  words(value).map(capitalize).join("");

const FILTERS: Record<string, Filter | undefined> = {
  camel: (value) =>
    words(value)
      .map((word, index) => (index ? capitalize(word) : word))
      .join(""),
  pascal: pascalCase,
  kebab: (value) => words(value).join("-"),
  snake: (value) => words(value).join("_"),
  constant: (value) => words(value).join("_").toUpperCase(),
  lower: (value) => value.toLowerCase(),
  upper: (value) => value.toUpperCase(),
};

export const FILTER_NAMES = Object.keys(FILTERS);

type Token =
  | { kind: "text"; text: string }
  | { kind: "stop"; stop: number; fallback: string }
  | { kind: "if"; flag: string }
  | { kind: "else" }
  | { kind: "endif" };

/**
 * `Promise<GlobalData<<<pascal name>>Response>>` is legitimate: a generic
 * closing right where a marker opens. The marker body cannot contain `<`, so
 * the leftmost `<` stays part of the generic and the marker still matches.
 */
const tokenize = (template: string, context: RenderContext): Token[] => {
  const tokens: Token[] = [];
  let last = 0;

  const literal = (text: string) => {
    if (text) {
      tokens.push({ kind: "text", text });
    }
  };

  for (const match of template.matchAll(MARKER)) {
    const body = match[1].trim();
    const token = readMarker(body, context);

    // An unrecognised marker is left in the output verbatim rather than being
    // guessed at or dropped, so a typo in a template is visible immediately.
    if (!token) {
      continue;
    }

    literal(template.slice(last, match.index));
    last = match.index + match[0].length;
    tokens.push(token);
  }

  literal(template.slice(last));
  return tokens;
};

const readMarker = (
  body: string,
  context: RenderContext
): Token | undefined => {
  const tabStop = TAB_STOP.exec(body);
  if (tabStop) {
    return {
      kind: "stop",
      stop: Number(tabStop[1]),
      fallback: tabStop[2] ?? "",
    };
  }

  const conditional = IF.exec(body);
  if (conditional) {
    return { kind: "if", flag: conditional[1] };
  }

  if (body === "#else") {
    return { kind: "else" };
  }

  if (body === "/if") {
    return { kind: "endif" };
  }

  const filtered = FILTERED.exec(body);
  if (filtered) {
    const [, filter, argument] = filtered;

    if (filter === "import") {
      const specifier: string | undefined = context.imports[argument];
      return specifier === undefined
        ? undefined
        : { kind: "text", text: specifier };
    }

    const apply = FILTERS[filter];
    const value: string | undefined = context.vars[argument];

    return apply && value !== undefined
      ? { kind: "text", text: apply(value) }
      : undefined;
  }

  const value: string | undefined = context.vars[body];
  return value === undefined ? undefined : { kind: "text", text: value };
};

/** Resolves `<<#if>>` blocks, leaving a flat list of text and tab stops. */
const flatten = (tokens: Token[], flags: Record<string, boolean>): Segment[] => {
  const segments: Segment[] = [];
  const stack: { parentEmit: boolean; condition: boolean }[] = [];
  let emit = true;

  for (const token of tokens) {
    if (token.kind === "if") {
      const condition = flags[token.flag] === true;
      stack.push({ parentEmit: emit, condition });
      emit = emit && condition;
      continue;
    }

    if (token.kind === "else") {
      const frame = stack[stack.length - 1];
      if (frame) {
        emit = frame.parentEmit && !frame.condition;
      }
      continue;
    }

    if (token.kind === "endif") {
      const frame = stack.pop();
      if (frame) {
        emit = frame.parentEmit;
      }
      continue;
    }

    if (!emit) {
      continue;
    }

    segments.push(
      token.kind === "text"
        ? { text: token.text }
        : { stop: token.stop, fallback: token.fallback }
    );
  }

  return segments;
};

const segmentsFor = (template: string, context: RenderContext) =>
  flatten(tokenize(template, context), context.flags);

/** Mirrors what `SnippetString.appendText` escapes. */
const escapeSnippet = (text: string) =>
  text.replace(/\\/g, "\\\\").replace(/\$/g, "\\$").replace(/\}/g, "\\}");

/**
 * The version written to disk: tab stops collapse to their fallback, so the
 * file on disk is always valid code even if the snippet session is abandoned.
 */
export const renderPlain = (template: string, context: RenderContext) =>
  segmentsFor(template, context)
    .map((segment) => ("text" in segment ? segment.text : segment.fallback))
    .join("");

/** The version handed to the editor, with `<<n>>` turned into `$n`. */
export const renderSnippet = (template: string, context: RenderContext) =>
  segmentsFor(template, context)
    .map((segment) => {
      if ("text" in segment) {
        return escapeSnippet(segment.text);
      }
      return segment.fallback
        ? `\${${segment.stop}:${escapeSnippet(segment.fallback)}}`
        : `$${segment.stop}`;
    })
    .join("");

/** Templating for short strings (recipe `folder` and `path` fields). */
export const renderInline = (template: string, context: RenderContext) =>
  renderPlain(template, context);
