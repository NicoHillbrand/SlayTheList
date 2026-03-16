import { z } from "zod";

export const todoStatusSchema = z.enum(["active", "done"]);
export type TodoStatus = z.infer<typeof todoStatusSchema>;

export const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  context: z.string().optional(),
  status: todoStatusSchema,
  indent: z.number().int().nonnegative(),
  sortOrder: z.number().int().nonnegative(),
  deadlineAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Todo = z.infer<typeof todoSchema>;

export const habitCheckSchema = z.object({
  date: z.string(),
  done: z.boolean(),
});
export type HabitCheck = z.infer<typeof habitCheckSchema>;

export const habitStatusSchema = z.enum(["active", "archived", "idea"]);
export type HabitStatus = z.infer<typeof habitStatusSchema>;

export const habitSchema = z.object({
  id: z.string(),
  name: z.string(),
  checks: z.array(habitCheckSchema),
  createdAt: z.number(),
  status: habitStatusSchema.default("active"),
});
export type Habit = z.infer<typeof habitSchema>;

export const predictionOutcomeSchema = z.enum(["pending", "hit", "miss"]);
export type PredictionOutcome = z.infer<typeof predictionOutcomeSchema>;

export const predictionSchema = z.object({
  id: z.string(),
  title: z.string(),
  confidence: z.number().int().min(1).max(99),
  outcome: predictionOutcomeSchema,
  createdAt: z.number(),
  resolvedAt: z.number().nullable(),
});
export type Prediction = z.infer<typeof predictionSchema>;

export const reflectionEntrySchema = z.object({
  id: z.string(),
  date: z.string(),
  prompts: z
    .object({
      wins: z.string(),
      challenges: z.string(),
      learnings: z.string(),
      tomorrow: z.string(),
      gratitude: z.string(),
    })
    .catchall(z.string())
    .optional(),
  items: z.record(z.string(), z.array(z.string())).optional(),
  wins: z.string(),
  challenges: z.string(),
  notes: z.string(),
  tomorrow: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ReflectionEntry = z.infer<typeof reflectionEntrySchema>;

export const accountabilityStateSchema = z.object({
  habits: z.array(habitSchema),
  predictions: z.array(predictionSchema),
  reflections: z.array(reflectionEntrySchema),
});
export type AccountabilityState = z.infer<typeof accountabilityStateSchema>;

export const goldStateSchema = z.object({
  gold: z.number().int().nonnegative(),
  rewardedTodoIds: z.array(z.string()),
});
export type GoldState = z.infer<typeof goldStateSchema>;

export const lockZoneUnlockModeSchema = z.enum(["todos", "gold"]);
export type LockZoneUnlockMode = z.infer<typeof lockZoneUnlockModeSchema>;

export const lockZoneSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
  enabled: z.boolean(),
  unlockMode: lockZoneUnlockModeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LockZone = z.infer<typeof lockZoneSchema>;

export const lockZoneRequirementSchema = z.object({
  zoneId: z.string(),
  todoId: z.string(),
});
export type LockZoneRequirement = z.infer<typeof lockZoneRequirementSchema>;

export const lockZoneStateSchema = z.object({
  zone: lockZoneSchema,
  requiredTodoIds: z.array(z.string()),
  requiredTodoTitles: z.array(z.string()),
  goldUnlockActive: z.boolean(),
  isLocked: z.boolean(),
});
export type LockZoneState = z.infer<typeof lockZoneStateSchema>;

export const overlayStateSchema = z.object({
  gameWindow: z.object({
    titleHint: z.string(),
  }),
  zones: z.array(lockZoneStateSchema),
  lastUpdatedAt: z.string(),
});
export type OverlayState = z.infer<typeof overlayStateSchema>;

export const eventEnvelopeSchema = z.object({
  type: z.enum(["overlay_state", "health"]),
  payload: z.unknown(),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
