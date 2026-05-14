/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Allow Next to revalidate fetch() calls server-side at the granular intervals we set in each route.
  },
};
export default nextConfig;
