import { Link, useLocation } from "wouter";
import { LayoutDashboard, SunMedium, LogOut, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthSession, useLogout } from "@/hooks/use-auth";
import { HoffmanMark } from "@/components/HoffmanMark";

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
              ? "border-[#b7dd79]/30 bg-[#b7dd79]/15 text-[#b7dd79] shadow-sm shadow-black/10"
              : "text-white/70 hover:border-white/20 hover:bg-white/10 hover:text-white"
          )}
        >
          <item.icon
            className={cn(
              "w-5 h-5 transition-colors",
              isActive ? "text-[#b7dd79]" : "text-white/60 group-hover:text-white"
            )}
          />
          <span className={cn("font-medium", compact && "whitespace-nowrap")}>{item.label}</span>
        </div>
      </Link>
    );
  };

  return (
    <div className="relative min-h-screen bg-background font-sans">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[linear-gradient(90deg,_rgba(183,221,121,0.24),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(52,101,127,0.14),_transparent_32%)]" />

      <div className="relative flex min-h-screen flex-col md:flex-row">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-[#101820]/95 text-white backdrop-blur-xl md:hidden">
          <div className="space-y-4 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white shadow-lg shadow-black/20">
                  <HoffmanMark className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold font-display text-white">
                    Hoffman PDC Solar Track
                  </p>
                  <p className="text-xs uppercase tracking-[0.18em] text-white/60">
                    Solar Operations
                  </p>
                </div>
              </div>

              {authSession?.authEnabled && (
                <button
                  type="button"
                  onClick={() => logoutMutation.mutate()}
                  disabled={logoutMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
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

        <aside className="sticky top-0 hidden h-screen w-72 shrink-0 border-r border-[#34657f]/25 bg-[#101820] text-white md:flex md:flex-col">
          <div className="p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-md bg-white shadow-lg shadow-black/20">
                <HoffmanMark className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold font-display text-white">
                  Hoffman PDC Solar Track
                </h1>
                <p className="text-xs uppercase tracking-[0.18em] text-white/60">
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
              <div className="rounded-[1rem] border border-white/10 bg-white/[0.07] p-4 shadow-sm">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-md bg-[#b7dd79]/15 text-[#b7dd79]">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.18em] text-white/60">Signed In</p>
                    <p className="truncate text-sm font-medium text-white">{authSession.username}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => logoutMutation.mutate()}
                  disabled={logoutMutation.isPending}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-white/20 bg-white/10 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
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
