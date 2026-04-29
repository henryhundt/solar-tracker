import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, AlertCircle } from "lucide-react";
import { useEffect } from "react";
import Dashboard from "@/pages/Dashboard";
import Sites from "@/pages/Sites";
import Login from "@/pages/Login";
import NotFound from "@/pages/not-found";
import { authSessionQueryKey, useAuthSession } from "@/hooks/use-auth";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/sites" component={Sites} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthGate() {
  const authSession = useAuthSession();

  useEffect(() => {
    const handleUnauthorized = () => {
      queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
    };

    window.addEventListener("app:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("app:unauthorized", handleUnauthorized);
  }, []);

  if (authSession.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Activity className="h-6 w-6 animate-pulse" />
          </div>
          <div className="space-y-1">
            <p className="font-medium text-foreground">Checking session…</p>
            <p className="text-sm text-muted-foreground">Preparing your solar dashboard.</p>
          </div>
        </div>
      </div>
    );
  }

  if (authSession.error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md rounded-2xl shadow-xl">
          <CardContent className="space-y-4 pt-6 text-center">
            <div className="flex justify-center">
              <AlertCircle className="h-12 w-12 text-destructive" />
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-display font-bold">Unable to reach the app</h1>
              <p className="text-sm text-muted-foreground">
                {authSession.error.message}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (authSession.data?.authEnabled && !authSession.data.authenticated) {
    return <Login />;
  }

  return <Router />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthGate />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
