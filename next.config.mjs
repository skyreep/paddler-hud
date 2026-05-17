/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Allow Next to revalidate fetch() calls server-side at the granular intervals we set in each route.
  },
  // Alpha-stage: don't block deploys on TS errors while we're iterating
  // fast. Re-enable once the API surface is stable.
  //
  // Note: Next 16 removed ESLint from `next build` entirely (and the
  // `eslint` key in next.config.* is no longer recognized). Lint now runs
  // as a separate `next lint` command — wire it into CI when we're ready
  // to enforce.
  typescript: {
    ignoreBuildErrors: true,
  },
};
export default nextConfig;
