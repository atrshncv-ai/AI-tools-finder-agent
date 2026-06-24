import { Link, useLocation } from "react-router";
import { Home, FlaskConical, Star } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";

export function BottomNav() {
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  const { data: unreadData } = trpc.readStatus.unreadCount.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const { data: favCount } = trpc.favorite.count.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const unreadCount = unreadData?.count ?? 0;

  const items = [
    { path: "/", icon: Home, label: "Лента", badge: unreadCount },
    { path: "/science", icon: FlaskConical, label: "Наука", badge: 0 },
    ...(isAuthenticated
      ? [{ path: "/favorites", icon: Star, label: "Избранное", badge: favCount?.count ?? 0 }]
      : []),
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t"
      style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}
    >
      <div className="flex items-center justify-around h-14">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className="flex flex-col items-center gap-0.5 px-3 py-1"
              style={{ color: isActive ? "var(--color-accent)" : "var(--color-text-muted)" }}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {item.badge > 0 && (
                  <span
                    className="absolute -top-1 -right-2 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold text-white"
                    style={{ backgroundColor: item.path === "/favorites" ? "var(--color-favorite)" : "var(--color-accent)" }}
                  >
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
