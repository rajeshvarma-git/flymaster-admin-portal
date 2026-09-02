import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { buildCatalogRecords, parseCatalogCsv } from "./csvImport.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnv() {
  const file = path.join(root, ".env");
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx < 1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // optional .env
  }
}

async function jsonUpsert(pool, tableName, data) {
  const id = String(data.id);
  await pool.query(
    `INSERT INTO app_records (id, table_name, data)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, table_name = EXCLUDED.table_name, updated_at = now()`,
    [id, tableName, JSON.stringify({ ...data, id })],
  );
}

async function jsonClearTable(pool, tableName) {
  await pool.query("DELETE FROM app_records WHERE table_name = $1", [tableName]);
}

async function jsonClearCatalogCountries(pool, countries) {
  const list = [...new Set(countries.map((value) => String(value || "").trim()).filter(Boolean))];
  for (const country of list) {
    await pool.query(
      `DELETE FROM app_records
       WHERE table_name = 'university_programs'
         AND lower(data->>'country') = lower($1)`,
      [country],
    );
    await pool.query(
      `DELETE FROM app_records
       WHERE table_name = 'universities'
         AND lower(data->>'country') = lower($1)`,
      [country],
    );
  }
}

async function main() {
  loadEnv();
  const filePath = process.argv[2];
  const replaceAll = process.argv.includes("--replace-all");
  if (!filePath) {
    console.error("Usage: node server/importCatalog.mjs <path-to.csv> [--replace-all]");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const csv = readFileSync(filePath, "utf8");
  const fileName = path.basename(filePath);
  const parsedRows = parseCatalogCsv(csv);
  const { universities, programs } = buildCatalogRecords(parsedRows, fileName);
  const countries = [...new Set(parsedRows.map((row) => row.country).filter(Boolean))];

  if (replaceAll) {
    await jsonClearTable(pool, "university_programs");
    await jsonClearTable(pool, "universities");
  } else {
    await jsonClearCatalogCountries(pool, countries);
  }

  for (const row of universities) await jsonUpsert(pool, "universities", row);
  for (const row of programs) await jsonUpsert(pool, "university_programs", row);

  console.log(
    `Imported ${programs.length} programs and ${universities.length} universities for ${countries.join(", ") || "unknown country"} from ${fileName}`,
  );
  await pool.end();
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
