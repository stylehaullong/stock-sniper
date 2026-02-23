import { NextRequest, NextResponse } from "next/server";
import { Client } from "@upstash/qstash";
import { requireAuth } from "@/lib/auth/helpers";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/**
 * GET /api/cron/setup — View current schedules
 * POST /api/cron/setup — Create the stock check cron schedule
 * DELETE /api/cron/setup — Remove all schedules
 */

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const qstash = new Client({ token: process.env.QSTASH_TOKEN! });

  try {
    const schedules = await qstash.schedules.list();
    return NextResponse.json({
      schedules: schedules.map((s) => ({
        id: s.scheduleId,
        cron: s.cron,
        destination: s.destination,
        createdAt: s.createdAt,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  // Only allow admin-tier or premium users to set up cron
  // For now, allow anyone (you can lock this down later)

  const body = await request.json().catch(() => ({}));
  const cronExpression = body.cron || "* * * * *"; // Default: every minute

  const qstash = new Client({ token: process.env.QSTASH_TOKEN! });
  const destination = `${APP_URL}/api/cron/stock-check`;

  try {
    // Remove existing schedules for this endpoint first
    const existing = await qstash.schedules.list();
    for (const schedule of existing) {
      if (schedule.destination === destination) {
        await qstash.schedules.delete(schedule.scheduleId);
      }
    }

    // Create new schedule
    const result = await qstash.schedules.create({
      destination,
      cron: cronExpression,
      retries: 1,
    });

    return NextResponse.json({
      success: true,
      schedule_id: result.scheduleId,
      cron: cronExpression,
      destination,
      message: `Scheduler created: ${cronExpression}`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const qstash = new Client({ token: process.env.QSTASH_TOKEN! });

  try {
    const schedules = await qstash.schedules.list();
    let removed = 0;

    for (const schedule of schedules) {
      await qstash.schedules.delete(schedule.scheduleId);
      removed++;
    }

    return NextResponse.json({
      success: true,
      removed,
      message: `Removed ${removed} schedule(s)`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
