import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { UserPlus, Trash2, KeyRound, Users } from "lucide-react";

interface UserRow {
  id: number;
  username: string;
  role: string;
  displayName: string;
  createdAt: string;
}

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return iso; }
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const { toast } = useToast();

  const { data: userList, isLoading } = useQuery<UserRow[]>({ queryKey: ["/api/users"] });

  // ── Create user dialog ─────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"salesperson" | "admin">("salesperson");

  const createMutation = useMutation({
    mutationFn: () => apiRequest("/api/users", {
      method: "POST",
      body: JSON.stringify({ username: newUsername, password: newPassword, displayName: newName, role: newRole }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User created", description: `${newName} can now log in` });
      setCreateOpen(false);
      setNewName(""); setNewUsername(""); setNewPassword(""); setNewRole("salesperson");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // ── Delete user ─────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User removed" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // ── Reset password dialog ───────────────────────────────────────────────────
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [newPwd, setNewPwd] = useState("");

  const resetMutation = useMutation({
    mutationFn: () => apiRequest(`/api/users/${resetTarget!.id}/password`, {
      method: "PUT",
      body: JSON.stringify({ password: newPwd }),
    }),
    onSuccess: () => {
      toast({ title: "Password updated" });
      setResetTarget(null); setNewPwd("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="max-w-3xl mx-auto px-6 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Users size={20} className="text-primary" />
          <h2 className="text-lg font-bold text-foreground">Manage Users</h2>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2" data-testid="button-add-user">
          <UserPlus size={15} /> Add User
        </Button>
      </div>

      {/* User list */}
      <div className="space-y-2">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)
          : userList?.map(u => (
            <div
              key={u.id}
              className="bg-card border border-border rounded-lg px-4 py-3 flex items-center justify-between"
              data-testid={`user-row-${u.id}`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-foreground">{u.displayName}</span>
                  <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-xs">
                    {u.role}
                  </Badge>
                  {u.id === me?.id && <Badge variant="outline" className="text-xs">You</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">@{u.username} · Added {fmtDate(u.createdAt)}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost" size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                  title="Reset password"
                  onClick={() => { setResetTarget(u); setNewPwd(""); }}
                  data-testid={`reset-pwd-${u.id}`}
                >
                  <KeyRound size={14} />
                </Button>
                {u.id !== me?.id && (
                  <Button
                    variant="ghost" size="sm"
                    className="h-8 w-8 p-0 text-destructive"
                    title="Remove user"
                    onClick={() => { if (confirm(`Remove ${u.displayName}?`)) deleteMutation.mutate(u.id); }}
                    data-testid={`delete-user-${u.id}`}
                  >
                    <Trash2 size={14} />
                  </Button>
                )}
              </div>
            </div>
          ))
        }
      </div>

      {/* Create user dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add New User</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Full Name</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="John Smith" className="mt-1" data-testid="input-new-name" />
            </div>
            <div>
              <Label className="text-xs">Username</Label>
              <Input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="johnsmith" autoCapitalize="none" className="mt-1" data-testid="input-new-username" />
            </div>
            <div>
              <Label className="text-xs">Password</Label>
              <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" className="mt-1" data-testid="input-new-password" />
            </div>
            <div>
              <Label className="text-xs">Role</Label>
              <Select value={newRole} onValueChange={v => setNewRole(v as any)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="salesperson">Salesperson</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim() || !newUsername.trim() || !newPassword || createMutation.isPending}
              data-testid="button-create-user"
            >
              {createMutation.isPending ? "Creating…" : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={!!resetTarget} onOpenChange={open => { if (!open) setResetTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Reset Password — {resetTarget?.displayName}</DialogTitle></DialogHeader>
          <div className="py-2">
            <Label className="text-xs">New Password</Label>
            <Input
              type="password"
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
              placeholder="New password"
              className="mt-1"
              data-testid="input-reset-password"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>Cancel</Button>
            <Button
              onClick={() => resetMutation.mutate()}
              disabled={!newPwd || resetMutation.isPending}
              data-testid="button-confirm-reset"
            >
              {resetMutation.isPending ? "Saving…" : "Update Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
