import { parseJsonc } from "./aliasResolver";

/**
 * A shape inferred from sample data. Kept as a small tree rather than emitted
 * directly as text, because array elements and repeated objects have to be
 * merged before anything can be written out.
 */
type Node =
  | { kind: "primitive"; name: "string" | "number" | "boolean" }
  | { kind: "null" }
  | { kind: "unknown" }
  | { kind: "object"; props: Map<string, { node: Node; optional: boolean }> }
  | { kind: "array"; element: Node }
  | { kind: "union"; members: Node[] };

const UNKNOWN: Node = { kind: "unknown" };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const infer = (value: unknown): Node => {
  if (value === null) {
    return { kind: "null" };
  }

  if (Array.isArray(value)) {
    return {
      kind: "array",
      element: value.map(infer).reduce(merge, UNKNOWN),
    };
  }

  if (isPlainObject(value)) {
    const props = new Map<string, { node: Node; optional: boolean }>();

    for (const [key, entry] of Object.entries(value)) {
      props.set(key, { node: infer(entry), optional: false });
    }

    return { kind: "object", props };
  }

  switch (typeof value) {
    case "string":
      return { kind: "primitive", name: "string" };
    case "number":
      return { kind: "primitive", name: "number" };
    case "boolean":
      return { kind: "primitive", name: "boolean" };
    default:
      return UNKNOWN;
  }
};

const members = (node: Node) =>
  node.kind === "union" ? node.members : [node];

/**
 * Combines two observations of the same position. Objects merge field-wise, and
 * a field missing from either side becomes optional — which is how a list of
 * rows that disagree turns into one honest type instead of the first row's.
 */
const merge = (a: Node, b: Node): Node => {
  if (a.kind === "unknown") {
    return b;
  }

  if (b.kind === "unknown") {
    return a;
  }

  if (a.kind === "primitive" && b.kind === "primitive" && a.name === b.name) {
    return a;
  }

  if (a.kind === "null" && b.kind === "null") {
    return a;
  }

  if (a.kind === "array" && b.kind === "array") {
    return { kind: "array", element: merge(a.element, b.element) };
  }

  if (a.kind === "object" && b.kind === "object") {
    const props = new Map<string, { node: Node; optional: boolean }>();

    for (const key of new Set([...a.props.keys(), ...b.props.keys()])) {
      const left = a.props.get(key);
      const right = b.props.get(key);

      if (left && right) {
        props.set(key, {
          node: merge(left.node, right.node),
          optional: left.optional || right.optional,
        });
      } else {
        const only = (left ?? right) as { node: Node; optional: boolean };
        props.set(key, { node: only.node, optional: true });
      }
    }

    return { kind: "object", props };
  }

  const combined: Node[] = [];
  const seen = new Set<string>();

  for (const member of [...members(a), ...members(b)]) {
    const key = render(member, 0);

    if (!seen.has(key)) {
      seen.add(key);
      combined.push(member);
    }
  }

  return combined.length === 1 ? combined[0] : { kind: "union", members: combined };
};

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const key = (name: string) =>
  IDENTIFIER.test(name) ? name : JSON.stringify(name);

const render = (node: Node, depth: number): string => {
  const pad = "  ".repeat(depth + 1);
  const close = "  ".repeat(depth);

  switch (node.kind) {
    case "primitive":
      return node.name;
    case "null":
      return "null";
    case "unknown":
      return "unknown";
    case "union":
      return node.members.map((member) => render(member, depth)).join(" | ");
    case "array": {
      const element = render(node.element, depth);
      // `(A | B)[]` — without the parentheses the union would swallow the `[]`.
      return node.element.kind === "union" ? `(${element})[]` : `${element}[]`;
    }
    case "object": {
      if (!node.props.size) {
        return "Record<string, unknown>";
      }

      const lines = [...node.props.entries()].map(
        ([name, { node: value, optional }]) =>
          `${pad}${key(name)}${optional ? "?" : ""}: ${render(value, depth + 1)};`
      );

      return `{\n${lines.join("\n")}\n${close}}`;
    }
  }
};

export type Unwrapped = {
  value: unknown;
  /** Envelope fields that were stripped, outermost first. */
  steps: string[];
};

/**
 * Strips the response envelopes before typing, because the generated type is
 * used as `GlobalData<T>`'s `T` — typing the envelope as well would nest it
 * twice. Detection insists on a sibling field so a payload that happens to have
 * its own `response` key is left alone.
 */
export const unwrapEnvelope = (value: unknown): Unwrapped => {
  const steps: string[] = [];
  let current = value;

  if (
    isPlainObject(current) &&
    "response" in current &&
    ("is_success" in current ||
      "status_code" in current ||
      // A lone `response` key is a copied fragment, not a payload that happens
      // to own the name — there is nothing else it could be.
      Object.keys(current).length === 1)
  ) {
    current = current.response;
    steps.push("response");
  }

  if (
    isPlainObject(current) &&
    "results" in current &&
    ("count" in current ||
      "page_count" in current ||
      Object.keys(current).length === 1)
  ) {
    current = current.results;
    steps.push("results");
  }

  return { value: current, steps };
};

/** A `"key": value` pair, which is what you get copying one field out of a body. */
const FRAGMENT = /^"(?:[^"\\]|\\.)*"\s*:/;

/**
 * Copying a response out of a network tab rarely yields a whole document — it is
 * usually one field of a larger body, `"response": { ... }`, which no JSON
 * parser will accept. Rather than make that your problem, a fragment is retried
 * as the body of an object.
 */
export const parseJson = (text: string): unknown => {
  const trimmed = text.trim().replace(/,$/, "");

  try {
    return parseJsonc(trimmed);
  } catch (error) {
    if (FRAGMENT.test(trimmed)) {
      return parseJsonc(`{${trimmed}}`);
    }

    throw error;
  }
};

/** `export type <name> = <shape>;` for the given sample data. */
export const toTypeAlias = (name: string, value: unknown) =>
  `export type ${name} = ${render(infer(value), 0)};\n`;
