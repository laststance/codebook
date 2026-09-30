import {
  bookPublishIntentSchema,
  type BookPublishIntent,
} from '../repositorySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'

/** Binds persisted retry keys to parsed authoring intent without instance-lifetime fields; used on publish and retained reads. @example bookIntentDigest(intent) */
export function bookIntentDigest(input: BookPublishIntent): string {
  return sha256(JSON.stringify(bookPublishIntentSchema.parse(input)))
}
