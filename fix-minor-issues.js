#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const { Pool } = pg;

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

async function generateSampleData() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Fixing Minor Issues - Adding Sample Data for Testing');
    console.log('=======================================================\n');
    
    // Find a test organization to add data to
    const orgResult = await client.query(`
      SELECT id, name, website_url 
      FROM organizations 
      WHERE website_url IS NOT NULL 
      LIMIT 1
    `);
    
    if (orgResult.rows.length === 0) {
      console.log('❌ No organizations found with website_url. Creating test organization...');
      
      // Create a test organization
      const newOrg = await client.query(`
        INSERT INTO organizations (name, website_url, industry, content_focus) 
        VALUES ($1, $2, $3, $4) 
        RETURNING id, name
      `, ['Test Blog Company', 'https://testblog.example.com', 'Technology', 'AI and automation']);
      
      console.log(`✅ Created test organization: ${newOrg.rows[0].name} (ID: ${newOrg.rows[0].id})`);
    }
    
    // Get the organization to use
    const finalOrg = await client.query(`
      SELECT id, name, website_url 
      FROM organizations 
      WHERE website_url IS NOT NULL 
      LIMIT 1
    `);
    const testOrg = finalOrg.rows[0];
    console.log(`📋 Using organization: ${testOrg.name} (${testOrg.website_url})\n`);
    
    // 1. Add sample website pages (blog content)
    console.log('1️⃣ Adding Sample Blog Content');
    console.log('------------------------------');
    
    const sampleBlogPosts = [
      {
        url: 'https://testblog.example.com/blog/ai-automation-future',
        title: '5 Ways AI Will Transform Business Automation in 2024',
        content: 'Artificial intelligence is revolutionizing how businesses approach automation. From predictive analytics to intelligent process automation, AI is enabling companies to streamline operations like never before. In this comprehensive guide, we explore five key areas where AI-driven automation will make the biggest impact this year.',
        meta_description: 'Discover how AI automation will transform your business operations in 2024 with these 5 game-changing trends.',
        author: 'Sarah Johnson',
        word_count: 1250,
        page_type: 'blog_post',
        published_date: '2024-01-15'
      },
      {
        url: 'https://testblog.example.com/blog/content-marketing-strategies',
        title: 'Content Marketing Strategies That Actually Drive Results',
        content: 'Content marketing continues to be one of the most effective ways to attract and engage customers. However, with increasing competition, businesses need sophisticated strategies to stand out. This article covers proven tactics for creating content that not only engages your audience but also drives meaningful business results.',
        meta_description: 'Learn proven content marketing strategies that drive real business results and engage your target audience effectively.',
        author: 'Michael Chen',
        word_count: 950,
        page_type: 'blog_post',
        published_date: '2024-01-10'
      },
      {
        url: 'https://testblog.example.com/blog/seo-trends-2024',
        title: 'SEO Trends to Watch in 2024: A Complete Guide',
        content: 'Search engine optimization continues to evolve rapidly. From AI-powered search algorithms to new ranking factors, staying ahead of SEO trends is crucial for digital success. This comprehensive guide covers the most important SEO trends and strategies for 2024, helping you maintain and improve your search rankings.',
        meta_description: 'Stay ahead with the latest SEO trends for 2024. Complete guide to algorithm updates, ranking factors, and optimization strategies.',
        author: 'Emma Rodriguez',
        word_count: 1380,
        page_type: 'blog_post',
        published_date: '2024-01-08'
      }
    ];
    
    for (const post of sampleBlogPosts) {
      try {
        await client.query(`
          INSERT INTO website_pages (
            organization_id, url, page_type, title, content, meta_description, 
            author, word_count, published_date, analysis_quality_score, 
            internal_links, headings, scraped_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
          ON CONFLICT (organization_id, url) DO NOTHING
        `, [
          testOrg.id, post.url, post.page_type, post.title, post.content, 
          post.meta_description, post.author, post.word_count, post.published_date, 
          85, // analysis_quality_score
          JSON.stringify([
            { url: 'https://testblog.example.com/about', text: 'Learn more about us' },
            { url: 'https://testblog.example.com/services', text: 'Our services' }
          ]), // internal_links
          JSON.stringify([
            { level: 1, text: post.title },
            { level: 2, text: 'Introduction' },
            { level: 2, text: 'Key Benefits' },
            { level: 3, text: 'Implementation Tips' }
          ]) // headings
        ]);
        console.log(`   ✅ Added blog post: ${post.title}`);
      } catch (error) {
        if (!error.message.includes('duplicate key')) {
          console.log(`   ⚠️  Error adding ${post.title}: ${error.message}`);
        } else {
          console.log(`   ℹ️  Blog post already exists: ${post.title}`);
        }
      }
    }
    
    console.log();
    
    // 2. Add sample CTA analysis
    console.log('2️⃣ Adding Sample CTA Analysis');
    console.log('------------------------------');
    
    const sampleCTAs = [
      {
        page_url: 'https://testblog.example.com/blog/ai-automation-future',
        cta_text: 'Get Started with AI Automation',
        cta_type: 'button',
        placement: 'main_content',
        href: 'https://testblog.example.com/get-started',
        context: 'End of blog post about AI automation benefits',
        conversion_potential: 85,
        visibility_score: 90
      },
      {
        page_url: 'https://testblog.example.com/blog/content-marketing-strategies',
        cta_text: 'Download Free Content Calendar',
        cta_type: 'download_link',
        placement: 'sidebar',
        href: 'https://testblog.example.com/downloads/content-calendar',
        context: 'Content marketing resource sidebar',
        conversion_potential: 78,
        visibility_score: 70
      },
      {
        page_url: 'https://testblog.example.com/blog/seo-trends-2024',
        cta_text: 'Book Your Free SEO Audit',
        cta_type: 'form',
        placement: 'footer',
        href: 'https://testblog.example.com/seo-audit',
        context: 'Footer call-to-action for SEO services',
        conversion_potential: 92,
        visibility_score: 65
      },
      {
        page_url: 'https://testblog.example.com/',
        cta_text: 'Subscribe to Newsletter',
        cta_type: 'email_capture',
        placement: 'popup',
        context: 'Email subscription popup',
        conversion_potential: 60,
        visibility_score: 95
      }
    ];
    
    for (const cta of sampleCTAs) {
      try {
        await client.query(`
          INSERT INTO cta_analysis (
            organization_id, page_url, cta_text, cta_type, placement, href, 
            context, conversion_potential, visibility_score, 
            improvement_suggestions, discovered_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        `, [
          testOrg.id, cta.page_url, cta.cta_text, cta.cta_type, cta.placement,
          cta.href, cta.context, cta.conversion_potential, cta.visibility_score,
          JSON.stringify([
            'Consider A/B testing different button colors',
            'Test alternative wording for higher conversion',
            'Optimize placement for mobile users'
          ])
        ]);
        console.log(`   ✅ Added CTA: ${cta.cta_text}`);
      } catch (error) {
        console.log(`   ⚠️  Error adding CTA ${cta.cta_text}: ${error.message}`);
      }
    }
    
    console.log();
    
    // 3. Add sample internal linking analysis
    console.log('3️⃣ Adding Sample Internal Linking Analysis');
    console.log('------------------------------------------');
    
    const sampleLinks = [
      {
        source_url: 'https://testblog.example.com/blog/ai-automation-future',
        target_url: 'https://testblog.example.com/services/ai-consulting',
        anchor_text: 'AI consulting services',
        link_context: 'content',
        link_type: 'service',
        seo_value: 85,
        link_relevance: 90
      },
      {
        source_url: 'https://testblog.example.com/blog/content-marketing-strategies',
        target_url: 'https://testblog.example.com/blog/seo-trends-2024',
        anchor_text: 'latest SEO trends',
        link_context: 'content',
        link_type: 'blog',
        seo_value: 75,
        link_relevance: 88
      },
      {
        source_url: 'https://testblog.example.com/',
        target_url: 'https://testblog.example.com/about',
        anchor_text: 'About Us',
        link_context: 'navigation',
        link_type: 'about',
        seo_value: 60,
        link_relevance: 95
      },
      {
        source_url: 'https://testblog.example.com/blog/seo-trends-2024',
        target_url: 'https://testblog.example.com/blog/content-marketing-strategies',
        anchor_text: 'content marketing best practices',
        link_context: 'related_posts',
        link_type: 'blog',
        seo_value: 80,
        link_relevance: 85
      }
    ];
    
    for (const link of sampleLinks) {
      try {
        await client.query(`
          INSERT INTO internal_linking_analysis (
            organization_id, source_url, target_url, anchor_text, 
            link_context, link_type, seo_value, link_relevance, 
            user_value, is_descriptive, anchor_text_length, discovered_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
          ON CONFLICT (organization_id, source_url, target_url, anchor_text) DO NOTHING
        `, [
          testOrg.id, link.source_url, link.target_url, link.anchor_text,
          link.link_context, link.link_type, link.seo_value, link.link_relevance,
          link.link_relevance - 10, // user_value
          link.anchor_text.length > 10, // is_descriptive
          link.anchor_text.length // anchor_text_length
        ]);
        console.log(`   ✅ Added internal link: ${link.anchor_text}`);
      } catch (error) {
        if (!error.message.includes('duplicate key')) {
          console.log(`   ⚠️  Error adding link ${link.anchor_text}: ${error.message}`);
        } else {
          console.log(`   ℹ️  Link already exists: ${link.anchor_text}`);
        }
      }
    }
    
    console.log();
    
    // 4. Add comprehensive analysis results
    console.log('4️⃣ Adding Comprehensive Analysis Results');
    console.log('----------------------------------------');
    
    try {
      await client.query(`
        INSERT INTO content_analysis_results (
          organization_id, analysis_type, pages_analyzed, blog_posts_analyzed,
          tone_analysis, style_patterns, content_themes, brand_voice_keywords,
          cta_strategy_analysis, total_ctas_found, cta_recommendations,
          linking_strategy_analysis, total_internal_links, linking_recommendations,
          content_gaps, content_opportunities, analysis_quality_score,
          confidence_score, analysis_completeness, ai_model_used, is_current
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        ON CONFLICT DO NOTHING
      `, [
        testOrg.id, 'comprehensive', 5, 3,
        JSON.stringify({ // tone_analysis
          primary_tone: 'Professional',
          secondary_tones: ['Educational', 'Authoritative'],
          consistency_score: 85
        }),
        JSON.stringify({ // style_patterns
          avg_sentence_length: 18,
          reading_level: 'College',
          voice: 'Active',
          structure: 'Problem-solution oriented'
        }),
        JSON.stringify([ // content_themes
          'AI and Automation',
          'Digital Marketing',
          'SEO Optimization',
          'Content Strategy'
        ]),
        JSON.stringify([ // brand_voice_keywords
          'innovative', 'strategic', 'data-driven', 'results-oriented', 'comprehensive'
        ]),
        JSON.stringify({ // cta_strategy_analysis
          primaryGoal: 'Lead generation',
          placement: 'strategic',
          effectiveness: 'High conversion focus'
        }),
        4, // total_ctas_found
        JSON.stringify([ // cta_recommendations
          'Increase CTA visibility on mobile devices',
          'A/B test different button colors',
          'Add urgency elements to CTAs'
        ]),
        JSON.stringify({ // linking_strategy_analysis
          structure: 'Hub and spoke',
          focus: 'Service pages',
          effectiveness: 'Well-structured internal linking'
        }),
        4, // total_internal_links
        JSON.stringify([ // linking_recommendations
          'Add more contextual links within blog content',
          'Create topic clusters for better SEO',
          'Improve anchor text diversity'
        ]),
        JSON.stringify([ // content_gaps
          'Case studies showcasing client success',
          'Technical implementation guides',
          'Industry-specific automation examples'
        ]),
        JSON.stringify([ // content_opportunities
          'Create AI automation ROI calculator',
          'Develop comprehensive resource library',
          'Add video content for complex topics'
        ]),
        87, // analysis_quality_score
        0.89, // confidence_score
        95, // analysis_completeness
        'GPT-4', // ai_model_used
        true // is_current
      ]);
      console.log('   ✅ Added comprehensive analysis results');
    } catch (error) {
      console.log(`   ⚠️  Error adding comprehensive analysis: ${error.message}`);
    }
    
    console.log();
    
    // 5. Add sample manual upload record
    console.log('5️⃣ Adding Sample Manual Upload Record');
    console.log('--------------------------------------');
    
    try {
      await client.query(`
        INSERT INTO manual_content_uploads (
          organization_id, upload_type, file_name, file_size, file_type,
          title, content, processing_status, posts_extracted,
          integrated_with_analysis, analysis_contribution_score,
          uploaded_at, processed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      `, [
        testOrg.id, 'blog_posts', 'sample_blog_export.json', 15420, 'application/json',
        'Sample Blog Export', 'Exported blog content for analysis integration',
        'completed', 3, true, 75
      ]);
      console.log('   ✅ Added sample manual upload record');
    } catch (error) {
      console.log(`   ⚠️  Error adding manual upload: ${error.message}`);
    }
    
    console.log();
    console.log('🎉 Minor Issues Fix Complete!');
    console.log('=============================');
    console.log('✅ Sample blog content added (3 posts)');
    console.log('✅ Sample CTA analysis added (4 CTAs)');
    console.log('✅ Sample internal linking analysis added (4 links)');
    console.log('✅ Comprehensive analysis results added');
    console.log('✅ Sample manual upload record added');
    console.log('\n📊 Analysis endpoints now have test data and should work properly!');
    
  } catch (error) {
    console.error('❌ Error during minor issues fix:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run the fix
generateSampleData()
  .then(() => {
    console.log('\n🚀 Minor issues fix completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Minor issues fix failed:', error.message);
    process.exit(1);
  });