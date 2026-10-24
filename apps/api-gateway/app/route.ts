export const dynamic = 'force-static';

export function GET() {
  return Response.json({
    service: 'MultiSig Tools API',
    protocols: {
      stellar: {
        base: '/stellar',
        openapi: '/stellar/openapi.json',
      },
    },
  });
}
