const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.INTERNAL_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function cleanup() {
  try {
    // Ver estado antes de limpiar
    const before = await pool.query(`
      SELECT state, count(*) as total
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND usename = current_user
        AND pid <> pg_backend_pid()
      GROUP BY state
    `);

    // Terminar conexiones idle del usuario actual
    const result = await pool.query(`
      SELECT 
        pg_terminate_backend(pid) as terminated,
        pid,
        usename,
        application_name,
        state,
        round(extract(epoch from (now() - state_change))) as idle_seconds
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND state = 'idle'
        AND state_change < now() - interval '2 minutes'  -- Solo idle > 2 minutos
        AND usename = current_user
        AND pid <> pg_backend_pid()
    `);

    // Ver estado después
    const after = await pool.query(`
      SELECT count(*) as remaining
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND usename = current_user
        AND pid <> pg_backend_pid()
    `);

    const whoami = await pool.query("SELECT current_user");

    console.log(`[${new Date().toISOString()}] Cleanup ejecutado:`);
    console.log(`  - Usuario: ${whoami.rows[0].current_user}`);
    console.log(`  - Antes: ${JSON.stringify(before.rows)}`);
    console.log(`  - Terminadas: ${result.rows.length} conexiones`);
    console.log(`  - Restantes: ${after.rows[0].remaining}`);

    if (result.rows.length > 0) {
      console.log(`  - Detalles de conexiones terminadas:`);
      result.rows.forEach((conn) => {
        console.log(
          `    PID ${conn.pid}: idle ${conn.idle_seconds}s, app: ${
            conn.application_name || "N/A"
          }`
        );
      });
    }
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error en cleanup:`,
      error.message
    );
  }
}

// Ejecutar cada 2 minutos (2 * 60 * 1000 ms)
const INTERVAL_MS = 2 * 60 * 1000;
setInterval(cleanup, INTERVAL_MS);

// Ejecutar inmediatamente al iniciar
cleanup();

// Log inicial
console.log(`[${new Date().toISOString()}] ✅ Cron job iniciado`);
console.log(`  - Intervalo: cada 2 minutos`);
console.log(`  - Objetivo: conexiones idle > 2 minutos del usuario actual`);

// Manejo graceful de cierre
process.on("SIGTERM", async () => {
  console.log(
    `[${new Date().toISOString()}] SIGTERM recibido, cerrando pool...`
  );
  await pool.end();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log(
    `[${new Date().toISOString()}] SIGINT recibido, cerrando pool...`
  );
  await pool.end();
  process.exit(0);
});
