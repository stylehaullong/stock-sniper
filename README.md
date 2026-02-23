# Stock Sniper 🎯

A multi-tenant SaaS platform for monitoring product availability across major retailers and optionally auto-purchasing items when they come in stock.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Vercel (Next.js 15)                       │
│                                                             │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────────┐  │
│  │ Frontend  │  │  API      │  │  Webhook Endpoints       │  │
│  │ Dashboard │  │  Routes   │  │  /worker-callback        │  │
│  │ Auth      │  │  CRUD     │  │  /stripe                 │  │
│  └──────────┘  └───────────┘  └──────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────▼────┐     ┌─────▼─────┐    ┌─────▼─────┐
    │ Supabase│     │  Upstash  │    │  Twilio   │
    │ DB +    │     │  Redis +  │    │  SMS      │
    │ Auth +  │     │  QStash   │    │           │
    │ RLS     │     │  (Queue)  │    └───────────┘
    └─────────┘     └─────┬─────┘
                          │
                   ┌──────▼──────┐
                   │   Worker    │
                   │  Service    │
                   │ (Fly.io /   │
                   │  EC2)       │
                   │             │
                   │ Playwright  │
                   │ + Claude AI │
                   │ + Proxies   │
                   └─────────────┘
```

## Key Design Decisions

### Multi-Tenant Isolation
- **Row-Level Security (RLS)** on every table via Supabase
- **Per-user encryption keys** for credential storage (AES-256-GCM)
- **Isolated browser contexts** per auto-buy session
- **Per-user rate limits** and job quotas

### AI-Powered Scraping
Instead of brittle CSS selectors, we use Claude's vision and text capabilities to:
- Parse product pages and determine stock status
- Navigate dynamic checkout flows
- Detect bot protection and CAPTCHAs
- Identify form fields and buttons

### Plugin/Adapter Pattern
Each retailer is a pluggable adapter implementing a standard interface:
- `matchesUrl()` - URL pattern matching
- `getStockCheckPrompt()` - AI prompt for stock parsing
- `getCheckoutFlowSteps()` - Checkout navigation steps
- `getLoginFlow()` - Authentication steps

Adding a new retailer = adding a new adapter file.

### Hybrid Serverless Architecture
- **Vercel serverless** for API, scheduling, and lightweight stock checks
- **External worker** (Fly.io/EC2) for browser automation (no timeout limits)
- **QStash** for reliable job queuing between the two

## Project Structure

```
stock-sniper/
├── src/
│   ├── app/
│   │   ├── (auth)/           # Login, register pages
│   │   ├── (dashboard)/      # Protected dashboard pages
│   │   ├── api/
│   │   │   ├── watchlist/    # CRUD for monitored products
│   │   │   ├── credentials/  # Encrypted credential storage
│   │   │   ├── purchases/    # Purchase history
│   │   │   ├── notifications/# SMS preferences + history
│   │   │   ├── billing/      # Stripe subscription management
│   │   │   └── webhooks/     # QStash + Stripe callbacks
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── lib/
│   │   ├── adapters/         # Retailer adapter pattern
│   │   │   ├── index.ts      # Registry + auto-detection
│   │   │   └── target-adapter.ts
│   │   ├── ai/               # Claude API for page parsing
│   │   ├── auth/             # Auth helpers + tier enforcement
│   │   ├── billing/          # Stripe helpers
│   │   ├── db/               # Supabase clients
│   │   ├── encryption/       # AES-256-GCM credential encryption
│   │   ├── notifications/    # Twilio SMS
│   │   └── queue/            # Upstash Redis + QStash
│   ├── components/
│   │   ├── ui/               # Shared UI components
│   │   ├── dashboard/        # Dashboard widgets
│   │   └── watchlist/        # Watchlist components
│   └── types/
│       └── index.ts          # All TypeScript types
├── workers/                  # External browser worker service
│   └── src/
│       ├── browser/
│       │   ├── manager.ts    # Playwright lifecycle + fingerprinting
│       │   └── auto-buy-engine.ts  # Purchase automation flow
│       └── index.ts          # Express server
├── supabase/
│   └── migrations/           # Database schema + RLS policies
└── .env.example
```

## Subscription Tiers

| Feature | Free | Pro ($9/mo) | Premium ($25/mo) |
|---------|------|-------------|-------------------|
| Monitored Products | 3 | 15 | 50 |
| Min Poll Interval | 5 min | 1 min | 30 sec |
| Notify Only | ✅ | ✅ | ✅ |
| Auto-Buy | ❌ | ✅ | ✅ |
| Concurrent Sessions | 0 | 2 | 5 |

## Getting Started

### Prerequisites
- Node.js 20+
- Supabase account
- Upstash account (Redis + QStash)
- Twilio account
- Stripe account
- Anthropic API key
- Residential proxy service (Bright Data recommended)

### Setup

1. Clone and install:
   ```bash
   npm install
   cd workers && npm install
   ```

2. Copy environment variables:
   ```bash
   cp .env.example .env.local
   ```

3. Configure Supabase:
   ```bash
   npx supabase init
   npx supabase db push
   ```

4. Run development:
   ```bash
   # Terminal 1: Next.js app
   npm run dev

   # Terminal 2: Worker service
   cd workers && npm run dev
   ```

## Supported Retailers

- ✅ Target.com
- 🔜 Walmart.com
- 🔜 PokemonCenter.com

## Security

- Credentials encrypted with AES-256-GCM using per-user derived keys
- Row-Level Security on all database tables
- Isolated browser contexts per session
- API key authentication between services
- No plaintext credentials stored anywhere
