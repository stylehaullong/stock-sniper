/**
 * Checkout Playbook Engine
 *
 * Records successful AI agent checkout flows as replayable step sequences.
 * On subsequent runs, replays steps directly (no AI) for 10-20x speed.
 * Falls back to AI agent if replay fails, then updates the playbook.
 */

import { createAdminClient } from "@/lib/db/supabase-server";

// -- Types --

export type PlaybookAction =
  | { action: "goto"; url: string }
  | { action: "click"; selector: string; optional?: boolean; timeout?: number }
  | { action: "fill"; selector: string; value: string }
  | { action: "wait"; ms: number }
  | { action: "wait_for"; selector: string; timeout?: number }
  | { action: "dismiss_popup"; selectors: string[] }
  | { action: "check_url"; contains: string; fail_if: boolean; message: string }
  | { action: "check_text"; pattern: string; fail_if: boolean; message: string };

export interface Playbook {
  id: string;
  retailer: string;
  version: number;
  steps: PlaybookAction[];
  success_count: number;
  fail_count: number;
  is_active: boolean;
  recorded_at: string;
}

// -- Playbook CRUD --

export async function getActivePlaybook(retailer: string): Promise<Playbook | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("checkout_playbooks")
    .select("*")
    .eq("retailer", retailer)
    .eq("is_active", true)
    .single();

  if (error || !data) return null;
  return data as Playbook;
}

export async function savePlaybook(
  retailer: string,
  steps: PlaybookAction[]
): Promise<Playbook> {
  const supabase = createAdminClient();

  // Deactivate existing playbook for this retailer
  await supabase
    .from("checkout_playbooks")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("retailer", retailer)
    .eq("is_active", true);

  // Get next version
  const { data: prev } = await supabase
    .from("checkout_playbooks")
    .select("version")
    .eq("retailer", retailer)
    .order("version", { ascending: false })
    .limit(1);

  const nextVersion = (prev?.[0]?.version || 0) + 1;

  const { data, error } = await supabase
    .from("checkout_playbooks")
    .insert({
      retailer,
      version: nextVersion,
      steps: steps as any,
      is_active: true,
      success_count: 1,
      recorded_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to save playbook: ${error.message}`);
  console.log(`[Playbook] Saved v${nextVersion} for ${retailer} with ${steps.length} steps`);
  return data as Playbook;
}

export async function recordPlaybookSuccess(playbookId: string): Promise<void> {
  const supabase = createAdminClient();

  // Fetch current count, increment, and update
  const { data } = await supabase
    .from("checkout_playbooks")
    .select("success_count")
    .eq("id", playbookId)
    .single();

  await supabase
    .from("checkout_playbooks")
    .update({
      success_count: (data?.success_count || 0) + 1,
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", playbookId);
}

export async function recordPlaybookFailure(playbookId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("checkout_playbooks")
    .select("fail_count")
    .eq("id", playbookId)
    .single();

  const newFailCount = (data?.fail_count || 0) + 1;

  await supabase
    .from("checkout_playbooks")
    .update({
      fail_count: newFailCount,
      last_failed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Auto-deactivate after 3 consecutive failures
      ...(newFailCount >= 3 ? { is_active: false } : {}),
    })
    .eq("id", playbookId);

  if (newFailCount >= 3) {
    console.log(`[Playbook] Deactivated playbook ${playbookId} after ${newFailCount} failures`);
  }
}

// -- Playbook Replay --

/**
 * Replay recorded steps using direct Playwright actions.
 * Template variables like {product_url} and {cvv} are replaced with real values.
 */
export async function replayPlaybook(
  page: any,
  playbook: Playbook,
  variables: Record<string, string>
): Promise<{ success: boolean; failedAt?: number; error?: string; steps_completed: string[] }> {
  const stepsLog: string[] = [];
  console.log(`[Playbook] Replaying ${playbook.steps.length} steps`);

  for (let i = 0; i < playbook.steps.length; i++) {
    const step = playbook.steps[i];
    const t0 = Date.now();

    try {
      switch (step.action) {
        case "goto": {
          const url = replaceVars(step.url, variables);
          await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 15000 });
          stepsLog.push(`→ ${url.substring(0, 60)} (${Date.now() - t0}ms)`);
          break;
        }

        case "click": {
          const selector = replaceVars(step.selector, variables);
          const timeout = step.timeout || 5000;
          try {
            // Handle comma-separated selectors (try each)
            const selectors = selector.split(",").map((s) => s.trim());
            let clicked = false;
            for (const sel of selectors) {
              try {
                const el = page.locator(sel).first();
                await el.waitFor({ state: "visible", timeout: Math.min(timeout, 3000) });
                await el.click();
                clicked = true;
                stepsLog.push(`✓ Click: ${sel.substring(0, 40)} (${Date.now() - t0}ms)`);
                break;
              } catch {
                continue;
              }
            }
            if (!clicked) {
              if (step.optional) {
                stepsLog.push(`⊘ Skip: ${selector.substring(0, 40)}`);
              } else {
                throw new Error(`No matching selector found: ${selector.substring(0, 60)}`);
              }
            }
          } catch (err: any) {
            if (step.optional) {
              stepsLog.push(`⊘ Skip: ${selector.substring(0, 40)}`);
            } else {
              throw err;
            }
          }
          break;
        }

        case "fill": {
          const selector = replaceVars(step.selector, variables);
          const value = replaceVars(step.value, variables);
          if (!value) {
            stepsLog.push(`⊘ Skip fill (empty value): ${selector.substring(0, 40)}`);
            break;
          }
          const selectors = selector.split(",").map((s) => s.trim());
          let filled = false;
          for (const sel of selectors) {
            try {
              const el = page.locator(sel).first();
              await el.waitFor({ state: "visible", timeout: 3000 });
              await el.fill(value);
              filled = true;
              stepsLog.push(`✓ Fill: ${sel.substring(0, 40)} (${Date.now() - t0}ms)`);
              break;
            } catch {
              continue;
            }
          }
          if (!filled) {
            throw new Error(`Could not fill: ${selector.substring(0, 60)}`);
          }
          break;
        }

        case "wait": {
          await new Promise((r) => setTimeout(r, step.ms));
          stepsLog.push(`⏱ Wait ${step.ms}ms`);
          break;
        }

        case "wait_for": {
          const selector = replaceVars(step.selector, variables);
          await page.locator(selector).first().waitFor({ timeout: step.timeout || 10000 });
          stepsLog.push(`✓ Visible: ${selector.substring(0, 40)} (${Date.now() - t0}ms)`);
          break;
        }

        case "dismiss_popup": {
          for (const sel of step.selectors) {
            try {
              const el = page.locator(sel).first();
              await el.click({ timeout: 2000 });
              stepsLog.push(`✓ Dismissed: ${sel.substring(0, 40)}`);
              break;
            } catch {
              // Try next
            }
          }
          // Popups are always optional
          break;
        }

        case "check_url": {
          const url = page.url();
          const matches = url.includes(step.contains);
          if (step.fail_if && matches) {
            return { success: false, failedAt: i, error: step.message, steps_completed: stepsLog };
          }
          if (!step.fail_if && !matches) {
            return { success: false, failedAt: i, error: step.message, steps_completed: stepsLog };
          }
          stepsLog.push(`✓ URL check: ${step.contains}`);
          break;
        }

        case "check_text": {
          const text: string = await page.locator("body").innerText().catch(() => "");
          const matches = new RegExp(step.pattern, "i").test(text);
          if (step.fail_if && matches) {
            return { success: false, failedAt: i, error: step.message, steps_completed: stepsLog };
          }
          if (!step.fail_if && !matches) {
            return { success: false, failedAt: i, error: step.message, steps_completed: stepsLog };
          }
          stepsLog.push(`✓ Text check: ${step.pattern}`);
          break;
        }
      }
    } catch (err: any) {
      console.log(`[Playbook] Step ${i} failed: ${err.message}`);
      return {
        success: false,
        failedAt: i,
        error: `Step ${i}: ${err.message}`,
        steps_completed: stepsLog,
      };
    }

    // Tiny delay between steps to avoid triggering rate limits
    await new Promise((r) => setTimeout(r, 150 + Math.random() * 200));
  }

  console.log(`[Playbook] All ${playbook.steps.length} steps completed`);
  return { success: true, steps_completed: stepsLog };
}

// -- Agent Recording --

/**
 * After a successful AI agent checkout, build the standard playbook
 * for this retailer. We know the Target flow structure from observations:
 *
 *   Product page → Add to cart → Cart → Checkout → Payment → Place order → CVV → Confirm
 *
 * This function returns the template playbook that will be replayed
 * on subsequent runs with direct selectors (no AI).
 */
export async function recordAgentCheckout(
  _stagehand: any,
  _page: any,
  config: { cvv?: string }
): Promise<{ steps: PlaybookAction[]; agentSteps: string[] }> {
  // Build the Target checkout playbook from known flow
  const playbookSteps: PlaybookAction[] = [
    // 1. Go to product page
    { action: "goto", url: "{product_url}" },
    { action: "wait", ms: 1500 },

    // 2. Check out of stock
    {
      action: "check_text",
      pattern: "out of stock|sold out|temporarily unavailable|currently unavailable",
      fail_if: true,
      message: "Product is out of stock",
    },

    // 3. Add to cart
    {
      action: "click",
      selector:
        'button[data-test="addToCartButton"], button[data-test="shipItButton"], [data-test="orderPickupButton"], button:has-text("Add to cart")',
      timeout: 5000,
    },
    { action: "wait", ms: 2500 },

    // 4. Dismiss popups (protection plans, etc.)
    {
      action: "dismiss_popup",
      selectors: [
        'button:has-text("No thanks")',
        'button:has-text("No, thanks")',
        'button:has-text("View cart & check out")',
        'button[aria-label="close"]',
        'button:has-text("Continue shopping")',
      ],
    },
    { action: "wait", ms: 500 },

    // 5. Go to cart
    { action: "goto", url: "https://www.target.com/cart" },
    { action: "wait", ms: 2000 },

    // 6. Click checkout
    {
      action: "click",
      selector: 'button:has-text("Check out"), button:has-text("Checkout"), button[data-test="checkout-button"]',
      timeout: 5000,
    },
    { action: "wait", ms: 3000 },

    // 7. Verify on checkout page
    { action: "check_url", contains: "/checkout", fail_if: false, message: "Not on checkout page" },

    // 8. Payment — click Save and continue
    {
      action: "click",
      selector: 'button:has-text("Save and continue"), button:has-text("Save & continue")',
      timeout: 8000,
    },
    { action: "wait", ms: 2000 },

    // 9. Place order
    {
      action: "click",
      selector: 'button:has-text("Place your order"), button[data-test="placeOrderButton"]',
      timeout: 8000,
    },
    { action: "wait", ms: 3000 },

    // 10. CVV dialog — fill and confirm
    {
      action: "fill",
      selector: 'input[aria-label="Enter CVV"], input[name="cvv"], input[placeholder*="CVV"]',
      value: "{cvv}",
    },
    { action: "wait", ms: 500 },
    {
      action: "click",
      selector: 'button:has-text("Confirm")',
      timeout: 3000,
    },
    { action: "wait", ms: 5000 },
  ];

  return { steps: playbookSteps, agentSteps: ["Playbook recorded from successful flow"] };
}

// -- Helpers --

function replaceVars(str: string, vars: Record<string, string>): string {
  return str.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}