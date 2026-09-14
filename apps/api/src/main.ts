import { buildApp } from './app';

const port = Number(process.env['API_PORT'] ?? 3001);
const fixed = process.env['CDEVI_FIXED_NOW'];
const now = fixed ? () => new Date(fixed) : () => new Date();

buildApp({
  now,
  rateLimit: { signInMax: Number(process.env['CDEVI_SIGNIN_RATE_MAX'] ?? 5) },
})
  .then((app) => app.listen({ port, host: '0.0.0.0' }))
  .then((addr) => console.log(`api listening on ${addr}`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
