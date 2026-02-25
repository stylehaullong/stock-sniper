/**
 * Shared Target stock check logic.
 * Used by /api/watchlist/check (manual) and /api/cron/stock-check (automated).
 *
 * Tries 5 Redsky API endpoints with 2 API keys, then falls back to
 * HTML scrape of the product page (__TGT_DATA__, JSON-LD, meta tags).
 */

const API_KEY = "9f36aeafbe60771e321a7cc95a78140772ab3e96";
const API_KEY_ALT = "ff457966e64d5e877fdbad070f276d18ecec4a01";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.target.com/",
  Origin: "https://www.target.com",
};

export interface StockResult {
  in_stock: boolean;
  price: number | null;
  product_name: string;
  product_image_url: string | null;
  raw_status: string;
}

export function extractTcin(url: string): string | null {
  const m = url.match(/A-(\d+)/);
  if (m) return m[1];
  const p = url.match(/preselect=(\d+)/);
  if (p) return p[1];
  return null;
}

export async function checkTargetStock(tcin: string, productUrl?: string): Promise<StockResult> {
  let productInfo: StockResult | null = null;
  let fulfillmentInfo: StockResult | null = null;

  // Step 1: Get product info (price, name, image) from pdp_client_v1
  const pdpEndpoints = [
    `https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1?key=${API_KEY}&tcin=${tcin}&store_id=3991&pricing_store_id=3991&has_pricing_store_id=true&has_financing_options=true&visitor_id=visitor&has_size_context=true&zip=90045&state=CA&latitude=33.98&longitude=-118.47&channel=WEB&page=%2Fp%2FA-${tcin}`,
    `https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1?key=${API_KEY_ALT}&tcin=${tcin}&store_id=3991&pricing_store_id=3991&has_pricing_store_id=true&zip=90045&state=CA&latitude=33.98&longitude=-118.47&channel=WEB&page=%2Fp%2FA-${tcin}`,
  ];

  for (const url of pdpEndpoints) {
    const data = await tryFetch(url);
    if (data) {
      console.log(`[StockCheck] TCIN ${tcin}: got pdp_client response`);
      productInfo = parsePdpClientResponse(data, tcin);
      if (productInfo) break;
    }
  }

  // Step 2: Get fulfillment/stock status from fulfillment endpoints
  const fulfillmentEndpoints = [
    `https://redsky.target.com/redsky_aggregations/v1/web/product_summary_with_fulfillment_v1?key=${API_KEY}&tcins=${tcin}&store_id=3991&zip=90045&state=CA&latitude=33.98&longitude=-118.47&has_required_store_id=true&channel=WEB&page=%2Fp%2FA-${tcin}`,
    `https://redsky.target.com/redsky_aggregations/v1/web/pdp_fulfillment_v1?key=${API_KEY}&tcin=${tcin}&store_id=3991&store_positions_store_id=3991&has_store_positions_store_id=true&zip=90045&state=CA&latitude=33.98&longitude=-118.47&pricing_store_id=3991&has_pricing_store_id=true&is_bot=false`,
    `https://redsky.target.com/redsky_aggregations/v1/web/pdp_fulfillment_v1?key=${API_KEY_ALT}&tcin=${tcin}&store_id=3991&store_positions_store_id=3991&has_store_positions_store_id=true&zip=90045&state=CA&latitude=33.98&longitude=-118.47&pricing_store_id=3991&has_pricing_store_id=true&is_bot=false`,
  ];

  for (const url of fulfillmentEndpoints) {
    const data = await tryFetch(url);
    if (data) {
      console.log(`[StockCheck] TCIN ${tcin}: got response from ${url.split("?")[0].split("/").pop()}`);
      const parsed = url.includes("product_summary")
        ? parseSummaryResponse(data, tcin)
        : parseFulfillmentResponse(data, tcin);
      if (parsed && parsed.raw_status !== "Unknown") {
        fulfillmentInfo = parsed;
        break;
      }
    }
  }

  // Step 3: Merge results — prefer fulfillment for stock status, pdp_client for price/info
  if (productInfo && fulfillmentInfo) {
    return {
      in_stock: fulfillmentInfo.in_stock,
      price: productInfo.price || fulfillmentInfo.price,
      product_name: productInfo.product_name,
      product_image_url: productInfo.product_image_url || fulfillmentInfo.product_image_url,
      raw_status: fulfillmentInfo.raw_status,
    };
  }

  // If we only have fulfillment with useful status
  if (fulfillmentInfo && fulfillmentInfo.raw_status !== "Unknown") {
    return fulfillmentInfo;
  }

  // If we only have product info (price exists), infer availability
  if (productInfo && productInfo.price !== null) {
    console.log(`[StockCheck] TCIN ${tcin}: no fulfillment data, inferring from price + HTML`);
    
    // Try HTML scrape to confirm stock status
    const pageUrl = productUrl || `https://www.target.com/p/-/A-${tcin}`;
    const htmlResult = await scrapeProductPage(pageUrl, tcin);
    
    if (htmlResult) {
      return {
        in_stock: htmlResult.in_stock,
        price: productInfo.price,
        product_name: productInfo.product_name,
        product_image_url: productInfo.product_image_url,
        raw_status: htmlResult.raw_status,
      };
    }

    // Price exists, no explicit OOS signal — assume available
    return {
      ...productInfo,
      in_stock: true,
      raw_status: "Inferred: product has active price, no OOS signal",
    };
  }

  // Full fallback: HTML scrape only
  const pageUrl = productUrl || `https://www.target.com/p/-/A-${tcin}`;
  console.log(`[StockCheck] TCIN ${tcin}: all APIs failed, trying HTML scrape`);
  const htmlResult = await scrapeProductPage(pageUrl, tcin);
  if (htmlResult) return htmlResult;

  throw new Error(
    `All Target API endpoints and HTML scrape failed for TCIN ${tcin}.`
  );
}

/** Returns true if the result has price OR a non-Unknown status */
function hasUsefulData(r: StockResult): boolean {
  return r.price !== null || (r.raw_status !== "Unknown" && r.raw_status !== "");
}

/**
 * Parse the pdp_client_v1 response — the most complete Target API.
 * Contains product info, price, fulfillment, and ratings.
 */
function parsePdpClientResponse(data: any, tcin: string): StockResult | null {
  const product = data?.data?.product;
  if (!product) return null;

  const name = product?.item?.product_description?.title || `Target Product ${tcin}`;
  const img = product?.item?.enrichment?.images?.primary_image_url || null;

  // Price from multiple paths
  const price = product?.price?.current_retail 
    || product?.price?.reg_retail
    || product?.price?.current_retail_min
    || (product?.price?.formatted_current_price ? parseFloat(product.price.formatted_current_price.replace(/[^0-9.]/g, "")) : null)
    || null;

  // Fulfillment
  const fulfillment = product?.fulfillment;
  const ship = fulfillment?.shipping_options?.availability_status;
  const pickup0 = fulfillment?.store_options?.[0]?.order_pickup?.availability_status;
  const delivery = fulfillment?.scheduled_delivery?.availability_status;
  const oosAll = fulfillment?.is_out_of_stock_in_all_store_and_online;

  // Product-level flags
  const isBuyable = product?.item?.is_buyable;
  const cartAddType = product?.item?.cart_add_on_threshold;

  const inStock = oosAll === true ? false :
    isAvailable(ship) || isAvailable(pickup0) || isAvailable(delivery) || isBuyable === true ||
    // If we have a price but no fulfillment status at all, product is likely available
    // (common for everyday items where Target doesn't return fulfillment details)
    (price !== null && !ship && !pickup0 && !delivery && oosAll !== true);

  const statusParts: string[] = [];
  if (ship) statusParts.push(`Ship: ${ship}`);
  if (pickup0) statusParts.push(`Pickup: ${pickup0}`);
  if (delivery) statusParts.push(`Delivery: ${delivery}`);
  if (oosAll !== undefined) statusParts.push(`OOS-All: ${oosAll}`);
  if (isBuyable !== undefined) statusParts.push(`Buyable: ${isBuyable}`);
  if (!ship && !pickup0 && !delivery && price !== null) statusParts.push(`Inferred: has price`);

  console.log(`[StockCheck] TCIN ${tcin} pdp_client:`, JSON.stringify({
    price, ship, pickup0, delivery, oosAll, isBuyable, inStock
  }));

  return {
    in_stock: inStock,
    price,
    product_name: name,
    product_image_url: img,
    raw_status: statusParts.join(" | ") || "Unknown",
  };
}

// -- Internal helpers --

async function tryFetch(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function parseSummaryResponse(data: any, tcin: string): StockResult | null {
  const summaries = data?.data?.product_summaries;
  if (!summaries || !Array.isArray(summaries) || summaries.length === 0) {
    if (data?.data?.product) return parseFulfillmentResponse(data, tcin);
    return null;
  }

  const p = summaries[0];
  const name = p?.item?.product_description?.title || `Target Product ${tcin}`;
  const img = p?.item?.enrichment?.images?.primary_image_url || null;
  const price =
    p?.price?.formatted_current_price_default_message
      ? parseFloat(p.price.formatted_current_price_default_message.replace(/[^0-9.]/g, ""))
      : p?.price?.current_retail || p?.price?.reg_retail || null;

  const ship = p?.fulfillment?.shipping_options?.availability_status;
  const pickup = p?.fulfillment?.store_options?.[0]?.order_pickup?.availability_status;
  const inStock = isAvailable(ship) || isAvailable(pickup);

  return {
    in_stock: inStock,
    price,
    product_name: name,
    product_image_url: img,
    raw_status: fmtStatus(ship, pickup),
  };
}

function parseFulfillmentResponse(data: any, tcin: string): StockResult | null {
  const product = data?.data?.product;
  if (!product) return null;

  const name = product?.item?.product_description?.title || `Target Product ${tcin}`;
  const img = product?.item?.enrichment?.images?.primary_image_url || null;
  const price = product?.price?.current_retail || product?.price?.reg_retail || null;
  
  // Check multiple fulfillment paths
  const fulfillment = product?.fulfillment;
  const ship = fulfillment?.shipping_options?.availability_status;
  const pickup0 = fulfillment?.store_options?.[0]?.order_pickup?.availability_status;
  const pickups = fulfillment?.store_options?.map((s: any) => s?.order_pickup?.availability_status) || [];
  const deliveryStatus = fulfillment?.scheduled_delivery?.availability_status;
  
  // Also check is_out_of_stock_in_all_store_and_online flag
  const oosEverywhere = fulfillment?.is_out_of_stock_in_all_store_and_online;
  
  // Check product-level availability
  const productAvail = product?.availability_status;
  const isOnline = product?.is_buyable !== undefined ? product.is_buyable : undefined;
  
  const inStock = oosEverywhere === true ? false :
    isAvailable(ship) || pickups.some(isAvailable) || isAvailable(deliveryStatus) ||
    isAvailable(productAvail) || isOnline === true;

  const statusParts: string[] = [];
  if (ship) statusParts.push(`Ship: ${ship}`);
  if (pickup0) statusParts.push(`Pickup: ${pickup0}`);
  if (deliveryStatus) statusParts.push(`Delivery: ${deliveryStatus}`);
  if (productAvail) statusParts.push(`Product: ${productAvail}`);
  if (isOnline !== undefined) statusParts.push(`Buyable: ${isOnline}`);
  if (oosEverywhere !== undefined) statusParts.push(`OOS-All: ${oosEverywhere}`);

  // Log for debugging
  console.log(`[StockCheck] TCIN ${tcin}: fulfillment =`, JSON.stringify({
    ship, pickup0, deliveryStatus, productAvail, isOnline, oosEverywhere, inStock
  }));

  return {
    in_stock: inStock,
    price,
    product_name: name,
    product_image_url: img,
    raw_status: statusParts.join(" | ") || "Unknown",
  };
}

async function scrapeProductPage(url: string, tcin: string): Promise<StockResult | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": HEADERS["User-Agent"],
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return null;
    const html = await res.text();

    // Try __TGT_DATA__
    const tgtPatterns = [
      /__TGT_DATA__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/,
      /TGT_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/,
      /window\.__TGT_DATA__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/,
    ];

    for (const pattern of tgtPatterns) {
      const match = html.match(pattern);
      if (match) {
        try {
          const tgtData = JSON.parse(match[1]);
          const parsed = parseTgtData(tgtData, tcin);
          if (parsed) return parsed;
        } catch {}
      }
    }

    // Try JSON-LD
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (jsonLdMatch) {
      try {
        const ld = JSON.parse(jsonLdMatch[1]);
        if (ld["@type"] === "Product" || ld.name) {
          return {
            in_stock: ld.offers?.availability?.includes("InStock") || false,
            price: ld.offers?.price ? parseFloat(ld.offers.price) : null,
            product_name: ld.name || `Target Product ${tcin}`,
            product_image_url: ld.image || null,
            raw_status: `LD: ${ld.offers?.availability || "Unknown"}`,
          };
        }
      } catch {}
    }

    // Last resort: meta/title scrape
    const priceMatch = html.match(/data-test="product-price"[^>]*>\$?([\d.]+)/);
    const titleMatch = html.match(/<title>([^<]*)<\/title>/);
    const oosMatch = html.match(/out of stock|sold out|unavailable/i);

    if (priceMatch || titleMatch) {
      return {
        in_stock: !oosMatch,
        price: priceMatch ? parseFloat(priceMatch[1]) : null,
        product_name: titleMatch ? titleMatch[1].replace(/ : Target$/, "").trim() : `Target Product ${tcin}`,
        product_image_url: null,
        raw_status: `HTML: ${oosMatch ? "Out of Stock" : "Possibly Available"}`,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function parseTgtData(data: any, tcin: string): StockResult | null {
  try {
    const views = data?.__PRELOADED_QUERIES__?.queries || [];
    for (const query of views) {
      const product = query?.[1]?.data?.product || query?.[1]?.product;
      if (product) {
        const name = product?.item?.product_description?.title || `Target Product ${tcin}`;
        const img = product?.item?.enrichment?.images?.primary_image_url || null;
        const price = product?.price?.current_retail || product?.price?.reg_retail || null;
        const ship = product?.fulfillment?.shipping_options?.availability_status;
        const pickups = product?.fulfillment?.store_options?.map((s: any) => s?.order_pickup?.availability_status) || [];
        const inStock = isAvailable(ship) || pickups.some(isAvailable);
        return {
          in_stock: inStock,
          price,
          product_name: name,
          product_image_url: img,
          raw_status: fmtStatus(ship, pickups[0]) || "TGT_DATA",
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function isAvailable(status: string | undefined): boolean {
  if (!status) return false;
  const s = status.toUpperCase();
  return s === "IN_STOCK" || s === "LIMITED_STOCK" || s === "AVAILABLE" || 
         s === "PRE_ORDER" || s === "READY_WITHIN_2HRS" || s === "ONLINE_AVAILABLE";
}

function fmtStatus(ship?: string, pickup?: string): string {
  const parts: string[] = [];
  if (ship) parts.push(`Ship: ${ship}`);
  if (pickup) parts.push(`Pickup: ${pickup}`);
  return parts.join(" | ") || "Unknown";
}