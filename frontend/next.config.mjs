const backend = process.env.BACKEND_URL || 'http://localhost:3001';

/** O navegador só fala com /api/* na própria origem; o Next repassa ao backend. */
export default {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }];
  },
};
