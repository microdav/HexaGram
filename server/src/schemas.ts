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
    minDeg: z.number(),
    maxDeg: z.number(),
    invert: z.boolean(),
    zeroOffsetDeg: z.number(),
  })
);

const HexapodGeometrySchema = z.object({
  chassis: z.object({ length: z.number(), width: z.number(), height: z.number() }),
  segments: z.object({ coxa: z.number(), femur: z.number(), tibia: z.number() }),
  cog: z.object({ x: z.number(), y: z.number(), z: z.number() }),
});

const KeyframeSchema = z.object({
  id: z.string(),
  name: z.string(),
  pose: z.array(z.number()),
  createdAt: z.number(),
});

export const ProfileDataSchema = z.object({
  version: z.literal(1),
  geometry: HexapodGeometrySchema,
  keyframes: z.array(KeyframeSchema),
  prefs: z.object({
    mirrorEnabled: z.boolean(),
    gravityEnabled: z.boolean(),
    bodyTransparent: z.boolean(),
  }),
  servoCalibration: ServoCalibrationSchema.optional(),
});

export const CreateProfileSchema = z.object({
  name: z.string().min(1).max(80),
  data: ProfileDataSchema,
});

export const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  data: ProfileDataSchema.optional(),
});

export type SignupInput = z.infer<typeof SignupSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type ProfileData = z.infer<typeof ProfileDataSchema>;
export type CreateProfileInput = z.infer<typeof CreateProfileSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
