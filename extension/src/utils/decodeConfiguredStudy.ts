import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { CONFIGURED_CAPTURE_PHASES, IMAGE_LIMIT_BYTES } from '../constants';
import { configuredStudySchema, type ConfiguredStudy } from '../configuredStudySchemas';
import { validateConfiguredStudyEvidence } from './validateConfiguredStudyEvidence';

/** Validates configured history for storage/replay without consulting current files or granting live pause authority. @example decodeConfiguredStudy(archive, workspaceKey).profile // 'repository-browser' */
export function decodeConfiguredStudy(value: unknown, workspaceKey: string): ConfiguredStudy {
  const study = configuredStudySchema.parse(value);
  validateConfiguredStudyEvidence(study, workspaceKey);
  if (!study.descriptor && study.captures.length) throw new Error('Configured evidence has no bound descriptor.');
  const phases = new Set<string>();
  for (const capture of study.captures) {
    if (phases.has(capture.phase)) throw new Error('Configured study has duplicate image phases.');
    phases.add(capture.phase);
    if (capture.status !== 'captured') continue;
    const bytes = Buffer.from(capture.base64, 'base64');
    if (bytes.length > IMAGE_LIMIT_BYTES || bytes.toString('base64') !== capture.base64 || sha256(bytes) !== capture.hash) throw new Error('Configured captured image changed.');
  }
  // Archive success retains all images; recording contexts reference their independently verified journal instead.
  if (study.finalOutcome === 'demonstrated' && (study.captures.length !== CONFIGURED_CAPTURE_PHASES.length || study.captures.some(capture => capture.status !== 'captured'))) throw new Error('Configured completed study is missing required evidence.');
  return study;
}
