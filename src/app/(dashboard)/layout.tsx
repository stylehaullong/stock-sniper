"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: OverviewIcon },
  { href: "/watchlist", label: "Watchlist", icon: WatchlistIcon },
  { href: "/purchases", label: "Purchases", icon: PurchasesIcon },
  { href: "/credentials", label: "Credentials", icon: CredentialsIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r border-[var(--color-border-default)] bg-[var(--color-surface-1)] flex flex-col">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-[var(--color-border-default)]">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <span className="text-amber-400 text-xs font-bold font-[family-name:var(--font-mono)]">S</span>
            </div>
            <span className="text-sm font-semibold tracking-tight">
              Stock<span className="text-amber-400">Sniper</span>
            </span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-amber-500/10 text-amber-400"
                    : "text-[var(--color-text-secondary)] hover:text-white hover:bg-[var(--color-surface-3)]"
                }`}
              >
                <item.icon active={isActive} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Tier badge */}
        <div className="px-5 py-4 border-t border-[var(--color-border-default)]">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-full bg-[var(--color-surface-3)] flex items-center justify-center text-xs font-medium">
              U
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">User</div>
              <div className="text-[10px] font-[family-name:var(--font-mono)] text-amber-400 uppercase tracking-wider">Free Plan</div>
            </div>
          </div>
          <Link
            href="/settings"
            className="block text-center text-xs py-1.5 rounded-md border border-amber-500/20 text-amber-400 hover:bg-amber-500/10 transition-colors"
          >
            Upgrade
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 bg-[var(--color-surface-0)] overflow-auto">
        {children}
      </main>
    </div>
  );
}

// -- Icon Components --

function OverviewIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-amber-400" : "text-current"}>
      <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function WatchlistIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-amber-400" : "text-current"}>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 1.5V4M8 12v2.5M1.5 8H4M12 8h2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function PurchasesIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-amber-400" : "text-current"}>
      <path d="M2 2h2l1.5 8h7L15 4H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6" cy="13" r="1.25" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="13" r="1.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function CredentialsIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-amber-400" : "text-current"}>
      <rect x="2" y="6" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 6V4.5a3 3 0 016 0V6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="10.5" r="1" fill="currentColor" />
    </svg>
  );
}

function SettingsIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-amber-400" : "text-current"}>
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
