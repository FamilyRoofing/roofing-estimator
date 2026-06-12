import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider, useAuth } from "@/lib/auth";
import EstimatorPage from "./pages/EstimatorPage";
import EstimatesListPage from "./pages/EstimatesListPage";
import UsersPage from "./pages/UsersPage";
import LoginPage from "./pages/LoginPage";
import NotFound from "./pages/not-found";
import { Button } from "@/components/ui/button";
import { LogOut, Users } from "lucide-react";

// ── Authenticated shell with shared header ─────────────────────────────────
function AuthenticatedApp() {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      {/* Global header — only shown when not on the estimator form itself */}
      <div className="bg-card border-b border-border shadow-sm sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            onClick={() => setLocation("/")}
          >
            <svg aria-label="Roofing Estimator" viewBox="0 0 40 40" fill="none" className="w-8 h-8" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 22 L20 6 L36 22" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-primary"/>
              <path d="M8 22 L8 36 L32 36 L32 22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary"/>
              <path d="M16 36 L16 27 L24 27 L24 36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"/>
            </svg>
            <span className="font-bold text-foreground text-sm hidden sm:block">Roofing Estimator</span>
          </button>

          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground hidden sm:block">
              {user?.displayName}
              {user?.role === "admin" && <span className="ml-1 text-primary font-medium">(Admin)</span>}
            </span>

            {user?.role === "admin" && (
              <Button
                variant={location === "/users" ? "default" : "ghost"}
                size="sm"
                className="gap-1.5 h-8 text-xs"
                onClick={() => setLocation(location === "/users" ? "/" : "/users")}
                data-testid="button-manage-users"
              >
                <Users size={13} />
                <span className="hidden sm:inline">Users</span>
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 h-8 text-xs text-muted-foreground"
              onClick={logout}
              data-testid="button-logout"
            >
              <LogOut size={13} />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Routes */}
      <Switch>
        <Route path="/" component={EstimatesListPage} />
        <Route path="/new" component={EstimatorPage} />
        <Route path="/estimate/:id" component={EstimatorPage} />
        {user?.role === "admin" && <Route path="/users" component={UsersPage} />}
        <Route component={NotFound} />
      </Switch>
    </div>
  );
}

// ── Root: decide between login and app ─────────────────────────────────────
function Root() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  if (!user) return <LoginPage />;
  return <AuthenticatedApp />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router hook={useHashLocation}>
          <Root />
        </Router>
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
