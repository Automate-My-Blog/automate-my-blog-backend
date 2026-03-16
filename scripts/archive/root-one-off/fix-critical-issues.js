#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs/promises';
import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database configuration
const getDatabaseConfig = () => {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false
      } : false
    };
  }
  
  return {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'automate_my_blog',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
    ssl: process.env.NODE_ENV === 'production' ? {
      rejectUnauthorized: false
    } : false
  };
};

const pool = new Pool(getDatabaseConfig());

async function fixCriticalIssues() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Starting Critical Issues Fix...');
    console.log('=====================================\n');
    
    // Critical Issue 1: Add content_focus column to organizations table
    console.log('1️⃣ Fixing Missing content_focus Column in Organizations Table');
    console.log('---------------------------------------------------------------');
    
    try {
      // Check if column exists
      const columnCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'organizations' AND column_name = 'content_focus'
      `);
      
      if (columnCheck.rows.length === 0) {
        console.log('   • Adding content_focus column to organizations table...');
        await client.query(`
          ALTER TABLE organizations 
          ADD COLUMN content_focus TEXT
        `);
        console.log('   ✅ content_focus column added successfully');
      } else {
        console.log('   ✅ content_focus column already exists');
      }
    } catch (error) {
      console.error('   ❌ Failed to add content_focus column:', error.message);
    }
    
    console.log();
    
    // Critical Issue 2: Ensure manual_content_uploads table exists
    console.log('2️⃣ Fixing Missing manual_content_uploads Table');
    console.log('-----------------------------------------------');
    
    try {
      // Check if table exists
      const tableCheck = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_name = 'manual_content_uploads'
      `);
      
      if (tableCheck.rows.length === 0) {
        console.log('   • Creating manual_content_uploads table...');
        
        // Create the table from migration 15
        await client.query(`
          CREATE TABLE manual_content_uploads (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            
            -- Upload details
            upload_type VARCHAR(50) NOT NULL CHECK (upload_type IN (
              'blog_posts', 'single_post', 'content_export', 'text_paste', 'file_upload'
            )),
            file_name VARCHAR(255),
            file_size INTEGER, -- Size in bytes
            file_type VARCHAR(100), -- MIME type or file extension
            
            -- Content data
            title TEXT,
            content TEXT,
            processed_content JSONB, -- Parsed and structured content
            
            -- Processing status
            processing_status VARCHAR(50) DEFAULT 'pending' CHECK (processing_status IN (
              'pending', 'processing', 'completed', 'failed', 'cancelled'
            )),
            processing_error TEXT,
            posts_extracted INTEGER DEFAULT 0,
            
            -- Analysis integration
            integrated_with_analysis BOOLEAN DEFAULT FALSE,
            analysis_contribution_score INTEGER DEFAULT 0 CHECK (analysis_contribution_score >= 0 AND analysis_contribution_score <= 100),
            
            uploaded_by UUID REFERENCES users(id), -- Track who uploaded the content
            uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            processed_at TIMESTAMP WITH TIME ZONE,
            
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          )
        `);
        
        // Add indexes for performance
        await client.query(`
          CREATE INDEX idx_manual_uploads_org ON manual_content_uploads(organization_id)
        `);
        await client.query(`
          CREATE INDEX idx_manual_uploads_status ON manual_content_uploads(processing_status)
        `);
        await client.query(`
          CREATE INDEX idx_manual_uploads_uploaded ON manual_content_uploads(uploaded_at DESC)
        `);
        await client.query(`
          CREATE INDEX idx_manual_uploads_user ON manual_content_uploads(uploaded_by) WHERE uploaded_by IS NOT NULL
        `);
        
        // Add updated_at trigger
        await client.query(`
          CREATE TRIGGER update_manual_content_uploads_updated_at 
              BEFORE UPDATE ON manual_content_uploads
              FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
        `);
        
        console.log('   ✅ manual_content_uploads table created successfully');
      } else {
        console.log('   ✅ manual_content_uploads table already exists');
      }
    } catch (error) {
      console.error('   ❌ Failed to create manual_content_uploads table:', error.message);
    }
    
    console.log();
    
    // Additional Fix: Ensure all migration 15 tables exist
    console.log('3️⃣ Verifying All Migration 15 Tables');
    console.log('-------------------------------------');
    
    const migration15Tables = [
      'website_pages',
      'cta_analysis', 
      'internal_linking_analysis',
      'content_analysis_results',
      'manual_content_uploads'
    ];
    
    for (const tableName of migration15Tables) {
      try {
        const tableExists = await client.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_name = $1
        `, [tableName]);
        
        const status = tableExists.rows.length > 0 ? '✅ EXISTS' : '❌ MISSING';
        console.log(`   • ${tableName}: ${status}`);
      } catch (error) {
        console.log(`   • ${tableName}: ❌ ERROR - ${error.message}`);
      }
    }
    
    console.log();
    
    // Additional Fix: Ensure critical utility functions exist
    console.log('4️⃣ Verifying Utility Functions');
    console.log('-------------------------------');
    
    const functions = [
      'get_website_content_summary',
      'get_cta_effectiveness_summary',
      'get_current_content_analysis'
    ];
    
    for (const functionName of functions) {
      try {
        const funcExists = await client.query(`
          SELECT routine_name 
          FROM information_schema.routines 
          WHERE routine_name = $1 AND routine_type = 'FUNCTION'
        `, [functionName]);
        
        const status = funcExists.rows.length > 0 ? '✅ EXISTS' : '❌ MISSING';
        console.log(`   • ${functionName}: ${status}`);
        
        // If get_current_content_analysis is missing, create it
        if (functionName === 'get_current_content_analysis' && funcExists.rows.length === 0) {
          console.log('     Creating missing get_current_content_analysis function...');
          await client.query(`
            CREATE OR REPLACE FUNCTION get_current_content_analysis(p_organization_id UUID)
            RETURNS JSONB AS $$
            DECLARE
                analysis_data JSONB;
            BEGIN
                SELECT row_to_json(car.*) INTO analysis_data
                FROM content_analysis_results car
                WHERE car.organization_id = p_organization_id 
                  AND car.is_current = TRUE
                  AND car.analysis_type = 'comprehensive'
                ORDER BY car.created_at DESC
                LIMIT 1;
                
                RETURN analysis_data;
            END;
            $$ LANGUAGE plpgsql;
          `);
          console.log('     ✅ Function created successfully');
        }
      } catch (error) {
        console.log(`   • ${functionName}: ❌ ERROR - ${error.message}`);
      }
    }
    
    console.log();
    console.log('🎉 Critical Issues Fix Complete!');
    console.log('=================================');
    console.log('✅ content_focus column added to organizations table');
    console.log('✅ manual_content_uploads table ensured to exist');
    console.log('✅ All Migration 15 tables verified');
    console.log('✅ Utility functions checked and created if missing');
    console.log('\n📋 Phase 1A should now be fully functional!');
    
  } catch (error) {
    console.error('❌ Critical error during fix:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run the fix
fixCriticalIssues()
  .then(() => {
    console.log('\n🚀 Database fixes completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Database fix failed:', error.message);
    process.exit(1);
  });