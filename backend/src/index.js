import { createPool } from '@weatherops/db';
import { createServer } from './app.js';

const port = Number(process.env.PORT ?? 3001);
const pool = createPool(process.env.DATABASE_URL);
createServer(pool).listen(port, () => console.log(`[backend] API ouvindo na porta ${port}`));
