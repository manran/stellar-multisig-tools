function stellarApiOrigin() {
  const value = process.env.STELLAR_API_ORIGIN?.trim().replace(/\/+$/, '');
  if (!value) {
    throw new Error('STELLAR_API_ORIGIN is required for the API gateway.');
  }

  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('STELLAR_API_ORIGIN must use HTTPS outside local development.');
  }

  return url.toString().replace(/\/$/, '');
}

/** @type {import('next').NextConfig} */
const config = {
  async rewrites() {
    const stellar = stellarApiOrigin();
    const upstreamOrigin = new URL(stellar).origin;

    return [
      {
        source: '/stellar/openapi.json',
        destination: `${upstreamOrigin}/openapi.json`,
      },
      {
        source: '/stellar',
        destination: stellar,
      },
      {
        source: '/stellar/:path*',
        destination: `${stellar}/:path*`,
      },
    ];
  },
};

export default config;
