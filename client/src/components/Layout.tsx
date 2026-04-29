import { Link, useLocation } from "wouter";
import { LayoutDashboard, SunMedium, Activity, LogOut, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthSession, useLogout } from "@/hooks/use-auth";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: authSession } = useAuthSession();
  const logoutMutation = useLogout();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/sites", label: "My Sites", icon: SunMedium },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row font-sans">
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-64 border-r border-border bg-card/50 backdrop-blur-xl flex flex-col flex-shrink-0 z-10 sticky top-0 h-auto md:h-screen">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-solar flex items-center justify-center shadow-lg shadow-primary/20">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-bold font-display tracking-tight text-foreground">
            Hoffman PDC Solar Track
          </h1>
        </div>

        <nav className="px-4 py-2 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer group",
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon
                    className={cn(
                      "w-5 h-5 transition-colors",
                      isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                    )}
                  />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        {authSession?.authEnabled && (
          <div className="mt-auto px-4 pb-4 pt-4">
            <div className="rounded-2xl border border-border/70 bg-background/80 p-3 shadow-sm">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Signed In</p>
                  <p className="truncate text-sm font-medium text-foreground">{authSession.username}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4" />
                {logoutMutation.isPending ? "Signing Out..." : "Sign Out"}
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-x-hidden">
        <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-8">
          {children}
        </div>
      </main>
    </div>
  );
}
