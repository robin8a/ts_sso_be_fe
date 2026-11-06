import { a, defineData, type ClientSchema } from '@aws-amplify/backend';

/**
 * SSO data schemas.
 *
 * The SSO backend owns the user pool; its data layer is intentionally minimal
 * at this stage. This schema is a valid Gen 2 data resource placeholder so that
 * `amplify/backend.ts` can include `data` and the backend builds. Future tasks
 * (for example admin role-assignment surfaces) extend this schema as needed.
 *
 * Default authorization mode is the user pool so only authenticated SSO users
 * can reach any future SSO-owned data.
 */
const schema = a.schema({
  // Placeholder model; replaced/extended by later SSO data work.
  SsoMeta: a
    .model({
      key: a.string().required(),
      value: a.string(),
    })
    .authorization((allow) => [allow.authenticated()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
