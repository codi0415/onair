/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.mzstatic.com" }, // iTunes/Apple 앨범아트
      { protocol: "https", hostname: "*.dzcdn.net" }, // Deezer 앨범아트
    ],
  },
};

module.exports = nextConfig;
