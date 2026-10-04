// Small typed helpers for the settings page: every call goes through the validated service-worker gate.
import { z } from 'zod';
import { deepStatusSchema, pipelineStatusSchema } from '../../shared/messages';
import { settingsSchema, type Settings, type SettingsPatch } from '../../background/pipeline/state';

export type DeepStatus = z.infer<typeof deepStatusSchema>;
export type PipelineView = z.infer<typeof pipelineStatusSchema>;

async function ask<S extends z.ZodType>(message: object, schema: S): Promise<z.infer<S>> {
  const raw: unknown = await chrome.runtime.sendMessage(message);
  const envelope = z.object({ ok: z.boolean() }).safeParse(raw);
  if (envelope.success && !envelope.data.ok) throw new Error(JSON.stringify((raw as { error?: unknown }).error ?? 'failed'));
  const parsed = schema.safeParse((raw as { data?: unknown } | null)?.data);
  if (!parsed.success) throw new Error('unexpected response');
  return parsed.data;
}

export const getSettings = () => ask({ type: 'sw/settings-get' }, settingsSchema);
export const setSettings = (patch: SettingsPatch): Promise<Settings> => ask({ type: 'sw/settings-set', patch }, settingsSchema);
export const getPipeline = () => ask({ type: 'sw/pipeline-status' }, pipelineStatusSchema);
export const getDeep = () => ask({ type: 'sw/deep-status' }, deepStatusSchema);
export const deepCommand = (message: object) => ask(message, deepStatusSchema);

export const mb = (bytes: number): string => (bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0);
export const dayStart = (isoDate: string): number => new Date(`${isoDate}T00:00:00`).getTime();
