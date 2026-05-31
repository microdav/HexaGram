import { z } from "zod";

export const SignupSchema = z.object({
  login: z.string().min(6).max(40),
  password: z.string().min(6).max(100),
  country: z.string().max(80).optional(),
  avatarSeed: z.string().min(1).max(20),
});

export const LoginSchema = z.object({
  login: z.string(),
  password: z.string(),
});

const ServoCalibrationSchema = z.record(
  z.object({
    zeroOffsetDeg: z.number(),
    hardMinDeg: z.number().optional(),
    hardMaxDeg: z.number().optional(),
    softMinDeg: z.number().optional(),
    softMaxDeg: z.number().optional(),
    minDeg: z.number().optional(),
    maxDeg: z.number().optional(),
    invert: z.boolean(),
  })
);

const HexapodGeometrySchema = z.object({
  chassis: z.object({ length: z.number(), width: z.number(), height: z.number() }),
  segments: z.object({ coxa: z.number(), femur: z.number(), tibia: z.number() }),
  cog: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  legLayout: z.enum(["star", "linear"]).optional(),
});

const KeyframeSchema = z.object({
  id: z.string(),
  name: z.string(),
  pose: z.array(z.number()),
  createdAt: z.number(),
});

const ToolboxConfigSchema = z.object({
  panel: z.enum(["left", "right"]).nullable(),
  order: z.number(),
  minimized: z.boolean(),
  floatPos: z.object({ x: z.number(), y: z.number() }),
});

const CollisionPrefsSchema = z.object({
  enabled: z.boolean().optional(),
  includeBody: z.boolean().optional(),
  showArrow: z.boolean().optional(),
});

const WeightConfigSchema = z.object({
  emptyWeightG: z.number().optional(),
  totalWeightG: z.number().optional(),
});

const ElectronicsConfigSchema = z.object({
  servoControllerId: z.string().optional(),
  commandElectronicsId: z.string().optional(),
});

export const ProfileDataSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  description: z.string().optional(),
  // Champs legacy (v1) — encore acceptés mais ignorés au niveau projet désormais
  globalServoTypeId: z.string().nullable().optional(),
  geometry: HexapodGeometrySchema,
  keyframes: z.array(KeyframeSchema),
  prefs: z.object({
    mirrorEnabled: z.boolean(),
    gravityEnabled: z.boolean(),
    bodyTransparent: z.boolean(),
    cogAxisLock: z.object({ x: z.boolean(), y: z.boolean(), z: z.boolean() }).optional(),
    collisionPrefs: CollisionPrefsSchema.optional(),
  }),
  servoCalibration: ServoCalibrationSchema.optional(),
  toolboxLayout: z.record(ToolboxConfigSchema).optional(),
  uiPrefs: z.object({
    leftOpen: z.boolean(),
    rightOpen: z.boolean(),
    sequencerOpen: z.boolean(),
  }).optional(),
  weightConfig: WeightConfigSchema.optional(),
  electronics: ElectronicsConfigSchema.optional(),
});

export const CreateProfileSchema = z.object({
  name: z.string().min(1).max(80),
  data: ProfileDataSchema,
});

export const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  data: ProfileDataSchema.optional(),
});

const SequencerStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  pose: z.array(z.number()),
  type: z.string().optional(),
  sourcePoseId: z.string().nullable().optional(),
  /** Vignette PNG pré-générée (dataURL). Optionnelle. */
  thumbnail: z.string().nullable().optional(),
  /** Empreinte du contexte de rendu utilisé pour générer la vignette. */
  thumbnailContext: z.string().nullable().optional(),
});

export const CreateSequenceSchema = z.object({
  name: z.string().min(1).max(80),
  steps: z.array(SequencerStepSchema),
});

export const UpdateSequenceSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  steps: z.array(SequencerStepSchema).optional(),
});

export type SignupInput = z.infer<typeof SignupSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type ProfileData = z.infer<typeof ProfileDataSchema>;
export type CreateProfileInput = z.infer<typeof CreateProfileSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
export type CreateSequenceInput = z.infer<typeof CreateSequenceSchema>;
export type UpdateSequenceInput = z.infer<typeof UpdateSequenceSchema>;

// ── Poses ────────────────────────────────────────────────────────────────────

export const CreatePoseSchema = z.object({
  name: z.string().min(1).max(80),
  angles: z.array(z.number()),
  profileId: z.string().nullable().optional(),
  position: z.number().int().nonnegative().optional(),
  thumbnail: z.string().nullable().optional(),
  thumbnailContext: z.string().nullable().optional(),
});

export const UpdatePoseSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  angles: z.array(z.number()).optional(),
  position: z.number().int().nonnegative().optional(),
  thumbnail: z.string().nullable().optional(),
  thumbnailContext: z.string().nullable().optional(),
});

export const ReorderPosesSchema = z.object({
  order: z.array(z.string()),
});

export const PropagatePoseSchema = z.object({
  angles: z.array(z.number()),
});

export type CreatePoseInput = z.infer<typeof CreatePoseSchema>;
export type UpdatePoseInput = z.infer<typeof UpdatePoseSchema>;

// ── Programs ─────────────────────────────────────────────────────────────────

const ProgramStepRefSchema = z.object({
  id: z.string(),
  type: z.literal('ref'),
  sequenceId: z.string(),
  sequenceName: z.string(),
});

const ProgramStepInlineSchema = z.object({
  id: z.string(),
  type: z.literal('inline'),
  name: z.string(),
  steps: z.array(z.object({
    id: z.string(),
    name: z.string(),
    pose: z.array(z.number()),
    type: z.string().optional(),
  })),
});

const ProgramStepSchema = z.discriminatedUnion('type', [
  ProgramStepRefSchema,
  ProgramStepInlineSchema,
]);

const LoopTargetSchema = z.union([
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('init') }),
  z.object({ type: z.literal('step'), stepId: z.string() }),
]);

const ProgramDataSchema = z.object({
  initPose: z.array(z.number()).nullable(),
  initPoseName: z.string(),
  steps: z.array(ProgramStepSchema),
  loop: LoopTargetSchema,
});

export const CreateProgramSchema = z.object({
  name: z.string().min(1).max(80),
  profileId: z.string(),
  initPose: z.array(z.number()).nullable(),
  initPoseName: z.string(),
  steps: z.array(ProgramStepSchema),
  loop: LoopTargetSchema,
});

export const UpdateProgramSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  profileId: z.string().optional(),
  initPose: z.array(z.number()).nullable().optional(),
  initPoseName: z.string().optional(),
  steps: z.array(ProgramStepSchema).optional(),
  loop: LoopTargetSchema.optional(),
});

export type ProgramData = z.infer<typeof ProgramDataSchema>;
export type CreateProgramInput = z.infer<typeof CreateProgramSchema>;
export type UpdateProgramInput = z.infer<typeof UpdateProgramSchema>;

// ── Projects ─────────────────────────────────────────────────────────────────

const ServoSpecSchema = z.object({
  id: z.string(),
  brand: z.string(),
  model: z.string(),
  torqueKgCm: z.object({ v6: z.number().optional(), v7_4: z.number().optional(), v8_4: z.number().optional() }),
  speedS60: z.object({ v6: z.number().optional(), v7_4: z.number().optional(), v8_4: z.number().optional() }),
  voltageRange: z.tuple([z.number(), z.number()]),
  currentMa: z.object({ idle: z.number(), stall: z.number() }),
  weightG: z.number(),
  dimensionsMm: z.object({ l: z.number(), w: z.number(), h: z.number() }),
  pulseUs: z.object({ min: z.number(), center: z.number(), max: z.number() }),
  deadbandUs: z.number(),
  gearType: z.enum(["plastic", "metal", "titanium"]),
  bearing: z.enum(["plain", "ball", "dual-ball"]),
  connector: z.enum(["JR", "Futaba", "Hitec", "BUS"]),
  notes: z.string().optional(),
  custom: z.boolean().optional(),
});

export const ServoBindingSchema = z.object({
  channel: z.number().int().nullable(),
  centerOffsetDeg: z.number(),
  invert: z.boolean(),
});

export const ProjectElectronicsSchema = z.object({
  serial: z.object({ baudRate: z.number().int().positive() }),
  bindings: z.record(z.string(), ServoBindingSchema),
});

export const PowerRailSchema = z.object({
  enabled: z.boolean(),
  kind: z.enum(["battery", "bench", "usb"]).optional(),
  source: z.string().max(120),
  voltageV: z.number().nullable(),
  capacityMah: z.number().nullable(),
  maxCurrentA: z.number().nullable().optional(),
});

export const ProjectPowerSchema = z.object({
  servo: PowerRailSchema,
  servoLogicShared: z.boolean(),
  command: PowerRailSchema,
});

export const ProjectPeripheralSchema = z.object({
  uid: z.string(),
  specId: z.string(),
  label: z.string().nullable().optional(),
  placement: z.enum(["above", "below"]).optional(),
  note: z.string().nullable().optional(),
});

export const ProjectHardwareSchema = z.object({
  servoTypeId: z.string().nullable().optional(),
  servoControllerId: z.string().nullable().optional(),
  commandElectronicsId: z.string().nullable().optional(),
  customServoTypes: z.array(ServoSpecSchema).optional(),
  electronics: ProjectElectronicsSchema.optional(),
  power: ProjectPowerSchema.optional(),
  commandEnabled: z.boolean().optional(),
  peripherals: z.array(ProjectPeripheralSchema).optional(),
}).passthrough();

export const ProjectPreferencesSchema = z.object({
  /** Direction caméra (vecteur regard→caméra normalisé) pour les vignettes du séquenceur. */
  photoSpaceViewDirection: z.tuple([z.number(), z.number(), z.number()]).optional(),
  /** Position de départ du robot dans la salle d'exécution (au sol, X/Z en mètres). */
  roomStartPos: z.object({ x: z.number(), z: z.number() }).optional(),
});

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  hardware: ProjectHardwareSchema.optional(),
  preferences: ProjectPreferencesSchema.optional(),
});

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  hardware: ProjectHardwareSchema.optional(),
  preferences: ProjectPreferencesSchema.optional(),
});

export const ImportProjectSchema = z.object({
  sourceProjectId: z.string().min(1),
  profileIds: z.array(z.string()).optional(),
  sequenceIds: z.array(z.string()).optional(),
  programIds: z.array(z.string()).optional(),
});

export type ProjectHardware = z.infer<typeof ProjectHardwareSchema>;
export type ProjectPreferences = z.infer<typeof ProjectPreferencesSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
export type ImportProjectInput = z.infer<typeof ImportProjectSchema>;
