import Link from "next/link";

function Crosshair({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 0v6M8 10v6M0 8h6M10 8h16" stroke="currentColor" strokeWidth="1" opacity="0.3" />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen relative overflow-hidden grid-bg">
      {/* Ambient glow */}
      <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-[radial-gradient(ellipse,rgba(245,158,11,0.08),transparent_70%)] pointer-events-none" />
      <div className="absolute bottom-[-100px] right-[-100px] w-[400px] h-[400px] bg-[radial-gradient(ellipse,rgba(245,158,11,0.04),transparent_70%)] pointer-events-none" />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-8 py-5 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <span className="text-amber-400 text-sm font-bold font-[family-name:var(--font-mono)]">S</span>
          </div>
          <span className="text-lg font-semibold tracking-tight">
            Stock<span className="text-amber-400">Sniper</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-white transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="px-4 py-2 text-sm bg-amber-500 text-black font-medium rounded-lg hover:bg-amber-400 transition-colors"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 flex flex-col items-center justify-center px-6 pt-24 pb-32">
        <div className="animate-fade-up" style={{ animationDelay: '0ms' }}>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-500/20 bg-amber-500/5 mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 pulse-live" />
            <span className="text-xs font-medium font-[family-name:var(--font-mono)] text-amber-400 uppercase tracking-wider">
              Monitoring Active
            </span>
          </div>
        </div>

        <h1
          className="text-6xl md:text-8xl font-extrabold tracking-tighter text-center leading-[0.9] mb-6 animate-fade-up"
          style={{ animationDelay: '80ms' }}
        >
          Never miss
          <br />
          <span className="text-amber-400">a drop.</span>
        </h1>

        <p
          className="text-lg md:text-xl text-[var(--color-text-secondary)] max-w-xl text-center mb-12 animate-fade-up leading-relaxed"
          style={{ animationDelay: '160ms' }}
        >
          AI-powered stock monitoring and auto-checkout for collectible boxes.
          Pokemon, One Piece, Dragon Ball — across every major retailer.
        </p>

        <div
          className="flex flex-col sm:flex-row gap-4 animate-fade-up"
          style={{ animationDelay: '240ms' }}
        >
          <Link
            href="/register"
            className="px-8 py-3.5 bg-amber-500 text-black font-semibold rounded-lg hover:bg-amber-400 transition-all hover:shadow-[0_0_30px_rgba(245,158,11,0.3)] text-center"
          >
            Start Monitoring — Free
          </Link>
          <Link
            href="#how-it-works"
            className="px-8 py-3.5 border border-[var(--color-border-default)] rounded-lg hover:border-[var(--color-border-hover)] transition-colors text-[var(--color-text-secondary)] hover:text-white text-center"
          >
            How it works
          </Link>
        </div>

        {/* Terminal-style preview */}
        <div
          className="mt-20 w-full max-w-2xl animate-fade-up"
          style={{ animationDelay: '400ms' }}
        >
          <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] overflow-hidden shadow-2xl shadow-black/50">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border-default)] bg-[var(--color-surface-2)]">
              <div className="w-3 h-3 rounded-full bg-[var(--color-danger)]/60" />
              <div className="w-3 h-3 rounded-full bg-amber-500/60" />
              <div className="w-3 h-3 rounded-full bg-[var(--color-success)]/60" />
              <span className="ml-3 text-xs font-[family-name:var(--font-mono)] text-[var(--color-text-muted)]">
                stock-sniper — monitoring
              </span>
            </div>
            <div className="p-5 font-[family-name:var(--font-mono)] text-sm space-y-2.5">
              <div className="flex items-start gap-3">
                <span className="text-[var(--color-text-muted)] select-none shrink-0">09:41:02</span>
                <span className="text-[var(--color-text-secondary)]">
                  Checking Target — Pokemon TCG Prismatic Evolutions ETB...
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-[var(--color-text-muted)] select-none shrink-0">09:41:03</span>
                <span className="text-[var(--color-text-secondary)]">Status: <span className="text-red-400">Out of stock</span></span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-[var(--color-text-muted)] select-none shrink-0">09:42:04</span>
                <span className="text-[var(--color-text-secondary)]">
                  Checking Target — One Piece TCG OP-09 Booster Box...
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-[var(--color-text-muted)] select-none shrink-0">09:42:05</span>
                <span className="text-amber-400 font-medium">
                  ⚡ IN STOCK — $143.99 — Initiating auto-buy...
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-[var(--color-text-muted)] select-none shrink-0">09:42:08</span>
                <span className="text-[var(--color-text-secondary)]">
                  → Added to cart
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-[var(--color-text-muted)] select-none shrink-0">09:42:14</span>
                <span className="text-[var(--color-text-secondary)]">
                  → Checkout complete
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-[var(--color-text-muted)] select-none shrink-0">09:42:15</span>
                <span className="text-green-400 font-medium">
                  ✓ Order confirmed — #TGT-4829173 — SMS sent
                </span>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <span className="text-[var(--color-text-muted)] select-none shrink-0">09:42:16</span>
                <span className="text-[var(--color-text-muted)]">Resuming monitoring...</span>
                <span className="inline-block w-2 h-4 bg-amber-400/80 animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="how-it-works" className="relative z-10 px-6 pb-32">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                icon: "🔍",
                label: "MONITOR",
                title: "Add any product",
                desc: "Paste a URL from Target, Walmart, or Pokemon Center. Our AI understands any product page — no manual setup.",
              },
              {
                icon: "⚡",
                label: "DETECT",
                title: "Instant detection",
                desc: "Checks as frequently as every 30 seconds. The moment stock appears, you get an SMS within seconds.",
              },
              {
                icon: "🤖",
                label: "ACQUIRE",
                title: "Auto-checkout",
                desc: "AI navigates login, cart, and checkout in under 15 seconds. Handles dynamic pages, popups, and bot detection.",
              },
            ].map((feature, i) => (
              <div
                key={feature.label}
                className="glow-card rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-7 animate-fade-up"
                style={{ animationDelay: `${600 + i * 100}ms` }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-2xl">{feature.icon}</span>
                  <span className="text-[10px] font-bold font-[family-name:var(--font-mono)] tracking-[0.2em] text-amber-400 uppercase">
                    {feature.label}
                  </span>
                </div>
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="relative z-10 px-6 pb-32">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-3 animate-fade-up" style={{ animationDelay: '0ms' }}>
            Simple pricing
          </h2>
          <p className="text-center text-[var(--color-text-secondary)] mb-12 animate-fade-up" style={{ animationDelay: '80ms' }}>
            Start free. Upgrade when you need auto-buy.
          </p>

          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                tier: "Free",
                price: "$0",
                features: ["3 products", "5 min checks", "SMS alerts", "—"],
                cta: "Get Started",
                highlight: false,
              },
              {
                tier: "Pro",
                price: "$9",
                period: "/mo",
                features: ["15 products", "1 min checks", "SMS alerts", "Auto-buy (2 slots)"],
                cta: "Start Pro",
                highlight: true,
              },
              {
                tier: "Premium",
                price: "$25",
                period: "/mo",
                features: ["50 products", "30s checks", "SMS alerts", "Auto-buy (5 slots)"],
                cta: "Go Premium",
                highlight: false,
              },
            ].map((plan, i) => (
              <div
                key={plan.tier}
                className={`glow-card rounded-xl border p-7 animate-fade-up ${
                  plan.highlight
                    ? "border-amber-500/40 bg-amber-500/[0.03]"
                    : "border-[var(--color-border-default)] bg-[var(--color-surface-1)]"
                }`}
                style={{ animationDelay: `${160 + i * 100}ms` }}
              >
                {plan.highlight && (
                  <div className="text-[10px] font-bold font-[family-name:var(--font-mono)] tracking-[0.2em] text-amber-400 uppercase mb-4">
                    Most Popular
                  </div>
                )}
                <div className="text-sm text-[var(--color-text-secondary)] mb-1">{plan.tier}</div>
                <div className="text-4xl font-bold mb-6">
                  {plan.price}
                  {plan.period && (
                    <span className="text-base font-normal text-[var(--color-text-muted)]">
                      {plan.period}
                    </span>
                  )}
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                      <span className={f === "—" ? "text-[var(--color-text-muted)]" : "text-amber-400"}>
                        {f === "—" ? "·" : "✓"}
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/register"
                  className={`block text-center py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    plan.highlight
                      ? "bg-amber-500 text-black hover:bg-amber-400"
                      : "border border-[var(--color-border-default)] hover:border-[var(--color-border-hover)] text-[var(--color-text-secondary)] hover:text-white"
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-[var(--color-border-default)] px-6 py-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <span className="text-amber-400 text-[10px] font-bold font-[family-name:var(--font-mono)]">S</span>
            </div>
            <span className="text-sm font-medium">
              Stock<span className="text-amber-400">Sniper</span>
            </span>
          </div>
          <div className="text-xs text-[var(--color-text-muted)]">
            © 2025 StockSniper. Not affiliated with any retailer.
          </div>
        </div>
      </footer>
    </main>
  );
}
