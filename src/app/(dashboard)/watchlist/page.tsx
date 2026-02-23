"use client";

import { useState, useEffect, useCallback } from "react";

interface WatchlistItem {
  id: string;
  product_name: string;
  retailer: string;
  product_url: string;
  product_sku: string | null;
  product_image_url: string | null;
  mode: string;
  poll_interval_seconds: number;
  max_price: number | null;
  last_status: string;
  last_checked_at: string | null;
  last_price: number | null;
  is_active: boolean;
  quantity: number;
  created_at: string;
}

interface StockCheckResult {
  in_stock: boolean;
  price: number | null;
  product_name: string;
  product_image_url: string | null;
  add_to_cart_available: boolean;
  raw_status: string;
  checked_at: string;
}

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [checkingItems, setCheckingItems] = useState<Set<string>>(new Set());
  const [buyingItems, setBuyingItems] = useState<Set<string>>(new Set());
  const [checkResults, setCheckResults] = useState<Record<string, { result?: StockCheckResult; error?: string; autoBuyEligible?: boolean }>>({});
  const [buyResults, setBuyResults] = useState<Record<string, { status: string; order_number?: string; failure_reason?: string; steps?: string[] }>>({});

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      const data = await res.json();
      if (data.items) {
        setItems(data.items);
      }
    } catch (err) {
      console.error("Failed to fetch watchlist:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  async function handleCheckNow(itemId: string) {
    setCheckingItems((prev) => new Set(prev).add(itemId));
    setCheckResults((prev) => ({ ...prev, [itemId]: {} }));

    try {
      const res = await fetch("/api/watchlist/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setCheckResults((prev) => ({
          ...prev,
          [itemId]: { error: data.error || "Check failed" },
        }));
      } else {
        setCheckResults((prev) => ({
          ...prev,
          [itemId]: { result: data.result, autoBuyEligible: data.auto_buy_eligible },
        }));
        await fetchItems();
      }
    } catch (err: any) {
      setCheckResults((prev) => ({
        ...prev,
        [itemId]: { error: err.message || "Network error" },
      }));
    } finally {
      setCheckingItems((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }

  async function handleDelete(itemId: string) {
    if (!confirm("Remove this item from your watchlist?")) return;
    try {
      await fetch(`/api/watchlist?id=${itemId}`, { method: "DELETE" });
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  async function handleToggleActive(itemId: string, currentActive: boolean) {
    try {
      const res = await fetch(`/api/watchlist?id=${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !currentActive }),
      });
      if (res.ok) {
        setItems((prev) =>
          prev.map((i) => (i.id === itemId ? { ...i, is_active: !currentActive } : i))
        );
      }
    } catch (err) {
      console.error("Toggle failed:", err);
    }
  }

  async function handleCheckAll() {
    for (const item of items.filter((i) => i.is_active)) {
      await handleCheckNow(item.id);
    }
  }

  async function handleAutoBuy(itemId: string) {
    if (!confirm("Start auto-buy? This will attempt to purchase the item using your saved credentials.")) return;

    setBuyingItems((prev) => new Set(prev).add(itemId));
    setBuyResults((prev) => ({ ...prev, [itemId]: { status: "in_progress" } }));

    try {
      const res = await fetch("/api/watchlist/autobuy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setBuyResults((prev) => ({
          ...prev,
          [itemId]: { status: "failed", failure_reason: data.error || "Auto-buy failed" },
        }));
      } else {
        setBuyResults((prev) => ({
          ...prev,
          [itemId]: {
            status: data.result.status,
            order_number: data.result.order_number,
            failure_reason: data.result.failure_reason,
            steps: data.result.steps_completed,
          },
        }));
        await fetchItems();
      }
    } catch (err: any) {
      setBuyResults((prev) => ({
        ...prev,
        [itemId]: { status: "failed", failure_reason: err.message || "Network error" },
      }));
    } finally {
      setBuyingItems((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold mb-1">Watchlist</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {items.length} product{items.length !== 1 ? "s" : ""} monitored
          </p>
        </div>
        <div className="flex items-center gap-3">
          {items.length > 0 && (
            <button
              onClick={handleCheckAll}
              disabled={checkingItems.size > 0}
              className="px-4 py-2.5 border border-[var(--color-border-default)] rounded-lg text-sm font-medium hover:bg-[var(--color-surface-3)] transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {checkingItems.size > 0 ? (
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.75 2.75l1.41 1.41M9.84 9.84l1.41 1.41M2.75 11.25l1.41-1.41M9.84 4.16l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              )}
              Check All
            </button>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2.5 bg-amber-500 text-black font-semibold rounded-lg hover:bg-amber-400 transition-all text-sm flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            Add Product
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] overflow-hidden">
        {loading ? (
          <div className="px-5 py-16 text-center"><div className="text-sm text-[var(--color-text-muted)]">Loading...</div></div>
        ) : items.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="text-4xl mb-3">🎯</div>
            <div className="text-sm font-medium mb-1">No products yet</div>
            <div className="text-xs text-[var(--color-text-muted)] mb-4">Add a product URL to start monitoring</div>
            <button onClick={() => setShowAddModal(true)} className="px-4 py-2 bg-amber-500 text-black font-medium rounded-lg text-sm hover:bg-amber-400 transition-colors">Add your first product</button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_100px_90px_80px_180px_80px] gap-4 px-5 py-3 border-b border-[var(--color-border-default)] bg-[var(--color-surface-2)]">
              {["Product", "Status", "Price", "Mode", "Actions", "Active"].map((h, i) => (
                <div key={h} className={`text-[10px] font-[family-name:var(--font-mono)] text-[var(--color-text-muted)] uppercase tracking-wider ${i === 5 ? "text-right" : ""}`}>{h}</div>
              ))}
            </div>
            <div className="divide-y divide-[var(--color-border-default)]">
              {items.map((item) => {
                const isChecking = checkingItems.has(item.id);
                const isBuying = buyingItems.has(item.id);
                const lastResult = checkResults[item.id];
                const lastBuy = buyResults[item.id];
                return (
                  <div key={item.id}>
                    <div className="grid grid-cols-[1fr_100px_90px_80px_180px_80px] gap-4 px-5 py-4 items-center hover:bg-[var(--color-surface-2)] transition-colors group">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate group-hover:text-amber-400 transition-colors">{item.product_name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[var(--color-surface-3)] text-[10px] font-[family-name:var(--font-mono)] text-[var(--color-text-muted)]">🎯 {item.retailer}</span>
                          {item.last_checked_at && <span className="text-[10px] font-[family-name:var(--font-mono)] text-[var(--color-text-muted)]">{timeAgo(item.last_checked_at)}</span>}
                        </div>
                      </div>
                      <div><StatusBadge status={item.last_status} /></div>
                      <div className="text-sm font-[family-name:var(--font-mono)] text-[var(--color-text-secondary)]">{item.last_price ? `$${Number(item.last_price).toFixed(2)}` : "—"}</div>
                      <div>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider ${item.mode === "auto_buy" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-[var(--color-surface-3)] text-[var(--color-text-muted)] border border-[var(--color-border-default)]"}`}>
                          {item.mode === "auto_buy" ? "⚡ Auto" : "📱 Alert"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => handleCheckNow(item.id)} disabled={isChecking || isBuying} className="px-2 py-1.5 rounded-lg text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors disabled:opacity-50 flex items-center gap-1">
                          {isChecking ? (<><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></>) : "Check"}
                        </button>
                        {item.mode === "auto_buy" && (
                          <button onClick={() => handleAutoBuy(item.id)} disabled={isBuying || isChecking} className="px-2 py-1.5 rounded-lg text-[11px] font-medium bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors disabled:opacity-50 flex items-center gap-1">
                            {isBuying ? (<><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Buying</>) : "Buy Now"}
                          </button>
                        )}
                        <button onClick={() => handleDelete(item.id)} className="px-1.5 py-1.5 rounded-lg text-[11px] text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-colors">✕</button>
                      </div>
                      <div className="flex justify-end">
                        <button onClick={() => handleToggleActive(item.id, item.is_active)} className={`w-10 h-5 rounded-full transition-colors relative ${item.is_active ? "bg-amber-500" : "bg-[var(--color-surface-4)]"}`}>
                          <span className={`block w-4 h-4 rounded-full bg-white shadow-sm transition-transform absolute top-0.5 ${item.is_active ? "translate-x-5" : "translate-x-0.5"}`} />
                        </button>
                      </div>
                    </div>
                    {/* Stock check result */}
                    {lastResult && (lastResult.result || lastResult.error) && (
                      <div className="px-5 py-3 bg-[var(--color-surface-0)] border-t border-[var(--color-border-default)]">
                        {lastResult.error ? (
                          <div className="flex items-center gap-2 text-sm text-red-400"><span>✕</span><span>{lastResult.error}</span></div>
                        ) : lastResult.result ? (
                          <div className="flex items-center gap-4 text-sm">
                            <span className={lastResult.result.in_stock ? "text-green-400" : "text-[var(--color-text-muted)]"}>{lastResult.result.in_stock ? "✓ In Stock" : "✕ Out of Stock"}</span>
                            {lastResult.result.price && <span className="font-[family-name:var(--font-mono)] text-[var(--color-text-secondary)]">${lastResult.result.price.toFixed(2)}</span>}
                            <span className="text-[var(--color-text-muted)] text-xs">{lastResult.result.raw_status}</span>
                            {lastResult.autoBuyEligible && !isBuying && (
                              <button onClick={() => handleAutoBuy(item.id)} className="px-2 py-1 rounded text-[10px] font-medium bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors">
                                ⚡ Trigger Auto-Buy
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    )}
                    {/* Auto-buy result */}
                    {lastBuy && (
                      <div className={`px-5 py-3 border-t border-[var(--color-border-default)] ${lastBuy.status === "success" ? "bg-green-500/5" : lastBuy.status === "in_progress" ? "bg-amber-500/5" : "bg-red-500/5"}`}>
                        <div className="flex items-center gap-3 text-sm">
                          {lastBuy.status === "in_progress" && (
                            <><svg className="animate-spin h-4 w-4 text-amber-400" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg><span className="text-amber-400">Auto-buy in progress... this may take up to 2 minutes</span></>
                          )}
                          {lastBuy.status === "success" && (
                            <><span className="text-green-400 font-medium">✓ Purchase successful!</span>{lastBuy.order_number && <span className="font-[family-name:var(--font-mono)] text-[var(--color-text-secondary)]">Order #{lastBuy.order_number}</span>}</>
                          )}
                          {lastBuy.status === "failed" && (
                            <><span className="text-red-400">✕ Purchase failed</span><span className="text-xs text-[var(--color-text-muted)]">{lastBuy.failure_reason}</span></>
                          )}
                          {lastBuy.status === "carted" && (
                            <><span className="text-amber-400">🛒 Item carted but checkout failed</span><span className="text-xs text-[var(--color-text-muted)]">{lastBuy.failure_reason}</span></>
                          )}
                          {lastBuy.status === "out_of_stock" && (
                            <span className="text-[var(--color-text-muted)]">✕ Item went out of stock</span>
                          )}
                        </div>
                        {lastBuy.steps && lastBuy.steps.length > 0 && (
                          <div className="mt-2 text-[10px] font-[family-name:var(--font-mono)] text-[var(--color-text-muted)]">
                            Steps: {lastBuy.steps.join(" → ")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {showAddModal && <AddProductModal onClose={() => setShowAddModal(false)} onAdded={() => { setShowAddModal(false); fetchItems(); }} />}
    </div>
  );
}

function AddProductModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"notify_only" | "auto_buy">("notify_only");
  const [maxPrice, setMaxPrice] = useState("");
  const [interval, setInterval] = useState("300");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_url: url, mode, poll_interval_seconds: parseInt(interval), max_price: maxPrice ? parseFloat(maxPrice) : undefined, quantity: 1 }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to add product"); return; }
      onAdded();
    } catch (err: any) { setError(err.message || "Network error"); } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-7 shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Add Product</h2>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-white transition-colors">✕</button>
        </div>
        {error && <div className="mb-4 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 uppercase tracking-wider font-[family-name:var(--font-mono)]">Product URL</label>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.target.com/p/..." required className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-border-default)] text-sm placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-colors" />
            <div className="mt-1.5 text-[10px] text-[var(--color-text-muted)] font-[family-name:var(--font-mono)]">Supported: Target.com</div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 uppercase tracking-wider font-[family-name:var(--font-mono)]">Mode</label>
            <div className="grid grid-cols-2 gap-2">
              {(["notify_only", "auto_buy"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} className={`px-3 py-2.5 rounded-lg border text-sm text-left transition-colors ${mode === m ? "border-amber-500/40 bg-amber-500/5 text-white" : "border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]"}`}>
                  <div className="font-medium text-xs">{m === "notify_only" ? "📱 Alert Only" : "⚡ Auto-Buy"}</div>
                  <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{m === "notify_only" ? "SMS when in stock" : "Buy automatically"}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 uppercase tracking-wider font-[family-name:var(--font-mono)]">Max Price</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-muted)]">$</span>
                <input type="number" step="0.01" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="No limit" className="w-full pl-7 pr-3 py-2.5 rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-border-default)] text-sm placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-colors" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 uppercase tracking-wider font-[family-name:var(--font-mono)]">Check Every</label>
              <select value={interval} onChange={(e) => setInterval(e.target.value)} className="w-full px-3 py-2.5 rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-border-default)] text-sm focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-colors appearance-none">
                <option value="30">30 seconds</option>
                <option value="60">1 minute</option>
                <option value="300">5 minutes</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-[var(--color-border-default)] rounded-lg text-sm font-medium hover:bg-[var(--color-surface-3)] transition-colors">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 py-2.5 bg-amber-500 text-black font-semibold rounded-lg text-sm hover:bg-amber-400 transition-colors disabled:opacity-50">{loading ? "Adding..." : "Start Monitoring"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; dot: string; text: string }> = {
    in_stock: { label: "In Stock", dot: "bg-green-400", text: "text-green-400" },
    out_of_stock: { label: "Out of Stock", dot: "bg-red-400/60", text: "text-[var(--color-text-muted)]" },
    unknown: { label: "Pending", dot: "bg-[var(--color-text-muted)]", text: "text-[var(--color-text-muted)]" },
    price_changed: { label: "Price Chg", dot: "bg-amber-400", text: "text-amber-400" },
  };
  const c = config[status] || config.unknown;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
