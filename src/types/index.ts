// ============================================================
// Stock Sniper - Core Types
// ============================================================

// -- Enums --

export type Retailer = "target" | "walmart" | "pokemon_center";

export type SubscriptionTier = "free" | "pro" | "premium";

export type WatchlistMode = "notify_only" | "auto_buy";

export type StockStatus = "in_stock" | "out_of_stock" | "unknown" | "price_changed";

export type PurchaseStatus =
  | "detected"
  | "carted"
  | "checkout_started"
  | "checkout_payment"
  | "success"
  | "failed"
  | "cancelled";

export type NotificationType = "sms" | "email" | "push";

export type ActivityEventType =
  | "stock_check"
  | "stock_found"
  | "cart_add"
  | "checkout_start"
  | "checkout_complete"
  | "checkout_failed"
  | "notification_sent"
  | "error";

export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

// -- Database Models --

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  subscription_tier: SubscriptionTier;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RetailerCredential {
  id: string;
  user_id: string;
  retailer: Retailer;
  encrypted_username: string;
  encrypted_password: string;
  encryption_iv: string;
  last_validated_at: string | null;
  is_valid: boolean;
  created_at: string;
  updated_at: string;
}

export interface WatchlistItem {
  id: string;
  user_id: string;
  retailer: Retailer;
  product_url: string;
  product_sku: string | null;
  product_name: string;
  product_image_url: string | null;
  mode: WatchlistMode;
  poll_interval_seconds: number;
  max_price: number | null;
  quantity: number;
  is_active: boolean;
  last_checked_at: string | null;
  last_status: StockStatus;
  last_price: number | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseAttempt {
  id: string;
  user_id: string;
  watchlist_item_id: string;
  status: PurchaseStatus;
  failure_reason: string | null;
  screenshot_url: string | null;
  total_price: number | null;
  order_number: string | null;
  retailer: Retailer;
  product_name: string;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  watchlist_item_id: string;
  type: NotificationType;
  message: string;
  sent_at: string;
  delivered: boolean;
}

export interface ActivityLog {
  id: string;
  user_id: string;
  watchlist_item_id: string | null;
  event_type: ActivityEventType;
  details: Record<string, unknown>;
  created_at: string;
}

// -- API Request/Response Types --

export interface AddWatchlistItemRequest {
  retailer: Retailer;
  product_url: string;
  product_sku?: string;
  product_name?: string;
  mode: WatchlistMode;
  poll_interval_seconds?: number;
  max_price?: number;
  quantity?: number;
}

export interface UpdateWatchlistItemRequest {
  mode?: WatchlistMode;
  poll_interval_seconds?: number;
  max_price?: number;
  quantity?: number;
  is_active?: boolean;
}

export interface SaveCredentialRequest {
  retailer: Retailer;
  username: string;
  password: string;
}

export interface StockCheckResult {
  in_stock: boolean;
  price: number | null;
  product_name: string;
  product_image_url: string | null;
  add_to_cart_available: boolean;
  raw_status: string;
  checked_at: string;
}

// -- Worker Types --

export interface MonitorJobPayload {
  watchlist_item_id: string;
  user_id: string;
  retailer: Retailer;
  product_url: string;
  product_sku: string | null;
  mode: WatchlistMode;
  max_price: number | null;
  quantity: number;
}

export interface AutoBuyJobPayload extends MonitorJobPayload {
  encrypted_credentials: {
    encrypted_username: string;
    encrypted_password: string;
    encryption_iv: string;
  };
}

export interface WorkerCallbackPayload {
  job_id: string;
  watchlist_item_id: string;
  user_id: string;
  event_type: ActivityEventType;
  stock_result?: StockCheckResult;
  purchase_result?: {
    status: PurchaseStatus;
    order_number?: string;
    total_price?: number;
    failure_reason?: string;
    screenshot_url?: string;
  };
}

// -- Adapter Interface --

export interface RetailerAdapter {
  retailer: Retailer;
  displayName: string;
  urlPatterns: RegExp[];

  /** Check if a URL belongs to this retailer */
  matchesUrl(url: string): boolean;

  /** Extract product identifier from URL */
  extractProductId(url: string): string | null;

  /** AI prompt template for parsing stock status from page content */
  getStockCheckPrompt(pageContent: string): string;

  /** AI prompt template for identifying the add-to-cart button */
  getAddToCartPrompt(pageContent: string): string;

  /** Navigation steps to reach checkout after adding to cart */
  getCheckoutFlowSteps(): CheckoutStep[];

  /** Login URL and flow for this retailer */
  getLoginFlow(): LoginFlow;
}

export interface CheckoutStep {
  name: string;
  description: string;
  aiPrompt: string; // Prompt to identify what to click/fill next
  timeout_ms: number;
}

export interface LoginFlow {
  loginUrl: string;
  steps: CheckoutStep[];
}

// -- Subscription Limits --

export interface TierLimits {
  max_watchlist_items: number;
  min_poll_interval_seconds: number;
  modes_allowed: WatchlistMode[];
  max_concurrent_sessions: number;
}

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: {
    max_watchlist_items: 3,
    min_poll_interval_seconds: 300, // 5 min
    modes_allowed: ["notify_only"],
    max_concurrent_sessions: 0,
  },
  pro: {
    max_watchlist_items: 15,
    min_poll_interval_seconds: 60, // 1 min
    modes_allowed: ["notify_only", "auto_buy"],
    max_concurrent_sessions: 2,
  },
  premium: {
    max_watchlist_items: 50,
    min_poll_interval_seconds: 30,
    modes_allowed: ["notify_only", "auto_buy"],
    max_concurrent_sessions: 5,
  },
};
