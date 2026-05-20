import { useState } from "react";
import { Lock, LogIn } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLogin } from "@/hooks/use-auth";
import { HoffmanMark } from "@/components/HoffmanMark";

export default function Login() {
  const loginMutation = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const loginErrorMessage =
    loginMutation.error?.message === "Internal Server Error"
      ? "Unable to sign in right now. Please try again in a moment."
      : loginMutation.error?.message;

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
        <div className="grid w-full gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
          <section className="relative min-w-0 overflow-hidden rounded-[1.5rem] border border-primary/20 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(240,241,242,0.9)),radial-gradient(circle_at_top_left,rgba(183,221,121,0.28),transparent_42%)] p-8 shadow-[0_30px_80px_rgba(16,24,32,0.08)]">
            <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-[#34657f] via-[#b7dd79] to-[#fdb71a]" />
            <div className="mb-10 inline-flex items-center gap-3 rounded-md border border-primary/20 bg-white/85 px-4 py-2 text-sm font-medium text-primary shadow-sm">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-white shadow-sm">
                <HoffmanMark className="h-6 w-6" />
              </span>
              Hoffman PDC Solar Track
            </div>

            <div className="max-w-xl space-y-5">
              <h1 className="text-5xl font-display font-bold leading-none text-foreground sm:text-6xl">
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
                <div key={item} className="rounded-md border border-primary/10 bg-white/80 px-4 py-4 text-sm font-medium text-foreground shadow-sm backdrop-blur">
                  {item}
                </div>
              ))}
            </div>
          </section>

          <Card className="min-w-0 rounded-[1.5rem] border-border/60 bg-card/95 shadow-[0_25px_60px_rgba(16,24,32,0.12)]">
            <CardHeader className="space-y-3 pb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Lock className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <CardTitle className="text-2xl font-display">Admin Login</CardTitle>
                <CardDescription>
                  Sign in with your admin credentials to manage sites and sync jobs.
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

                {loginErrorMessage && (
                  <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="text-login-error">
                    {loginErrorMessage}
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
