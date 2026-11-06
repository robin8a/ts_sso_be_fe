import { defineAuth } from '@aws-amplify/backend';
import { preTokenGeneration } from './pre-token-generation/resource';
import { roleParameters } from './role-catalog';

/**
 * Central TerraSacha SSO auth resource.
 *
 * Owns the single shared Cognito user pool. Email login plus Hosted UI OAuth.
 * The localhost callback/logout URLs below belong to the sandbox client that
 * Amplify generates from `defineAuth`. Applications sign in with the dedicated
 * per-application app clients (Task 6), each with its own URLs.
 *
 * - email: true                         — Requirement 6.1
 * - externalProviders callback/logout   — Hosted UI OAuth (Requirement 1.3)
 * - custom:tsRoles (String, 0..2048)     — Requirement 4.1. mutable: true lets
 *   the admin assignment API (Task 7) write it via the pool. Per-client attribute
 *   permissions (read includes it, write omits it, so an end user cannot
 *   self-write the role) are enforced on each app client in backend.ts / Task 6
 *   using amplify/auth/client-attributes.ts.
 * - groups: roleParameters()            — one Cognito group per catalog role
 * - triggers.preTokenGeneration         — V2 claim builder (Task 5)
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
    externalProviders: {
      callbackUrls: ['http://localhost:3000/api/auth/callback'],
      logoutUrls: ['http://localhost:3000/'],
    },
  },
  userAttributes: {
    'custom:tsRoles': {
      dataType: 'String',
      mutable: true,
      minLen: 0,
      maxLen: 2048,
    },
  },
  groups: roleParameters(),
  triggers: {
    preTokenGeneration,
  },
});
