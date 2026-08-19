export function shouldMarkRead(
  markedNewsId: number | null,
  newsId: number,
  isAuthenticated: boolean,
  hasArticle: boolean,
): boolean {
  return isAuthenticated && hasArticle && Number.isFinite(newsId) && markedNewsId !== newsId;
}
