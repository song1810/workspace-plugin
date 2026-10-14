import type { ExpertDefinition } from 'workspace-contracts';

/**
 * Shipped default experts.
 *
 * This clean distribution ships none: the local catalog starts empty, so every
 * expert is authored by the user through the ordinary draft → confirm → publish
 * path. The export stays so the seeding call sites remain uniform and a future
 * distribution can supply templates without touching the manager.
 */
export interface DefaultTemplate {
  readonly id: string;
  readonly definition: ExpertDefinition;
}

export const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = []
