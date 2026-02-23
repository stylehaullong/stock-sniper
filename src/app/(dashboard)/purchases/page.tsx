"use client";

import { useEffect, useState, useCallback } from "react";

interface Purchase {
  id: string;
  product_name: string;
  retailer: string;
  status: string;
  order_number: string | null;
  total_price: number | null;
  failure_reason: string | null;
  created_at: string;
}

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPurchases = useCallback(async () => {
    try {
      const res = await fetch("/api/purchases");
      const data = await res.json();
      if (data.purchases) setPurchases(data.purchases);
    } catch (err) {
      console.error("Failed to load purchases:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPurchases();
  }, [fetchPurchases]);

  // Compute summary stats
  const successCount = purchases.filter((p) => p.status === "success").length;
  const failedCount = purchases.filter((p) => p.status === "failed").length;
  const totalSpent = purchases
    .filter((p) => p.status === "success" && p.total_price)
    .reduce((sum, p) => sum + (p.total_price || 0), 0);

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">Purchases</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Auto-buy attempt history
        </p>
      </div>

      {/* Summary Stats */}
      {!loading && purchases.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-4">
            <div className="text-xs font-[family-name:var(--font-mono)] text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
              Successful
            </div>
            <div className="text-2xl font-bold text-green-400">{successCount}</div>
          </div>
          <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-4">
            <div className="text-xs font-[family-name:var(--font-mono)] text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
              Failed
            </div>
            <div className="text-2xl font-bold text-red-400">{failedCount}</div>
          </div>
          <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-4">
            <div className="text-xs font-[family-name:var(--font-mono)] text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
              Total Spent
            </div>
            <div className="text-2xl font-bold text-amber-400">
              ${totalSpent.toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {/* Purchases List */}
      <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] overflow-hidden">
        <div className="divide-y divide-[var(--color-border-default)]">
          {loading ? (
            <div className="px-5 py-16 text-center">
              <div className="text-sm text-[var(--color-text-muted)]">Loading...</div>
            </div>
          ) : purchases.length > 0 ? (
            purchases.map((purchase) => (
              <div
                key={purchase.id}
                className="px-5 py-4 flex items-center gap-4 hover:bg-[var(--color-surface-2)] transition-colors"
              >
                {/* Status icon */}
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${statusStyle(purchase.status).bg}`}
                >
                  <span className="text-sm">{statusStyle(purchase.status).icon}</span>
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{purchase.product_name}</div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-[10px] font-[family-name:var(--font-mono)] text-[var(--color-text-muted)]">
                      🎯 {purchase.retailer}
                    </span>
                    {purchase.order_number && (
                      <span className="text-[10px] font-[family-name:var(--font-mono)] text-green-400">
                        #{purchase.order_number}
                      </span>
                    )}
                    {purchase.failure_reason && (
                      <span className="text-[10px] text-red-400 truncate max-w-xs">
                        {purchase.failure_reason}
                      </span>
                    )}
                  </div>
                </div>

                {/* Price */}
                <div className="text-right shrink-0">
                  {purchase.total_price ? (
                    <div className="text-sm font-[family-name:var(--font-mono)] font-medium">
                      ${Number(purchase.total_price).toFixed(2)}
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--color-text-muted)]">—</div>
                  )}
                  <div className="text-[10px] font-[family-name:var(--font-mono)] text-[var(--color-text-muted)] mt-0.5">
                    {new Date(purchase.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                </div>

                {/* Status badge */}
                <div
                  className={`px-2 py-0.5 rounded text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider shrink-0 border ${statusStyle(purchase.status).badge}`}
                >
                  {purchase.status}
                </div>
              </div>
            ))
          ) : (
            <div className="px-5 py-16 text-center">
              <div className="text-4xl mb-3">🛒</div>
              <div className="text-sm font-medium mb-1">No purchase attempts yet</div>
              <div className="text-xs text-[var(--color-text-muted)]">
                Enable auto-buy on a watchlist item to get started
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function statusStyle(status: string) {
  switch (status) {
    case "success":
      return {
        bg: "bg-green-500/10 border border-green-500/20",
        icon: "✓",
        badge: "bg-green-500/10 text-green-400 border-green-500/20",
      };
    case "carted":
      return {
        bg: "bg-amber-500/10 border border-amber-500/20",
        icon: "🛒",
        badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      };
    case "detected":
    case "checkout_started":
      return {
        bg: "bg-blue-500/10 border border-blue-500/20",
        icon: "⚡",
        badge: "bg-blue-500/10 text-blue-400 border-blue-500/20",
      };
    default:
      return {
        bg: "bg-red-500/10 border border-red-500/20",
        icon: "✕",
        badge: "bg-red-500/10 text-red-400 border-red-500/20",
      };
  }
}
