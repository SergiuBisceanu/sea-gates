CREATE TABLE `watch_claims` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`rules_version` text NOT NULL,
	`phase` text NOT NULL,
	`hull` integer NOT NULL,
	`score` integer NOT NULL,
	`tide` integer NOT NULL,
	`moves_used` integer NOT NULL,
	`replay_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `day`),
	CONSTRAINT "watch_claims_terminal_phase" CHECK("watch_claims"."phase" in ('victory', 'defeat')),
	CONSTRAINT "watch_claims_nonnegative_result" CHECK("watch_claims"."hull" >= 0 and "watch_claims"."score" >= 0 and "watch_claims"."moves_used" >= 0 and "watch_claims"."tide" >= 1)
);
--> statement-breakpoint
CREATE INDEX `watch_claims_daily_results` ON `watch_claims` (`day`,`phase`,`hull`,`score`);