"use client";

import { useEffect, useState, useCallback } from "react";

interface UserSettings {
  full_name: string | null;
  email: string;
  phone: string | null;
  subscription_tier: string;
  created_at: string;
}

interface Usage {
  watchlist_count: number;
  max_items: number;
  min_poll: string;
  auto_buy: boolean;
}

export default function SettingsPage() {
  const [user, setUser] = useState<UserSettings | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (data.user) {
        setUser(data.user);
        setName(data.user.full_name || "");
        setPhone(data.user.phone || "");
      }
      if (data.usage) setUsage(data.usage);
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: name,
          phone: phone || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveMsg({ type: "error", text: data.error || "Save failed" });
      } else {
        setSaveMsg({ type: "success", text: "Settings saved" });
        await fetchSettings();
      }
    } catch {
      setSaveMsg({ type: "error", text: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  const tier = user?.subscription_tier || "free";
  const usagePercent = usage ? Math.min(100, Math.round((usage.watchlist_count / usage.max_items) * 100)) : 0;

  if (loading) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="text-sm text-[var(--color-text-muted)]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">Settings</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Account settings and notification preferences
        </p>
      </div>

      {/* Profile */}
      <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-6 mb-5">
        <h2 className="text-sm font-semibold mb-4">Profile</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 uppercase tracking-wider font-[family-name:var(--font-mono)]">
              Email
            </label>
            <div className="px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-muted)]">
              {user?.email || "—"}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 uppercase tracking-wider font-[family-name:var(--font-mono)]">
              Full Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-border-default)] text-sm focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 uppercase tracking-wider font-[family-name:var(--font-mono)]">
              Phone Number{" "}
              <span className="normal-case tracking-normal text-[var(--color-text-muted)]">
                (E.164 format)
              </span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+15551234567"
              className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-border-default)] text-sm focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-colors"
            />
            <div className="text-[10px] text-[var(--color-text-muted)] mt-1 font-[family-name:var(--font-mono)]">
              Used for stock alert SMS notifications
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-amber-500 text-black font-semibold rounded-lg text-sm hover:bg-amber-400 transition-colors disabled:opacity-50"
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            {saveMsg && (
              <span
                className={`text-xs ${saveMsg.type === "success" ? "text-green-400" : "text-red-400"}`}
              >
                {saveMsg.text}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Subscription */}
      <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-6 mb-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Subscription</h2>
          <TierBadge tier={tier} />
        </div>

        <div className="space-y-3 mb-5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-secondary)]">Watchlist items</span>
            <span className="font-[family-name:var(--font-mono)]">
              {usage?.watchlist_count ?? 0} / {usage?.max_items ?? 3}
            </span>
          </div>
          <div className="w-full h-1.5 bg-[var(--color-surface-3)] rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all"
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-secondary)]">Min poll interval</span>
            <span className="font-[family-name:var(--font-mono)]">{usage?.min_poll ?? "5 min"}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-secondary)]">Auto-buy</span>
            {usage?.auto_buy ? (
              <span className="text-green-400 text-xs font-[family-name:var(--font-mono)]">Enabled</span>
            ) : (
              <span className="text-[var(--color-text-muted)] text-xs">Not available</span>
            )}
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-secondary)]">Member since</span>
            <span className="text-xs font-[family-name:var(--font-mono)] text-[var(--color-text-muted)]">
              {user?.created_at
                ? new Date(user.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : "—"}
            </span>
          </div>
        </div>

        {tier === "free" && (
          <div className="grid grid-cols-2 gap-3">
            <button className="py-2.5 bg-amber-500 text-black font-semibold rounded-lg text-sm hover:bg-amber-400 transition-colors">
              Upgrade to Pro — $9/mo
            </button>
            <button className="py-2.5 border border-[var(--color-border-default)] rounded-lg text-sm font-medium hover:bg-[var(--color-surface-3)] transition-colors">
              Premium — $25/mo
            </button>
          </div>
        )}
        {tier === "pro" && (
          <button className="w-full py-2.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-lg text-sm font-medium hover:bg-purple-500/20 transition-colors">
            Upgrade to Premium — $25/mo
          </button>
        )}
      </section>

      {/* Danger Zone */}
      <section className="rounded-xl border border-red-500/20 bg-red-500/[0.02] p-6">
        <h2 className="text-sm font-semibold text-red-400 mb-4">Danger Zone</h2>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Delete Account</div>
            <div className="text-xs text-[var(--color-text-muted)]">
              Permanently delete your account and all data
            </div>
          </div>
          <button className="px-4 py-2 border border-red-500/30 text-red-400 rounded-lg text-sm hover:bg-red-500/10 transition-colors">
            Delete
          </button>
        </div>
      </section>
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const styles: Record<string, string> = {
    free: "bg-[var(--color-surface-3)] text-[var(--color-text-muted)] border-[var(--color-border-default)]",
    pro: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    premium: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  };
  return (
    <span
      className={`px-2.5 py-1 rounded text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider border ${
        styles[tier] || styles.free
      }`}
    >
      {tier} Plan
    </span>
  );
}
