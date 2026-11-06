import { defineFunction } from '@aws-amplify/backend';

/**
 * Pre-token generation trigger (V2).
 *
 * `amplify/auth/resource.ts` wires this function as the `preTokenGeneration`
 * trigger. `handler.ts` implements the catalog-filtered claim builder that
 * overwrites `custom:tsRoles` on the ID and access tokens (Task 5).
 *
 * `defineAuth` registers it as the legacy (V1) trigger; `backend.ts` promotes
 * the pool's `preTokenGenerationConfig.lambdaVersion` to `V2_0` so the handler
 * runs under the V2 event shape and can customize the access token. The matching
 * handler type is `PreTokenGenerationV2TriggerHandler` from `aws-lambda`.
 */
export const preTokenGeneration = defineFunction({
  name: 'pre-token-generation',
  entry: './handler.ts',
});
