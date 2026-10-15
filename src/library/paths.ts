/** The last name of a path, whatever the separator: `/` on Linux and macOS, `\` on Windows. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
