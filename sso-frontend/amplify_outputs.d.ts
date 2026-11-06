// Ambient declaration so TypeScript accepts the dynamic import of the generated
// `amplify_outputs.json` before the file exists. The real file is produced by
// `ampx sandbox`/`ampx generate outputs` from sso-backend and is git-ignored.
declare module '*/amplify_outputs.json' {
  const outputs: Record<string, unknown>;
  export default outputs;
}
