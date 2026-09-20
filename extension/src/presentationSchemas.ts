import { z } from 'zod';
import { PRESENTATION_MODE_IDS, PRESENTATION_PREFERENCE_VERSION } from './constants';

export const presentationModeSchema = z.enum(PRESENTATION_MODE_IDS);
export type PresentationMode = z.infer<typeof presentationModeSchema>;
export const presentationPreferenceSchema = z.strictObject({ version: z.literal(PRESENTATION_PREFERENCE_VERSION), mode: presentationModeSchema });
export const presentationCommandSchema = z.strictObject({
  instanceId: z.uuid(), presentationId: z.uuid(), expectedRevision: z.number().int().nonnegative(),
  mode: presentationModeSchema,
  action: z.enum(['select', 'restore', 'save-preference']).default('select'),
});
export type PresentationCommand = z.infer<typeof presentationCommandSchema>;
export type PresentationIntent = Omit<PresentationCommand, 'instanceId'>;
export interface PresentationState {
  presentationId: string;
  presentationControlRevision: number;
  mode: PresentationMode;
  requestedMode?: PresentationMode;
  state: 'closed' | 'open' | 'applying';
  layoutConfirmed: boolean;
  preference: { status: 'default' | 'saved' | 'saving' | 'failed' | 'unknown'; mode?: PresentationMode; reason?: string };
  reason?: string;
  playbackRevision?: number;
  panes: { appColumn?: number; sourceColumn?: number; contextColumn?: number };
}
