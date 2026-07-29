/** Replace ${VAR} placeholders with process.env values, preserving unresolved placeholders. */
export function substituteEnv(input: string): string {
  return input.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
    return process.env[name] ?? `\${${name}}`;
  });
}
