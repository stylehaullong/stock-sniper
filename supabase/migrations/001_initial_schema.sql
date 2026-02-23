-- ============================================================
-- Stock Sniper - Database Schema
-- Supabase Migration with Row-Level Security
-- ============================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================================
-- USERS (extends Supabase auth.users)
-- ============================================================
create table public.users (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null unique,
  full_name text,
  phone text,
  subscription_tier text not null default 'free' check (subscription_tier in ('free', 'pro', 'premium')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "Users can view own profile"
  on public.users for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create user profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- RETAILER CREDENTIALS (encrypted)
-- ============================================================
create table public.retailer_credentials (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  retailer text not null check (retailer in ('target', 'walmart', 'pokemon_center')),
  encrypted_username text not null,
  encrypted_password text not null,
  encryption_iv text not null,
  last_validated_at timestamptz,
  is_valid boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One credential per retailer per user
  unique(user_id, retailer)
);

alter table public.retailer_credentials enable row level security;

create policy "Users can manage own credentials"
  on public.retailer_credentials for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- WATCHLIST ITEMS
-- ============================================================
create table public.watchlist_items (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  retailer text not null check (retailer in ('target', 'walmart', 'pokemon_center')),
  product_url text not null,
  product_sku text,
  product_name text not null default 'Unknown Product',
  product_image_url text,
  mode text not null default 'notify_only' check (mode in ('notify_only', 'auto_buy')),
  poll_interval_seconds integer not null default 300,
  max_price numeric(10,2),
  quantity integer not null default 1,
  is_active boolean not null default true,
  last_checked_at timestamptz,
  last_status text not null default 'unknown' check (last_status in ('in_stock', 'out_of_stock', 'unknown', 'price_changed')),
  last_price numeric(10,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.watchlist_items enable row level security;

create policy "Users can manage own watchlist"
  on public.watchlist_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Index for worker polling queries
create index idx_watchlist_active_polling
  on public.watchlist_items (is_active, last_checked_at, poll_interval_seconds)
  where is_active = true;

create index idx_watchlist_user
  on public.watchlist_items (user_id);

-- ============================================================
-- PURCHASE ATTEMPTS
-- ============================================================
create table public.purchase_attempts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  watchlist_item_id uuid not null references public.watchlist_items(id) on delete cascade,
  status text not null default 'detected' check (status in (
    'detected', 'carted', 'checkout_started', 'checkout_payment', 'success', 'failed', 'cancelled'
  )),
  failure_reason text,
  screenshot_url text,
  total_price numeric(10,2),
  order_number text,
  retailer text not null,
  product_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.purchase_attempts enable row level security;

create policy "Users can view own purchases"
  on public.purchase_attempts for select
  using (auth.uid() = user_id);

create policy "Service role can insert purchases"
  on public.purchase_attempts for insert
  with check (true); -- Workers use service role key

create policy "Service role can update purchases"
  on public.purchase_attempts for update
  using (true); -- Workers use service role key

create index idx_purchases_user
  on public.purchase_attempts (user_id, created_at desc);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
create table public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  watchlist_item_id uuid references public.watchlist_items(id) on delete set null,
  type text not null default 'sms' check (type in ('sms', 'email', 'push')),
  message text not null,
  sent_at timestamptz not null default now(),
  delivered boolean not null default false
);

alter table public.notifications enable row level security;

create policy "Users can view own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

create index idx_notifications_user
  on public.notifications (user_id, sent_at desc);

-- ============================================================
-- ACTIVITY LOG
-- ============================================================
create table public.activity_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  watchlist_item_id uuid references public.watchlist_items(id) on delete set null,
  event_type text not null check (event_type in (
    'stock_check', 'stock_found', 'cart_add', 'checkout_start',
    'checkout_complete', 'checkout_failed', 'notification_sent', 'error'
  )),
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.activity_log enable row level security;

create policy "Users can view own activity"
  on public.activity_log for select
  using (auth.uid() = user_id);

create index idx_activity_user
  on public.activity_log (user_id, created_at desc);

create index idx_activity_watchlist
  on public.activity_log (watchlist_item_id, created_at desc);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_users_updated_at
  before update on public.users
  for each row execute function public.update_updated_at_column();

create trigger update_credentials_updated_at
  before update on public.retailer_credentials
  for each row execute function public.update_updated_at_column();

create trigger update_watchlist_updated_at
  before update on public.watchlist_items
  for each row execute function public.update_updated_at_column();

create trigger update_purchases_updated_at
  before update on public.purchase_attempts
  for each row execute function public.update_updated_at_column();

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Get items due for polling (called by scheduler)
create or replace function public.get_items_due_for_polling(batch_size integer default 50)
returns setof public.watchlist_items as $$
begin
  return query
    select *
    from public.watchlist_items
    where is_active = true
      and (
        last_checked_at is null
        or last_checked_at + (poll_interval_seconds || ' seconds')::interval < now()
      )
    order by last_checked_at asc nulls first
    limit batch_size;
end;
$$ language plpgsql security definer;

-- Get user's tier limits (for enforcement)
create or replace function public.get_user_watchlist_count(p_user_id uuid)
returns integer as $$
begin
  return (
    select count(*)::integer
    from public.watchlist_items
    where user_id = p_user_id and is_active = true
  );
end;
$$ language plpgsql security definer;
