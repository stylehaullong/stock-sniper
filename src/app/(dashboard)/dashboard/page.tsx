"use client";

import { useEffect, useState, useCallback } from "react";

interface DashboardStats {
  monitoring: number;
  in_stock: number;
  purchased: number;
  alerts_this_week: number;
}

interface ActivityItem {
  id: string;
  event_type: string;
  created_at: string;
  product_name: string;
  retailer: string;
  details: any;
}

interface UserInfo {
  subscription_tier: string;
  phone: string | null;
  full_name: string | null;
  email: string;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/stats");
      const data = await res.json();
      if (data.stats) setStats(data.stats);
      if (data.activity) setActivity(data.activity);
      if (data.user) setUser(data.user);
    } catch (err) {
      console.error("Failed to load dashboard:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  const statCards = [
    { label: "Monitoring", value: stats?.monitoring ?? "—", sub: "active items", color: "text-amber-400" },
    { label: "In Stock", value: stats?.in_stock ?? "—", sub: "detected now", color: "text-green-400" },
    { label: "Purchased", value: stats?.purchased ?? "—", sub: "total auto-buys", color: "text-blue-400" },
    { label: "Alerts", value: stats?.alerts_this_week ?? "—", sub: "this week", color: "text-purple-400" },
  ];

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Overview of your monitoring activity
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {statCards.map((stat) => (
          <div
            key={stat.label}
            className="glow-card rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-5"
          >
            <div className="text-xs font-[family-name:var(--font-mono)] text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
              {stat.label}
            </div>
            <div className={`text-3xl font-bold ${stat.color}`}>
              {loading ? (
                <span className="inline-block w-8 h-8 bg-[var(--color-surface-3)] rounded animate-pulse" />
              ) : (
                stat.value
              )}
            </div>
            <div className="text-xs text-[var(--color-text-muted)] mt-1">
              {stat.sub}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Activity Feed */}
        <div className="col-span-2 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--color-border-default)] flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent Activity</h2>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 pulse-live" />
              <span className="text-[10px] font-[family-name:var(--font-mono)] text-[var(--color-text-muted)] uppercase tracking-wider">
                Live
              </span>
            </div>
          </div>

          <div className="divide-y divide-[var(--color-border-default)]">
            {loading ? (
              <div className="px-5 py-12 text-center">
                <div className="text-sm text-[var(--color-text-muted)]">Loading...</div>
              </div>
            ) : activity.length > 0 ? (
              activity.map((item) => (
                <div
                  key={item.id}
                  className="px-5 py-3.5 flex items-center gap-4 hover:bg-[var(--color-surface-2)] transition-colors"
                >
                  <div className="shrink-0">
                    <EventIcon eventType={item.event_type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{item.product_name}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">
                      {eventLabel(item.event_type)} · {item.retailer}
                      {item.details?.price && (
                        <span className="ml-2 font-[family-name:var(--font-mono)]">
                          ${Number(item.details.price).toFixed(2)}
                        </span>
                      )}
                      {item.details?.order_number && (
                        <span className="ml-2 font-[family-name:var(--font-mono)] text-green-400">
                          #{item.details.order_number}
                        </span>
                      )}
                      {item.details?.failure_reason && (
                        <span className="ml-2 text-red-400">
                          {item.details.failure_reason}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)] shrink-0 font-[family-name:var(--font-mono)]">
                    {timeAgo(item.created_at)}
                  </div>
                </div>
              ))
            ) : (
              <div className="px-5 py-12 text-center">
                <div className="text-[var(--color-text-muted)] text-sm">No activity yet</div>
                <div className="text-xs text-[var(--color-text-muted)] mt-1">
                  Add items to your watchlist to get started
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Quick Actions */}
          <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-5">
            <h2 className="text-sm font-semibold mb-4">Quick Actions</h2>
            <div className="space-y-2.5">
              <a
                href="/watchlist"
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--color-border-default)] hover:border-amber-500/30 hover:bg-amber-500/5 transition-colors group"
              >
                <span className="text-lg">🎯</span>
                <div>
                  <div className="text-sm font-medium group-hover:text-amber-400 transition-colors">Add Product</div>
                  <div className="text-xs text-[var(--color-text-muted)]">Start monitoring a new item</div>
                </div>
              </a>
              <a
                href="/credentials"
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--color-border-default)] hover:border-amber-500/30 hover:bg-amber-500/5 transition-colors group"
              >
                <span className="text-lg">🔐</span>
                <div>
                  <div className="text-sm font-medium group-hover:text-amber-400 transition-colors">Add Credentials</div>
                  <div className="text-xs text-[var(--color-text-muted)]">Enable auto-buy for a retailer</div>
                </div>
              </a>
              <a
                href="/settings"
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--color-border-default)] hover:border-amber-500/30 hover:bg-amber-500/5 transition-colors group"
              >
                <span className="text-lg">📱</span>
                <div>
                  <div className="text-sm font-medium group-hover:text-amber-400 transition-colors">Setup SMS</div>
                  <div className="text-xs text-[var(--color-text-muted)]">Configure phone notifications</div>
                </div>
              </a>
            </div>
          </div>

          {/* Account Info */}
          <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-5">
            <h2 className="text-sm font-semibold mb-4">Account</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--color-text-secondary)]">Plan</span>
                <TierBadge tier={user?.subscription_tier} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--color-text-secondary)]">Email</span>
                <span className="text-xs font-[family-name:var(--font-mono)] text-[var(--color-text-muted)] truncate max-w-[160px]">
                  {user?.email || "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--color-text-secondary)]">SMS</span>
                <span className="text-xs font-[family-name:var(--font-mono)] text-[var(--color-text-muted)]">
                  {user?.phone || "Not set"}
                </span>
              </div>
            </div>
          </div>

          {/* System Status */}
          <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-5">
            <h2 className="text-sm font-semibold mb-4">System Status</h2>
            <div className="space-y-3">
              {[
                { name: "Monitor", ok: (stats?.monitoring ?? 0) >= 0 },
                { name: "Auto-Buy", ok: true },
                { name: "SMS Alerts", ok: !!user?.phone },
              ].map((service) => (
                <div key={service.name} className="flex items-center justify-between">
                  <span className="text-sm text-[var(--color-text-secondary)]">{service.name}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${service.ok ? "bg-green-400" : "bg-yellow-400"}`} />
                    <span className={`text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider ${service.ok ? "text-green-400" : "text-yellow-400"}`}>
                      {service.ok ? "operational" : "not configured"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EventIcon({ eventType }: { eventType: string }) {
  const config: Record<string, string> = {
    stock_found: "bg-green-400",
    stock_check: "bg-[var(--color-text-muted)]",
    purchase_success: "bg-blue-400",
    purchase_failed: "bg-red-400",
    auto_buy_started: "bg-amber-400",
    error: "bg-red-400",
  };
  return <span className={`block w-2 h-2 rounded-full ${config[eventType] || "bg-amber-400"}`} />;
}

function TierBadge({ tier }: { tier?: string }) {
  const styles: Record<string, string> = {
    free: "bg-[var(--color-surface-3)] text-[var(--color-text-muted)] border-[var(--color-border-default)]",
    pro: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    premium: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  };
  const t = tier || "free";
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider border ${styles[t] || styles.free}`}>
      {t}
    </span>
  );
}

function eventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    stock_found: "In stock",
    stock_check: "Stock check",
    purchase_success: "Purchased",
    purchase_failed: "Purchase failed",
    auto_buy_started: "Auto-buy started",
    error: "Error",
  };
  return labels[eventType] || eventType.replace(/_/g, " ");
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
