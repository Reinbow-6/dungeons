import type {
  AdventurePack,
  Character,
  GameState,
  GameStateDelta,
} from "@dungeons/rules";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const rulesetProfileEnum = pgEnum("ruleset_profile", [
  "5e-lite",
  "5e-full",
]);

export const eventSourceEnum = pgEnum("event_source", [
  "engine",
  "player-declared",
  "imported",
]);

export const eventVisibilityEnum = pgEnum("event_visibility", [
  "public",
  "owner-only",
  "dm-only",
]);

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
]);

export const campaigns = pgTable("campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerGuestId: text("owner_guest_id").notNull(),
  title: text("title").notNull(),
  adventureId: text("adventure_id").notNull().default("aguas-quietas"),
  ruleset: rulesetProfileEnum("ruleset").notNull().default("5e-lite"),
  worldSummary: text("world_summary").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    sessionNumber: integer("session_number").notNull().default(1),
    summary: text("summary").notNull().default(""),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    index("sessions_campaign_number_idx").on(
      table.campaignId,
      table.sessionNumber,
    ),
  ],
);

export const characters = pgTable("characters", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull(),
  ownerGuestId: text("owner_guest_id").notNull(),
  name: text("name").notNull(),
  sheet: jsonb("sheet").$type<Character>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const campaignMembers = pgTable(
  "campaign_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    guestId: text("guest_id").notNull(),
    userId: text("user_id"),
    characterId: uuid("character_id").references(() => characters.id, {
      onDelete: "set null",
    }),
    role: text("role").notNull().default("player"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("campaign_members_campaign_guest_idx").on(
      table.campaignId,
      table.guestId,
    ),
    index("campaign_members_guest_idx").on(table.guestId),
  ],
);

export const eventLog = pgTable(
  "event_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),

    type: text("type").notNull(),
    source: eventSourceEnum("source").notNull(),
    visibility: eventVisibilityEnum("visibility").notNull().default("public"),

    actor: text("actor").notNull(),
    checkId: text("check_id"),
    declaredTotal: integer("declared_total"),
    dieResults: jsonb("die_results").$type<number[] | null>(),

    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    stateDelta: jsonb("state_delta").$type<GameStateDelta>().notNull(),

    revertedByEventId: uuid("reverted_by_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("event_log_campaign_seq_idx").on(table.campaignId, table.seq),
  ],
);

export const gameStateSnapshots = pgTable(
  "game_state_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    lastSeq: integer("last_seq").notNull().default(0),
    sceneId: text("scene_id").notNull(),
    state: jsonb("state").$type<GameState>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("game_state_snapshots_campaign_idx").on(table.campaignId),
  ],
);

export const memoryFacts = pgTable(
  "memory_facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    category: text("category").notNull(),
    content: text("content").notNull(),
    importance: integer("importance").notNull().default(5),
    eventSeq: integer("event_seq").notNull().default(0),
    revertedBySeq: integer("reverted_by_seq"),
    source: text("source").notNull().default("engine"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("memory_facts_campaign_seq_idx").on(
      table.campaignId,
      table.eventSeq,
    ),
  ],
);

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => sessions.id, {
    onDelete: "set null",
  }),
  role: messageRoleEnum("role").notNull(),
  parts: jsonb("parts").$type<unknown[]>().notNull(),
  eventSeq: integer("event_seq"),
  revertedBySeq: integer("reverted_by_seq"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const guestUsage = pgTable(
  "guest_usage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    guestId: text("guest_id").notNull(),
    dayKey: text("day_key").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    estimatedTokens: integer("estimated_tokens").notNull().default(0),
    estimatedCostMicros: integer("estimated_cost_micros").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("guest_usage_day_idx").on(table.guestId, table.dayKey),
  ],
);

export const providerHealth = pgTable(
  "provider_health",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    dayKey: text("day_key").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    totalLatencyMs: integer("total_latency_ms").notNull().default(0),
    promptTokens: bigint("prompt_tokens", { mode: "number" })
      .notNull()
      .default(0),
    completionTokens: bigint("completion_tokens", { mode: "number" })
      .notNull()
      .default(0),
    cachedTokens: bigint("cached_tokens", { mode: "number" })
      .notNull()
      .default(0),
    lastErrorCode: text("last_error_code"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("provider_health_day_idx").on(
      table.provider,
      table.modelId,
      table.dayKey,
    ),
  ],
);

export const modelUsage = pgTable(
  "model_usage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    guestId: text("guest_id").notNull(),
    userId: text("user_id"),
    accessTier: text("access_tier").notNull().default("guest"),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    dayKey: text("day_key").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    promptTokens: bigint("prompt_tokens", { mode: "number" })
      .notNull()
      .default(0),
    completionTokens: bigint("completion_tokens", { mode: "number" })
      .notNull()
      .default(0),
    cachedTokens: bigint("cached_tokens", { mode: "number" })
      .notNull()
      .default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("model_usage_guest_model_day_idx").on(
      table.guestId,
      table.provider,
      table.modelId,
      table.dayKey,
    ),
    index("model_usage_day_idx").on(table.dayKey),
  ],
);

export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bucketKey: text("bucket_key").notNull(),
    windowStart: integer("window_start").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("rate_limit_bucket_window_idx").on(
      table.bucketKey,
      table.windowStart,
    ),
  ],
);

export const adventurePacks = pgTable(
  "adventure_packs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerGuestId: text("owner_guest_id").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    rulesetRecommended: rulesetProfileEnum("ruleset_recommended")
      .notNull()
      .default("5e-full"),
    pack: jsonb("pack").$type<AdventurePack>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("adventure_packs_owner_slug_idx").on(
      table.ownerGuestId,
      table.slug,
    ),
    index("adventure_packs_owner_updated_idx").on(
      table.ownerGuestId,
      table.updatedAt,
    ),
  ],
);
