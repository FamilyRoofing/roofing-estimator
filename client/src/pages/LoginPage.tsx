import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { LogIn } from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err: any) {
      toast({
        title: "Login failed",
        description: err?.message || "Invalid username or password",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo + title */}
        <div className="flex flex-col items-center mb-8">
          <svg aria-label="Roofing Estimator" viewBox="0 0 40 40" fill="none" className="w-14 h-14 mb-3" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 22 L20 6 L36 22" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-primary"/>
            <path d="M8 22 L8 36 L32 36 L32 22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary"/>
            <path d="M16 36 L16 27 L24 27 L24 36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"/>
          </svg>
          <h1 className="text-xl font-bold text-foreground">Roofing Estimator</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to your account</p>
        </div>

        {/* Login card */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="username" className="text-sm">Username</Label>
              <Input
                id="username"
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="your username"
                className="mt-1"
                data-testid="input-username"
              />
            </div>
            <div>
              <Label htmlFor="password" className="text-sm">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1"
                data-testid="input-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full gap-2"
              disabled={loading || !username.trim() || !password}
              data-testid="button-login"
            >
              <LogIn size={16} />
              {loading ? "Signing in…" : "Sign In"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
