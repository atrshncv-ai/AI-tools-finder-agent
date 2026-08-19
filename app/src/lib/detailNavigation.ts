export function withSearchParams(path: string, query: string): string {
  return query ? `${path}?${query}` : path;
}

export function detailReturnPath(listPath: string, search: string): string {
  return withSearchParams(listPath, search.replace(/^\?/, ""));
}
