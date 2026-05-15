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

  const renderNavItem = (item: (typeof navItems)[number], compact?: boolean) => {
    const isActive = location === item.href;

    return (
      <Link key={item.href} href={item.href}>
        <div
          className={cn(
            "group flex items-center gap-3 rounded-2xl border border-transparent transition-all duration-200 cursor-pointer",
            compact ? "justify-center px-3 py-3 text-sm" : "px-4 py-3",
            isActive
              ? "border-primary/15 bg-primary/10 text-primary shadow-sm shadow-primary/10"
              : "text-muted-foreground hover:border-border hover:bg-background/80 hover:text-foreground"
          )}
        >
          <item.icon
            className={cn(
              "w-5 h-5 transition-colors",
              isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
            )}
          />
          <span className={cn("font-medium", compact && "whitespace-nowrap")}>{item.label}</span>
        </div>
      </Link>
    );
  };

  return (
    <div className="relative min-h-screen bg-background font-sans">
      <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.18),_transparent_42%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.08),_transparent_28%)] pointer-events-none" />

      <div className="relative flex min-h-screen flex-col md:flex-row">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur-xl md:hidden">
          <div className="space-y-4 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-solar text-white shadow-lg shadow-primary/20">
                  <Activity className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold font-display tracking-tight text-foreground">
                    Hoffman PDC Solar Track
                  </p>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Solar Operations
                  </p>
                </div>
              </div>

              {authSession?.authEnabled && (
                <button
                  type="button"
                  onClick={() => logoutMutation.mutate()}
                  disabled={logoutMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card/90 px-3 py-2 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="button-logout"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  {logoutMutation.isPending ? "Signing Out..." : "Sign Out"}
                </button>
              )}
            </div>

            <nav className="grid grid-cols-2 gap-2">
              {navItems.map((item) => renderNavItem(item, true))}
            </nav>
          </div>
        </header>

        <aside className="sticky top-0 hidden h-screen w-72 shrink-0 border-r border-border/70 bg-card/55 backdrop-blur-xl md:flex md:flex-col">
          <div className="p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-solar text-white shadow-lg shadow-primary/20">
                <Activity className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold font-display tracking-tight text-foreground">
                  Hoffman PDC Solar Track
                </h1>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Solar Operations
                </p>
              </div>
            </div>
          </div>

          <nav className="px-4 py-2 space-y-2">
            {navItems.map((item) => renderNavItem(item))}
          </nav>

          {authSession?.authEnabled && (
            <div className="mt-auto px-4 pb-4 pt-6">
              <div className="rounded-[1.5rem] border border-border/70 bg-background/80 p-4 shadow-sm">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
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
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="button-logout"
                >
                  <LogOut className="h-4 w-4" />
                  {logoutMutation.isPending ? "Signing Out..." : "Sign Out"}
                </button>
              </div>
            </div>
          )}
        </aside>

        <main className="min-w-0 flex-1 overflow-x-hidden">
          <div className="mx-auto max-w-7xl px-4 py-5 md:px-8 md:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
