/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Allow Next to revalidate fetch() calls server-side at the granular intervals we set in each route.
  },
  // Alpha-stage: don't block deploys on lint/type warnings while we're
  // iterating fast. Re-enable both once the API surface is stable.
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};
export default nextConfig;
