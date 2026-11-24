import { connection, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  await connection();
  try {
    await query("SELECT 1");
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error(
      "Healthcheck de PostgreSQL falló:",
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
