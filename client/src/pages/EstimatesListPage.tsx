import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, FileText, Trash2, ChevronRight } from "lucide-react";
import type { Estimate } from "@shared/schema";

function fmtBig(v: number | null | undefined) {
  if (v == null || isNaN(v)) return "$0.00";
  return "$" + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function EstimatesListPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();

  const { data: estimates, isLoading } = useQuery<Estimate[]>({
    queryKey: ["/api/estimates"],
  });

  // Admin: also load users to show salesperson name per estimate
  const { data: users } = useQuery<{ id: number; displayName: string }[]>({
    queryKey: ["/api/users"],
    enabled: user?.role === "admin",
  });
  const userMap = new Map(users?.map(u => [u.id, u.displayName]) ?? []);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/estimates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      toast({ title: "Estimate deleted" });
    },
  });

  return (
    <div className="max-w-3xl mx-auto px-6 py-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-foreground">
            {user?.role === "admin" ? "All Estimates" : "My Estimates"}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {user?.role === "admin" ? "Viewing estimates from all salespeople" : `Logged in as ${user?.displayName}`}
          </p>
        </div>
        <Button onClick={() => setLocation("/new")} className="gap-2" data-testid="new-estimate-btn">
          <Plus size={16} /> New Estimate
        </Button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-card border border-border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-primary">{estimates?.length ?? 0}</div>
          <div className="text-xs text-muted-foreground mt-1">Total Estimates</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-primary">
            {fmtBig(estimates?.reduce((s, e) => s + (e.totalWithMisc ?? 0), 0))}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Total Pipeline</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-primary">
            {estimates?.length
              ? fmtBig((estimates.reduce((s, e) => s + (e.totalWithMisc ?? 0), 0)) / estimates.length)
              : "$0.00"}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Avg Estimate</div>
        </div>
      </div>

      {/* Estimate list */}
      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))
        ) : estimates?.length === 0 ? (
          <div className="text-center py-16">
            <FileText size={48} className="mx-auto text-muted-foreground mb-4 opacity-30" />
            <p className="text-muted-foreground text-sm">No estimates yet.</p>
            <Button onClick={() => setLocation("/new")} className="mt-4 gap-2" variant="outline">
              <Plus size={14} /> Create your first estimate
            </Button>
          </div>
        ) : (
          estimates?.map((estimate) => (
            <div
              key={estimate.id}
              className="bg-card border border-border rounded-lg p-4 flex items-center justify-between hover:border-primary/50 transition-colors cursor-pointer group"
              onClick={() => setLocation(`/estimate/${estimate.id}`)}
              data-testid={`estimate-row-${estimate.id}`}
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <FileText size={18} className="text-primary" />
                </div>
                <div>
                  <div className="font-semibold text-sm text-foreground">{estimate.customerName}</div>
                  <div className="text-xs text-muted-foreground">{estimate.customerAddress}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {fmtDate(estimate.createdAt)} · {estimate.totalSquaresWithWaste?.toFixed(1) ?? "—"} SQ
                    {estimate.shingleType && ` · ${estimate.shingleType}`}
                    {/* Admin: show which salesperson owns this estimate */}
                    {user?.role === "admin" && estimate.userId && userMap.get(estimate.userId) && (
                      <span className="ml-1.5 text-primary/70">· {userMap.get(estimate.userId)}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-base font-bold text-primary">{fmtBig(estimate.totalWithMisc)}</div>
                  <Badge variant="secondary" className="text-xs mt-0.5">{estimate.status ?? "draft"}</Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Delete this estimate?")) deleteMutation.mutate(estimate.id);
                  }}
                  data-testid={`delete-estimate-${estimate.id}`}
                >
                  <Trash2 size={14} />
                </Button>
                <ChevronRight size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
