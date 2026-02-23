"use client";

import { useState, useEffect, useCallback } from "react";

interface SavedCredential {
  id: string;
  retailer: string;
  last_validated_at: string | null;
  is_valid: boolean;
  created_at: string;
  updated_at: string;
}

const RETAILERS = [
  { id: "target", name: "Target", icon: "🎯", domain: "target.com", status: "available" },
  { id: "walmart", name: "Walmart", icon: "🏪", domain: "walmart.com", status: "coming_soon" },
  { id: "pokemon_center", name: "Pokémon Center", icon: "⚡", domain: "pokemoncenter.com", status: "coming_soon" },
];

export default function CredentialsPage() {
  const [editingRetailer, setEditingRetailer] = useState<string | null>(null);
  const [savedCredentials, setSavedCredentials] = useState<Record<string, SavedCredential>>({});
  const [loading, setLoading] = useState(true);

  const fetchCredentials = useCallback(async () => {
    try {
      const res = await fetch("/api/credentials");
      const data = await res.json();
      if (data.credentials) {
        const map: Record<string, SavedCredential> = {};
        for (const cred of data.credentials) {
          map[cred.retailer] = cred;
        }
        setSavedCredentials(map);
      }
    } catch (err) {
      console.error("Failed to fetch credentials:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  async function handleDelete(retailer: string) {
    if (!confirm(`Remove your ${retailer} credentials? Any auto-buy items will switch to alert-only.`)) return;

    try {
      const res = await fetch(`/api/credentials?retailer=${retailer}`, { method: "DELETE" });
      if (res.ok) {
        setSavedCredentials((prev) => {
          const next = { ...prev };
          delete next[retailer];
          return next;
        });
      }
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">Credentials</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Store your retailer logins for auto-buy. Credentials are encrypted with AES-256.
        </p>
      </div>

      {/* Security notice */}
      <div className="mb-6 px-4 py-3 rounded-lg bg-amber-500/5 border border-amber-500/20 flex items-start gap-3">
        <span className="text-amber-400 mt-0.5">🔒</span>
        <div>
          <div className="text-sm font-medium text-amber-400">End-to-end encrypted</div>
          <div className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            Your passwords are encrypted with a unique key derived from your account. We can never see your plaintext credentials.
          </div>
        </div>
      </div>

      {/* Retailer cards */}
      <div className="space-y-3">
        {RETAILERS.map((retailer) => {
          const saved = savedCredentials[retailer.id];

          return (
            <div
              key={retailer.id}
              className="glow-card rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] overflow-hidden"
            >
              <div className="px-5 py-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-[var(--color-surface-3)] flex items-center justify-center text-lg">
                  {retailer.icon}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{retailer.name}</div>
                  <div className="text-[10px] font-[family-name:var(--font-mono)] text-[var(--color-text-muted)]">
                    {retailer.domain}
                    {saved && (
                      <span className="ml-2 text-[var(--color-text-muted)]">
                        · saved {timeAgo(saved.updated_at)}
                      </span>
                    )}
                  </div>
                </div>

                {retailer.status === "coming_soon" ? (
                  <span className="px-2.5 py-1 rounded text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider bg-[var(--color-surface-3)] text-[var(--color-text-muted)] border border-[var(--color-border-default)]">
                    Coming Soon
                  </span>
                ) : loading ? (
                  <span className="text-xs text-[var(--color-text-muted)]">Loading...</span>
                ) : saved ? (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider bg-green-500/10 text-green-400 border border-green-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                      Connected
                    </span>
                    <button
                      onClick={() => setEditingRetailer(retailer.id)}
                      className="px-2.5 py-1 rounded text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider text-[var(--color-text-muted)] hover:text-white border border-[var(--color-border-default)] hover:border-[var(--color-border-hover)] transition-colors"
                    >
                      Update
                    </button>
                    <button
                      onClick={() => handleDelete(retailer.id)}
                      className="px-2.5 py-1 rounded text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider text-[var(--color-text-muted)] hover:text-red-400 border border-[var(--color-border-default)] hover:border-red-500/20 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setEditingRetailer(retailer.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 text-black hover:bg-amber-400 transition-colors"
                  >
                    Connect
                  </button>
                )}
              </div>

              {/* Credential form (expanded) */}
              {editingRetailer === retailer.id && (
                <CredentialForm
                  retailer={retailer.id}
                  onSave={() => {
                    setEditingRetailer(null);
                    fetchCredentials();
                  }}
                  onCancel={() => setEditingRetailer(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CredentialForm({
  retailer,
  onSave,
  onCancel,
}: {
  retailer: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retailer, username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to save credentials");
        return;
      }

      onSave();
    } catch (err: any) {
      setError(err.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-5 pb-5 pt-1 border-t border-[var(--color-border-default)]">
      {error && (
        <div className="mt-4 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-3 pt-4">
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 uppercase tracking-wider font-[family-name:var(--font-mono)]">
            Email / Username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            placeholder="your@email.com"
            className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-border-default)] text-sm placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-colors"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 uppercase tracking-wider font-[family-name:var(--font-mono)]">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="••••••••"
            className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-border-default)] text-sm placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-colors"
          />
        </div>
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2 border border-[var(--color-border-default)] rounded-lg text-sm hover:bg-[var(--color-surface-3)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2 bg-amber-500 text-black font-semibold rounded-lg text-sm hover:bg-amber-400 transition-colors disabled:opacity-50"
          >
            {loading ? "Encrypting & Saving..." : "Save Credentials"}
          </button>
        </div>
      </form>
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
