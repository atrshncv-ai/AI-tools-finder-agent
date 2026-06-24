import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

type Mode = "login" | "register";

export default function Login() {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
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

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate("/");
    },
    onError: (err) => setError(err.message || "Ошибка регистрации"),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode === "login") {
      loginMutation.mutate({ email, password });
    } else {
      registerMutation.mutate({ name, email, password });
    }
  };

  const isLoading = loginMutation.isPending || registerMutation.isPending;

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--color-bg)" }}>
      <Card className="w-full max-w-sm" style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}>
        <CardHeader className="text-center">
          <CardTitle style={{ color: "var(--color-text-heading)" }}>
            ИИ-Новостной Агент
          </CardTitle>
          <CardDescription style={{ color: "var(--color-text-muted)" }}>
            {mode === "login" ? "Войдите в свой аккаунт" : "Создайте аккаунт"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <Input
                type="text"
                placeholder="Ваше имя"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                style={{
                  backgroundColor: "var(--color-search-bg)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-body)",
                }}
              />
            )}
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus={mode === "login"}
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
              disabled={isLoading || !email || !password || (mode === "register" && !name)}
              style={{ backgroundColor: "var(--color-accent)", color: "white" }}
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              {mode === "login" ? "Войти" : "Зарегистрироваться"}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <button
              onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
              className="text-sm transition-colors hover:underline"
              style={{ color: "var(--color-accent)" }}
            >
              {mode === "login" ? "Нет аккаунта? Зарегистрируйтесь" : "Уже есть аккаунт? Войдите"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
