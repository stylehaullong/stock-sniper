import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="max-w-2xl text-center">
        <h1 className="text-5xl font-bold tracking-tight mb-4">
          Stock <span className="text-amber-400">Sniper</span>
        </h1>
        <p className="text-lg text-neutral-400 mb-8">
          Never miss a drop. Monitor collectible boxes across major retailers
          and get instant alerts — or let us buy it for you automatically.
        </p>

        <div className="flex gap-4 justify-center">
          <Link
            href="/register"
            className="px-6 py-3 bg-amber-400 text-neutral-950 font-semibold rounded-lg hover:bg-amber-300 transition-colors"
          >
            Get Started
          </Link>
          <Link
            href="/login"
            className="px-6 py-3 border border-neutral-700 rounded-lg hover:border-neutral-500 transition-colors"
          >
            Sign In
          </Link>
        </div>

        <div className="mt-16 grid grid-cols-3 gap-8 text-sm text-neutral-500">
          <div>
            <div className="text-2xl mb-2">🎯</div>
            <div className="font-medium text-neutral-300">Target</div>
            <div>Pokemon, One Piece, Dragon Ball & more</div>
          </div>
          <div>
            <div className="text-2xl mb-2">📱</div>
            <div className="font-medium text-neutral-300">Instant Alerts</div>
            <div>SMS notifications the moment stock drops</div>
          </div>
          <div>
            <div className="text-2xl mb-2">🤖</div>
            <div className="font-medium text-neutral-300">Auto-Buy</div>
            <div>AI-powered checkout in seconds</div>
          </div>
        </div>
      </div>
    </main>
  );
}
