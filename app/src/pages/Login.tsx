import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Lock } from "lucide-react";

/**
 * Private service login. There is NO registration — accounts are issued
 * manually by the administrator.
 */
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate("/");
    },
    onError: (err) => setError(err.message || "Ошибка входа"),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    loginMutation.mutate({ email, password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--color-bg)" }}>
      <Card className="w-full max-w-sm" style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}>
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <Lock className="w-6 h-6" style={{ color: "var(--color-accent)" }} />
          </div>
          <CardTitle style={{ color: "var(--color-text-heading)" }}>
            ИИ-Новостной Агент
          </CardTitle>
          <CardDescription style={{ color: "var(--color-text-muted)" }}>
            Закрытый доступ. Введите выданные администратором логин и пароль.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              style={{
                backgroundColor: "var(--color-search-bg)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-body)",
              }}
            />
            <Input
              type="password"
              placeholder="Пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                backgroundColor: "var(--color-search-bg)",
                borderColor: error ? "rgb(239, 68, 68)" : "var(--color-border)",
                color: "var(--color-text-body)",
              }}
            />
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={loginMutation.isPending || !email || !password}
              style={{ backgroundColor: "var(--color-accent)", color: "white" }}
            >
              {loginMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Войти
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
