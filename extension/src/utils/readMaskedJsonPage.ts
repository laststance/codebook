import type { ResourceContent } from '../resources'
import type { StudyService } from '../service'

import { readJsonPage } from './readJsonPage'

/**
 * Pages a JSON resource after masking the learner's secrets in the structured value, so no page boundary can split a secret and the content hash covers the bytes the agent receives.
 *
 * Why it exists: masking each page's text after slicing misses a secret that straddles two pages, masks identifiers inside the page string, and hashes unmasked bytes (ENG-4). Called by {@link readResource} for every paged JSON resource.
 * @param service - The service that knows the learner's secrets.
 * @param baseUri - The resource URI without a page suffix.
 * @param value - The unmasked structured value.
 * @param page - The page suffix a previous answer returned.
 * @returns The page, marked `masked` so the protocol layer does not mask its envelope again.
 * @throws What {@link readJsonPage} throws for a stale or invalid page.
 * @example
 * readMaskedJsonPage(service, 'codebook://runs/r1/x', { note: 'hunter2' }).masked // => true
 */
export function readMaskedJsonPage(
  service: StudyService,
  baseUri: string,
  value: unknown,
  page?: string,
): ResourceContent {
  const resource = readJsonPage(
    baseUri,
    service.maskLearnerSecretsInData(value),
    page,
  )
  return 'text' in resource ? { ...resource, masked: true } : resource
}
