// Base path the app is served under. Empty for local dev and root deployments; set to the repo
// name (e.g. "/gma1-patcher") for GitHub Pages via NEXT_PUBLIC_BASE_PATH at build time.
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
