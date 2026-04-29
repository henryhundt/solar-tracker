import { useState } from "react";
import { Activity, Lock, LogIn } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLogin } from "@/hooks/use-auth";

export default function Login() {
  const loginMutation = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    loginMutation.mutate({
      username: username.trim(),
      password,
    });
  };

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <div className="grid w-full gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-[2rem] border border-border/60 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.28),_transparent_42%),linear-gradient(160deg,rgba(255,255,255,0.96),rgba(255,247,237,0.92))] p-8 shadow-[0_30px_80px_rgba(15,23,42,0.08)]">
            <div className="mb-10 inline-flex items-center gap-3 rounded-full border border-amber-200/70 bg-white/80 px-4 py-2 text-sm font-medium text-amber-700">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-solar text-white shadow-lg shadow-amber-500/30">
                <Activity className="h-4 w-4" />
              </span>
              Hoffman PDC Solar Track
            </div>

            <div className="max-w-xl space-y-5">
              <h1 className="text-4xl font-display font-bold tracking-tight text-foreground sm:text-5xl">
                Keep your solar monitoring dashboard private.
              </h1>
              <p className="text-base leading-7 text-muted-foreground sm:text-lg">
                This app can store portal credentials and trigger live sync jobs, so the hosted version now requires an admin sign-in before anyone can view or manage sites.
              </p>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                "Protected site management",
                "Sanitized API responses",
                "Safer hosted deployments",
              ].map((item) => (
                <div key={item} className="rounded-2xl border border-white/60 bg-white/70 px-4 py-4 text-sm font-medium text-slate-700 shadow-sm backdrop-blur">
                  {item}
                </div>
              ))}
            </div>
          </section>

          <Card className="rounded-[2rem] border-border/60 bg-card/95 shadow-[0_25px_60px_rgba(15,23,42,0.12)]">
            <CardHeader className="space-y-3 pb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Lock className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <CardTitle className="text-2xl font-display">Admin Login</CardTitle>
                <CardDescription>
                  Sign in with the `ADMIN_USERNAME` and `ADMIN_PASSWORD` configured on the server.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-username">Username</Label>
                  <Input
                    id="login-username"
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className="rounded-xl"
                    data-testid="input-login-username"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="rounded-xl"
                    data-testid="input-login-password"
                  />
                </div>

                {loginMutation.error && (
                  <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="text-login-error">
                    {loginMutation.error.message}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loginMutation.isPending}
                  className="w-full rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
                  data-testid="button-login"
                >
                  <LogIn className="mr-2 h-4 w-4" />
                  {loginMutation.isPending ? "Signing In..." : "Sign In"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
