/**
 * Replace each `{{name}}` in a template with its value. A placeholder without a value throws,
 * so a renamed variable cannot leave a literal `{{...}}` in generated code.
 */
export function render(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{([A-Za-z.]+)\}\}/g, (_match, name: string) => {
    if (!Object.hasOwn(values, name)) throw new Error(`Template has no value for {{${name}}}`);
    return values[name]!;
  });
}

/** Template values for a set of names under one prefix, for example `app.kebab`. */
export function prefixed(prefix: string, values: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [`${prefix}.${key}`, String(value)]),
  );
}
