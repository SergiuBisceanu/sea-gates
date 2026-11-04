import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Identity comes exclusively from the hosted authentication boundary. No email
// address or real name is needed to keep a player's progress.
export const watchClaims = sqliteTable("watch_claims", {
  userId: text("user_id").notNull(),
  day: text("day").notNull(),
  rulesVersion: text("rules_version").notNull(),
  phase: text("phase", { enum: ["victory", "defeat"] }).notNull(),
  hull: integer("hull").notNull(),
  score: integer("score").notNull(),
  tide: integer("tide").notNull(),
  movesUsed: integer("moves_used").notNull(),
  replayJson: text("replay_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.day] }),
  index("watch_claims_daily_results").on(table.day, table.phase, table.hull, table.score),
  check("watch_claims_terminal_phase", sql`${table.phase} in ('victory', 'defeat')`),
  check("watch_claims_nonnegative_result", sql`${table.hull} >= 0 and ${table.score} >= 0 and ${table.movesUsed} >= 0 and ${table.tide} >= 1`),
]);
