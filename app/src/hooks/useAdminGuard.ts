import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "./useAuth";

export function useAdminGuard() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && (!isAuthenticated || user?.role !== "admin")) {
      navigate("/");
    }
  }, [isAuthenticated, isLoading, user, navigate]);

  return {
    isAdmin: user?.role === "admin",
    isLoading,
  };
}
