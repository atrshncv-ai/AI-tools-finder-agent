import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
/**
 * Counts published news that are not explicitly marked read.
 * The catalog behind /inventions is deliberately not part of this count:
 * only news with section="invention-tools" is queried here.
 */
export function useUnreadCounts() {
  const { isAuthenticated } = useAuth();
  const enabled = isAuthenticated;

  const { data: aiNews } = trpc.readStatus.unreadCountBySection.useQuery(
    { section: "ai-news" },
    { enabled },
  );
  const { data: science } = trpc.readStatus.unreadCountBySection.useQuery(
    { section: "science" },
    { enabled },
  );
  const { data: inventionTools } = trpc.readStatus.unreadCountBySection.useQuery(
    { section: "invention-tools" },
    { enabled },
  );

  return {
    aiNews: aiNews?.count ?? 0,
    science: science?.count ?? 0,
    inventionTools: inventionTools?.count ?? 0,
  };
}
