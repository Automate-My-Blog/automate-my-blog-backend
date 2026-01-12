import express from 'express';
import multer from 'multer';
import db from '../services/database.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// Configure multer for file uploads (memory storage for processing)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 10 // Maximum 10 files
  },
  fileFilter: (req, file, cb) => {
    // Allow common content export formats
    const allowedTypes = [
      'text/plain', // .txt
      'text/markdown', // .md
      'text/csv', // .csv
      'application/json', // .json
      'text/html', // .html
      'application/xml', // .xml
      'text/xml' // .xml
    ];
    
    const allowedExtensions = ['.txt', '.md', '.csv', '.json', '.html', '.xml', '.wordpress', '.wpress'];
    const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
    
    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error('File type not supported. Please upload .txt, .md, .csv, .json, .html, or .xml files.'));
    }
  }
});

// Extract user context helper
const extractUserContext = (req) => {
  if (req.user?.userId) {
    return {
      isAuthenticated: true,
      userId: req.user.userId
    };
  }
  return {
    isAuthenticated: false,
    userId: null
  };
};

/**
 * POST /api/v1/content-upload/manual-posts
 * Handle manually entered blog posts via text input
 */
router.post('/manual-posts', async (req, res) => {
  try {
    console.log('📝 Processing manual blog post content...');
    
    const userContext = extractUserContext(req);
    if (!userContext.isAuthenticated) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const { posts, organizationId } = req.body;

    if (!posts || !Array.isArray(posts) || posts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Posts array is required'
      });
    }

    // Verify organization ownership
    const orgCheck = await db.query(
      'SELECT id FROM organizations WHERE id = $1 AND owner_user_id = $2',
      [organizationId, userContext.userId]
    );

    if (orgCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found or access denied'
      });
    }

    // Process each post
    const processedPosts = [];
    const errors = [];

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      
      try {
        // Validate post data
        if (!post.title || !post.content) {
          errors.push(`Post ${i + 1}: Title and content are required`);
          continue;
        }

        // Calculate word count
        const wordCount = post.content.split(/\s+/).length;

        // Insert into website_pages table
        const result = await db.query(`
          INSERT INTO website_pages (
            organization_id, url, page_type, title, content, 
            meta_description, published_date, author, word_count,
            analysis_quality_score, scraped_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
          RETURNING id, title, word_count
        `, [
          organizationId,
          post.url || `manual-upload-${uuidv4()}`, // Generate URL if not provided
          'blog_post',
          post.title,
          post.content,
          post.metaDescription || '',
          post.publishedDate ? new Date(post.publishedDate) : null,
          post.author || 'Manual Upload',
          wordCount,
          75 // Default quality score for manual uploads
        ]);

        processedPosts.push({
          id: result.rows[0].id,
          title: result.rows[0].title,
          wordCount: result.rows[0].word_count,
          source: 'manual'
        });

        console.log(`✅ Processed manual post: ${post.title} (${wordCount} words)`);
      } catch (error) {
        console.error(`Error processing post ${i + 1}:`, error);
        errors.push(`Post ${i + 1}: ${error.message}`);
      }
    }

    // Record upload in manual_content_uploads table (if it exists)
    try {
      await db.query(`
        INSERT INTO manual_content_uploads (
          organization_id, upload_type, title, processed_content,
          processing_status, posts_extracted, uploaded_by,
          processed_at, integrated_with_analysis
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), true)
      `, [
        organizationId,
        'manual_posts',
        `Manual upload of ${processedPosts.length} posts`,
        JSON.stringify({ posts: processedPosts }),
        processedPosts.length > 0 ? 'completed' : 'failed',
        processedPosts.length,
        userContext.userId
      ]);
    } catch (uploadRecordError) {
      console.warn('Could not record upload in manual_content_uploads table:', uploadRecordError.message);
    }

    res.json({
      success: true,
      message: `Processed ${processedPosts.length} blog posts`,
      processedPosts,
      errors: errors.length > 0 ? errors : null,
      summary: {
        total: posts.length,
        successful: processedPosts.length,
        failed: errors.length,
        totalWords: processedPosts.reduce((sum, post) => sum + post.wordCount, 0)
      }
    });

  } catch (error) {
    console.error('Manual posts processing error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process manual posts',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/content-upload/blog-export
 * Handle file uploads of blog exports (WordPress, etc.)
 */
router.post('/blog-export', upload.array('files', 10), async (req, res) => {
  try {
    console.log('📁 Processing blog export files...');
    
    const userContext = extractUserContext(req);
    if (!userContext.isAuthenticated) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const { organizationId } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded'
      });
    }

    // Verify organization ownership
    const orgCheck = await db.query(
      'SELECT id FROM organizations WHERE id = $1 AND owner_user_id = $2',
      [organizationId, userContext.userId]
    );

    if (orgCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found or access denied'
      });
    }

    const processedFiles = [];
    const extractedPosts = [];
    const errors = [];

    // Process each uploaded file
    for (const file of files) {
      try {
        console.log(`📄 Processing file: ${file.originalname} (${file.size} bytes)`);
        
        const fileContent = file.buffer.toString('utf8');
        const extractedContent = await extractContentFromFile(file.originalname, fileContent);
        
        if (extractedContent.posts && extractedContent.posts.length > 0) {
          // Save extracted posts to database
          for (const post of extractedContent.posts) {
            try {
              const wordCount = post.content.split(/\s+/).length;
              
              const result = await db.query(`
                INSERT INTO website_pages (
                  organization_id, url, page_type, title, content,
                  meta_description, published_date, author, word_count,
                  analysis_quality_score, scraped_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                RETURNING id, title, word_count
              `, [
                organizationId,
                post.url || `import-${uuidv4()}`,
                'blog_post',
                post.title,
                post.content,
                post.metaDescription || '',
                post.publishedDate ? new Date(post.publishedDate) : null,
                post.author || 'File Import',
                wordCount,
                70 // Default quality score for file imports
              ]);

              extractedPosts.push({
                id: result.rows[0].id,
                title: result.rows[0].title,
                wordCount: result.rows[0].word_count,
                source: file.originalname
              });
            } catch (postError) {
              errors.push(`Post "${post.title}" from ${file.originalname}: ${postError.message}`);
            }
          }
        }

        processedFiles.push({
          filename: file.originalname,
          size: file.size,
          postsExtracted: extractedContent.posts?.length || 0,
          format: extractedContent.format,
          success: true
        });

        // Record the upload
        try {
          await db.query(`
            INSERT INTO manual_content_uploads (
              organization_id, upload_type, file_name, file_size,
              processed_content, processing_status, posts_extracted,
              uploaded_by, processed_at, integrated_with_analysis
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), true)
          `, [
            organizationId,
            'file_upload',
            file.originalname,
            file.size,
            JSON.stringify(extractedContent),
            'completed',
            extractedContent.posts?.length || 0,
            userContext.userId
          ]);
        } catch (uploadRecordError) {
          console.warn('Could not record upload:', uploadRecordError.message);
        }

      } catch (fileError) {
        console.error(`Error processing file ${file.originalname}:`, fileError);
        errors.push(`File ${file.originalname}: ${fileError.message}`);
        
        processedFiles.push({
          filename: file.originalname,
          size: file.size,
          postsExtracted: 0,
          format: 'unknown',
          success: false,
          error: fileError.message
        });
      }
    }

    res.json({
      success: true,
      message: `Processed ${files.length} files, extracted ${extractedPosts.length} posts`,
      processedFiles,
      extractedPosts,
      errors: errors.length > 0 ? errors : null,
      summary: {
        filesProcessed: files.length,
        postsExtracted: extractedPosts.length,
        totalWords: extractedPosts.reduce((sum, post) => sum + post.wordCount, 0),
        errors: errors.length
      }
    });

  } catch (error) {
    console.error('File upload processing error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process file upload',
      message: error.message
    });
  }
});

/**
 * Extract content from various file formats
 */
async function extractContentFromFile(filename, content) {
  const extension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  
  switch (extension) {
    case '.md':
    case '.txt':
      return extractFromMarkdown(content);
    
    case '.csv':
      return extractFromCSV(content);
    
    case '.json':
      return extractFromJSON(content);
    
    case '.html':
    case '.xml':
      return extractFromHTML(content);
    
    default:
      return extractFromPlainText(content);
  }
}

/**
 * Extract posts from markdown/text content
 */
function extractFromMarkdown(content) {
  const posts = [];
  
  // Try to split by common patterns like "# Title" or "---"
  const sections = content.split(/(?=^#\s+|\n---\n)/m);
  
  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed.length < 100) continue; // Skip short sections
    
    // Extract title from first line
    const lines = trimmed.split('\n');
    let title = lines[0].replace(/^#+\s*/, '').trim();
    let contentText = lines.slice(1).join('\n').trim();
    
    // If no clear title found, use first sentence
    if (!title || title.length > 100) {
      const firstSentence = contentText.split('.')[0];
      title = firstSentence.length < 100 ? firstSentence : 'Imported Post';
    }
    
    if (contentText.length > 50) {
      posts.push({
        title,
        content: contentText,
        url: `markdown-import-${posts.length + 1}`
      });
    }
  }
  
  return {
    format: 'markdown',
    posts: posts.length > 0 ? posts : [{
      title: 'Imported Content',
      content: content,
      url: 'markdown-import-single'
    }]
  };
}

/**
 * Extract posts from CSV content
 */
function extractFromCSV(content) {
  const posts = [];
  const lines = content.split('\n');
  
  if (lines.length < 2) {
    throw new Error('CSV file must have at least a header and one data row');
  }
  
  // Parse header to find column indexes
  const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
  const titleIndex = header.findIndex(h => h.includes('title') || h.includes('name'));
  const contentIndex = header.findIndex(h => h.includes('content') || h.includes('body') || h.includes('text'));
  const urlIndex = header.findIndex(h => h.includes('url') || h.includes('link'));
  const authorIndex = header.findIndex(h => h.includes('author') || h.includes('writer'));
  
  if (titleIndex === -1 || contentIndex === -1) {
    throw new Error('CSV must have title and content columns');
  }
  
  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',').map(cell => cell.trim().replace(/"/g, ''));
    
    if (row.length < Math.max(titleIndex, contentIndex) + 1) continue;
    
    const title = row[titleIndex];
    const contentText = row[contentIndex];
    
    if (title && contentText && contentText.length > 50) {
      posts.push({
        title,
        content: contentText,
        url: urlIndex >= 0 ? row[urlIndex] : `csv-import-${i}`,
        author: authorIndex >= 0 ? row[authorIndex] : 'CSV Import'
      });
    }
  }
  
  return {
    format: 'csv',
    posts
  };
}

/**
 * Extract posts from JSON content
 */
function extractFromJSON(content) {
  const data = JSON.parse(content);
  const posts = [];
  
  // Handle different JSON structures
  let postsArray = [];
  
  if (Array.isArray(data)) {
    postsArray = data;
  } else if (data.posts) {
    postsArray = data.posts;
  } else if (data.items) {
    postsArray = data.items;
  } else if (data.articles) {
    postsArray = data.articles;
  } else {
    // Single post object
    postsArray = [data];
  }
  
  for (const item of postsArray) {
    const title = item.title || item.name || item.subject || 'Imported Post';
    const contentText = item.content || item.body || item.text || item.description;
    
    if (contentText && contentText.length > 50) {
      posts.push({
        title,
        content: contentText,
        url: item.url || item.link || item.permalink || `json-import-${posts.length + 1}`,
        author: item.author || item.writer || 'JSON Import',
        publishedDate: item.date || item.published || item.created_at
      });
    }
  }
  
  return {
    format: 'json',
    posts
  };
}

/**
 * Extract posts from HTML/XML content
 */
function extractFromHTML(content) {
  // Basic HTML parsing - remove tags and extract text
  const cleanText = content
    .replace(/<script[^>]*>.*?<\/script>/gis, '')
    .replace(/<style[^>]*>.*?<\/style>/gis, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  return {
    format: 'html',
    posts: [{
      title: 'HTML Import',
      content: cleanText,
      url: 'html-import'
    }]
  };
}

/**
 * Extract posts from plain text
 */
function extractFromPlainText(content) {
  // Split by double line breaks or multiple dashes
  const sections = content.split(/\n\s*\n|\n-{3,}\n/);
  const posts = [];
  
  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed.length < 100) continue;
    
    const lines = trimmed.split('\n');
    const title = lines[0].length < 100 ? lines[0] : 'Imported Text';
    const contentText = lines.slice(1).join('\n').trim() || trimmed;
    
    posts.push({
      title,
      content: contentText,
      url: `text-import-${posts.length + 1}`
    });
  }
  
  return {
    format: 'text',
    posts: posts.length > 0 ? posts : [{
      title: 'Imported Text Content',
      content: content,
      url: 'text-import-single'
    }]
  };
}

/**
 * GET /api/v1/content-upload/status/:orgId
 * Get upload history and status for an organization
 */
router.get('/status/:orgId', async (req, res) => {
  try {
    const userContext = extractUserContext(req);
    if (!userContext.isAuthenticated) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const { orgId } = req.params;

    // Verify organization ownership
    const orgCheck = await db.query(
      'SELECT id FROM organizations WHERE id = $1 AND owner_user_id = $2',
      [orgId, userContext.userId]
    );

    if (orgCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found or access denied'
      });
    }

    // Get upload history
    const uploadsResult = await db.query(`
      SELECT 
        id, upload_type, file_name, file_size, title,
        processing_status, posts_extracted, uploaded_at, processed_at,
        integrated_with_analysis
      FROM manual_content_uploads 
      WHERE organization_id = $1
      ORDER BY uploaded_at DESC
      LIMIT 50
    `, [orgId]);

    // Get summary statistics
    const summaryResult = await db.query(`
      SELECT 
        COUNT(*) as total_uploads,
        SUM(posts_extracted) as total_posts_uploaded,
        COUNT(*) FILTER (WHERE processing_status = 'completed') as successful_uploads,
        COUNT(*) FILTER (WHERE processing_status = 'failed') as failed_uploads
      FROM manual_content_uploads 
      WHERE organization_id = $1
    `, [orgId]);

    res.json({
      success: true,
      uploads: uploadsResult.rows,
      summary: summaryResult.rows[0] || {
        total_uploads: 0,
        total_posts_uploaded: 0,
        successful_uploads: 0,
        failed_uploads: 0
      }
    });

  } catch (error) {
    console.error('Upload status retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve upload status',
      message: error.message
    });
  }
});

export default router;