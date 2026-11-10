import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Non-operational tables (normal mutable tables)
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name'),
  role: text('role').notNull().default('user'), // 'admin' | 'user'
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  passwordHash: text('password_hash'), // argon2 hash, set at creation / change-password
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // hashed session token
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const incidents = pgTable('incidents', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const incidentMembers = pgTable(
  'incident_members',
  {
    id: text('id').primaryKey(),
    incidentId: text('incident_id')
      .notNull()
      .references(() => incidents.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull().default('member'),
  },
  (t) => ({
    uniq: unique().on(t.incidentId, t.userId),
  }),
);

export const staffFunctions = pgTable('staff_functions', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id')
    .notNull()
    .references(() => incidents.id),
  name: text('name').notNull(),
});

export const functionMembers = pgTable(
  'function_members',
  {
    id: text('id').primaryKey(),
    functionId: text('function_id')
      .notNull()
      .references(() => staffFunctions.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => ({
    uniq: unique().on(t.functionId, t.userId),
  }),
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

export const authEvents = pgTable('auth_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // login | logout | failed_login | ...
  username: text('username').notNull(),
  ip: text('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Operational table: records — append-only versioned log
// ---------------------------------------------------------------------------

export const records = pgTable(
  'records',
  {
    id: text('id').primaryKey(), // uuidv7, generated on the client
    entityId: text('entity_id').notNull(), // stable id of the thing
    entityType: text('entity_type').notNull(),
    incidentId: text('incident_id').notNull(),
    parentIds: text('parent_ids').array().notNull().default([]), // record ids this version was based on
    functionId: text('function_id'), // owning staff function; null = incident-wide
    authorId: text('author_id').notNull(),
    deviceId: text('device_id').notNull(), // random id per browser profile
    hlc: text('hlc').notNull(), // hybrid logical clock, sortable string
    createdAtClient: timestamp('created_at_client', {
      withTimezone: true,
    }).notNull(), // ISO UTC
    kind: text('kind').notNull(), // 'put' | 'retract'
    schemaVersion: integer('schema_version').notNull(),
    payload: jsonb('payload').notNull(), // validated by entityType zod schema
    serverSeq: bigserial('server_seq', { mode: 'number' }).notNull(), // global pull order, server-assigned
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    incidentSeqIdx: index('records_incident_id_server_seq_idx').on(t.incidentId, t.serverSeq),
    incidentEntityIdx: index('records_incident_id_entity_id_idx').on(t.incidentId, t.entityId),
  }),
);
