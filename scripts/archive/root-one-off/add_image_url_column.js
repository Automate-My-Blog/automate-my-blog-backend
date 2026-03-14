import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : {
    rejectUnauthorized: false
  }
});

async function addImageUrlColumn() {
  try {
    console.log('🔧 Adding image_url column to audiences table...');

    await pool.query(`
      ALTER TABLE audiences
      ADD COLUMN IF NOT EXISTS image_url TEXT;
    `);

    console.log('✅ Column added successfully');

    // Verify
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'audiences'
      ORDER BY ordinal_position;
    `);

    console.log('\n📊 Audiences table columns:');
    console.table(result.rows);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

addImageUrlColumn();
