"use client";

import { useState, useEffect, useCallback } from "react";

interface SavedCredential {
  id: string;
  retailer: string;
  last_validated_at: string | null;
  is_valid: boolean;
  connection_status: string;
  connected_at: string | null;
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
  const [liveView, setLiveView] = useState<{
    credentialId: string;
    sessionId: string;
    liveViewUrl: string;
  } | null>(null);

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

  async function startConnection(credentialId: string) {
    try {
      const res = await fetch("/api/credentials/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential_id: credentialId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert("Failed to start connection: " + (data.error || "Unknown error"));
        return;
      }
      setLiveView({
        credentialId,
        sessionId: data.session_id,
        liveViewUrl: data.live_view_url,
      });
    } catch (err) {
      console.error("Connection error:", err);
    }
  }

  function getStatusBadge(cred: SavedCredential | undefined) {
    if (!cred) return null;
    const s = cred.connection_status;
    if (s === "connected") {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider bg-green-500/10 text-green-400 border border-green-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
          Connected
        </span>
      );
    }
    if (s === "connecting") {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          Connecting
        </span>
      );
    }
    if (s === "expired") {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
          Expired
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
        Not Connected
      </span>
    );
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
            Your passwords and payment details are encrypted with a unique key derived from your account. We can never see your plaintext credentials.
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
                    {saved?.connected_at && (
                      <span className="ml-2">· authenticated {timeAgo(saved.connected_at)}</span>
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
                    {getStatusBadge(saved)}
                    {saved.connection_status !== "connected" && (
                      <button
                        onClick={() => startConnection(saved.id)}
                        className="px-2.5 py-1 rounded text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 transition-colors"
                      >
                        Reconnect
                      </button>
                    )}
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

              {editingRetailer === retailer.id && (
                <CredentialForm
                  retailer={retailer.id}
                  onSave={(credentialId) => {
                    setEditingRetailer(null);
                    fetchCredentials();
                    startConnection(credentialId);
                  }}
                  onCancel={() => setEditingRetailer(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Live View Modal */}
      {liveView && (
        <LiveViewModal
          liveViewUrl={liveView.liveViewUrl}
          onComplete={async () => {
            try {
              await fetch("/api/credentials/connect/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  credential_id: liveView.credentialId,
                  session_id: liveView.sessionId,
                }),
              });
            } catch (err) {
              console.error("Failed to complete connection:", err);
            }
            setLiveView(null);
            fetchCredentials();
          }}
          onCancel={() => {
            setLiveView(null);
            fetchCredentials();
          }}
        />
      )}
    </div>
  );
}

/* ─────────────── Credential Form ─────────────── */

function CredentialForm({
  retailer,
  onSave,
  onCancel,
}: {
  retailer: string;
  onSave: (credentialId: string) => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [cvv, setCvv] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retailer, username, password, cvv: cvv || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save credentials");
        return;
      }
      onSave(data.credential?.id || data.id);
    } catch (err: any) {
      setError(err.message || "Network error");
    } finally {
      setSubmitting(false);
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
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 uppercase tracking-wider font-[family-name:var(--font-mono)]">
            Card CVV
            <span className="ml-2 normal-case tracking-normal text-[var(--color-text-muted)] font-normal">
              Required for checkout
            </span>
          </label>
          <input
            type="password"
            value={cvv}
            onChange={(e) => {
              // Only allow digits, max 4 characters
              const val = e.target.value.replace(/\D/g, "").slice(0, 4);
              setCvv(val);
            }}
            placeholder="3-4 digit code on your card"
            inputMode="numeric"
            maxLength={4}
            className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-border-default)] text-sm placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-colors"
          />
          <p className="mt-1 text-[10px] text-[var(--color-text-muted)] font-[family-name:var(--font-mono)]">
            Target requires CVV confirmation at checkout. Encrypted with the same AES-256 key as your password.
          </p>
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
            disabled={submitting}
            className="flex-1 py-2 bg-amber-500 text-black font-semibold rounded-lg text-sm hover:bg-amber-400 transition-colors disabled:opacity-50"
          >
            {submitting ? "Saving & Connecting..." : "Save & Connect"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ─────────────── Live View Modal ─────────────── */

function LiveViewModal({
  liveViewUrl,
  onComplete,
  onCancel,
}: {
  liveViewUrl: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<"auto_fill" | "manual" | "saving">("auto_fill");

  useEffect(() => {
    const timer = setTimeout(() => setPhase("manual"), 12000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[900px] max-w-[95vw] bg-[var(--color-surface-1)] border border-[var(--color-border-default)] rounded-2xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              {phase === "auto_fill" && (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  Auto-filling login...
                </>
              )}
              {phase === "manual" && (
                <>
                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  Complete login below
                </>
              )}
              {phase === "saving" && (
                <>
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  Saving session...
                </>
              )}
            </div>
            <div className="text-[10px] text-[var(--color-text-muted)] font-[family-name:var(--font-mono)] mt-0.5">
              {phase === "auto_fill"
                ? "We're entering your credentials automatically..."
                : phase === "manual"
                ? "If Target asks for a verification code, enter it in the browser below. Then click \"I'm Logged In\"."
                : "Saving your authenticated session for future auto-buys..."
              }
            </div>
          </div>
          <button
            onClick={onCancel}
            className="text-[var(--color-text-muted)] hover:text-white text-lg leading-none px-2"
          >
            ✕
          </button>
        </div>

        {/* Live View iframe */}
        <div className="bg-black">
          <iframe
            src={liveViewUrl}
            className="w-full h-[520px] border-0"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            allow="clipboard-read; clipboard-write"
          />
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--color-border-default)] flex items-center justify-between">
          <div className="text-[10px] text-[var(--color-text-muted)] font-[family-name:var(--font-mono)]">
            Secure isolated browser. Session saved for future auto-buys.
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-1.5 rounded-lg text-xs border border-[var(--color-border-default)] hover:bg-[var(--color-surface-3)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setPhase("saving");
                onComplete();
              }}
              disabled={phase === "saving"}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-green-500 text-black hover:bg-green-400 transition-colors disabled:opacity-50"
            >
              {phase === "saving" ? "Saving..." : "I'm Logged In — Save Session"}
            </button>
          </div>
        </div>
      </div>
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