export function readRunId(searchParams: URLSearchParams): string | null {
  return searchParams.get("run");
}

export function writeRunSearchParams(id: string | null): Record<string, string> {
  return id ? { run: id } : {};
}
