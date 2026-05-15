import { lazy, Suspense, useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, AlertCircle } from "lucide-react";
import { authSessionQueryKey, useAuthSession } from "@/hooks/use-auth";

const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Sites = lazy(() => import("@/pages/Sites"));
const Login = lazy(() => import("@/pages/Login"));
const NotFound = lazy(() => import("@/pages/not-found"));

function FullScreenLoader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Activity className="h-6 w-6 animate-pulse" />
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Suspense
      fallback={(
        <FullScreenLoader
          title="Loading page..."
          subtitle="Pulling in the next part of your dashboard."
        />
      )}
    >
      <Switch>
        <Route path="/">
          <Dashboard />
        </Route>
        <Route path="/sites">
          <Sites />
        </Route>
        <Route>
          <NotFound />
        </Route>
      </Switch>
    </Suspense>
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
      <FullScreenLoader
        title="Checking session..."
        subtitle="Preparing your solar dashboard."
      />
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
    return (
      <Suspense
        fallback={(
          <FullScreenLoader
            title="Loading sign-in..."
            subtitle="Preparing secure access to the app."
          />
        )}
      >
        <Login />
      </Suspense>
    );
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
