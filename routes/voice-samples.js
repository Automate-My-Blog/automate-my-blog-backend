/**
 * Voice samples API: upload, list, profile, delete, reanalyze
 * @see GitHub issue #248
 */
import express from 'express';
import multer from 'multer';
import db from '../services/database.js';
import { extractTextFromFile, SUPPORTED_SOURCE_TYPES } from '../utils/file-extractors.js';
import { splitDocumentIntoPosts } from '../utils/split-document-into-posts.js';
import { createVoiceAnalysisJob } from '../services/job-queue.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'text/plain', 'text/markdown', 'text/html', 'text/csv',
      'application/pdf', 'application/json',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'message/rfc822',
    ];
    const ext = (file.originalname || '').toLowerCase().replace(/.*\./, '.');
    const allowedExt = ['.txt', '.md', '.html', '.csv', '.pdf', '.docx', '.json', '.eml'];
    if (allowed.includes(file.mimetype) || allowedExt.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Use .txt, .md, .html, .pdf, .docx, .json, .csv, or .eml'));
    }
  },
});

function requireAuth(req, res, next) {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  next();
}

/** POST /upload - multipart: organizationId, sourceType, optional metadata; files[] */
router.post('/upload', requireAuth, upload.array('files', 10), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { organizationId, sourceType = 'other_document', title: sampleTitle, weight } = req.body;
    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'organizationId is required' });
    }
    if (!SUPPORTED_SOURCE_TYPES.has(sourceType)) {
      return res.status(400).json({ success: false, error: `sourceType must be one of: ${[...SUPPORTED_SOURCE_TYPES].join(', ')}` });
    }
    const orgCheck = await db.query('SELECT id FROM organizations WHERE id = $1 AND owner_user_id = $2', [organizationId, userId]);
    if (orgCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Organization not found or access denied' });
    }

    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one file is required' });
    }

    const results = [];
    for (const file of files) {
      let raw_content = '';
      try {
        raw_content = await extractTextFromFile(file, sourceType);
      } catch (e) {
        results.push({
          file_name: file.originalname,
          error: e.message || 'Extraction failed',
          status: 'failed',
        });
        continue;
      }

      const allPosts = splitDocumentIntoPosts(raw_content);
      const posts = allPosts.slice(0, 100);
      const weightNum = weight != null ? Math.min(5, Math.max(0.1, Number(weight))) : 1.0;
      const baseTitle = sampleTitle || file.originalname || null;

      if (posts.length > 1) {
        for (let i = 0; i < posts.length; i++) {
          const { date, body, wordCount } = posts[i];
          const title = date ? `${baseTitle || 'Post'} – ${date}` : `${baseTitle || 'Post'} (${i + 1})`;
          const insert = await db.query(
            `INSERT INTO voice_samples (
              organization_id, source_type, file_name, raw_content, word_count,
              processing_status, weight, uploaded_by, title
            ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8)
            RETURNING id, source_type, file_name, word_count, processing_status, weight, created_at`,
            [
              organizationId,
              sourceType,
              `${file.originalname || 'doc'}-part-${i + 1}`,
              body,
              wordCount,
              weightNum,
              userId,
              title,
            ]
          );
          const row = insert.rows[0];
          results.push({
            id: row.id,
            source_type: row.source_type,
            file_name: row.file_name,
            word_count: row.word_count,
            processing_status: row.processing_status,
            weight: row.weight,
            created_at: row.created_at,
            split_from: file.originalname,
            part: i + 1,
            total_parts: posts.length,
          });
          try {
            const { jobId } = await createVoiceAnalysisJob(row.id, organizationId, userId);
            results[results.length - 1].jobId = jobId;
          } catch (e) {
            console.warn('Voice analysis job enqueue failed:', e.message);
          }
        }
      } else {
        const content = posts[0]?.body ?? raw_content;
        const word_count = content.trim().split(/\s+/).filter(Boolean).length;
        const insert = await db.query(
          `INSERT INTO voice_samples (
            organization_id, source_type, file_name, file_size_bytes, raw_content, word_count,
            processing_status, weight, uploaded_by, title
          ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9)
          RETURNING id, source_type, file_name, word_count, processing_status, weight, created_at`,
          [
            organizationId,
            sourceType,
            file.originalname || null,
            file.size || null,
            content,
            word_count,
            weightNum,
            userId,
            baseTitle,
          ]
        );
        const row = insert.rows[0];
        results.push({
          id: row.id,
          source_type: row.source_type,
          file_name: row.file_name,
          word_count: row.word_count,
          processing_status: row.processing_status,
          weight: row.weight,
          created_at: row.created_at,
        });
        try {
          const { jobId } = await createVoiceAnalysisJob(row.id, organizationId, userId);
          results[results.length - 1].jobId = jobId;
        } catch (e) {
          console.warn('Voice analysis job enqueue failed:', e.message);
        }
      }
    }

    return res.status(201).json({ success: true, samples: results });
  } catch (err) {
    console.error('Voice samples upload error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Upload failed' });
  }
});

/** GET /:organizationId/profile - aggregated voice profile (must be before /:organizationId) */
router.get('/:organizationId/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { organizationId } = req.params;
    const r = await db.query(
      'SELECT id FROM organizations WHERE id = $1 AND owner_user_id = $2',
      [organizationId, userId]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Organization not found or access denied' });
    }

    const profile = await db.query(
      'SELECT * FROM aggregated_voice_profiles WHERE organization_id = $1',
      [organizationId]
    );
    if (profile.rows.length === 0) {
      return res.json({ success: true, profile: null });
    }
    return res.json({ success: true, profile: profile.rows[0] });
  } catch (err) {
    console.error('Voice profile get error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Get profile failed' });
  }
});

/** GET /:organizationId - list samples */
router.get('/:organizationId', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { organizationId } = req.params;
    const r = await db.query(
      'SELECT id FROM organizations WHERE id = $1 AND owner_user_id = $2',
      [organizationId, userId]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Organization not found or access denied' });
    }

    const list = await db.query(
      `SELECT id, source_type, file_name, title, word_count, quality_score, processing_status, is_active, weight, created_at, updated_at
       FROM voice_samples WHERE organization_id = $1 ORDER BY created_at DESC`,
      [organizationId]
    );
    return res.json({ success: true, samples: list.rows });
  } catch (err) {
    console.error('Voice samples list error:', err);
    return res.status(500).json({ success: false, error: err.message || 'List failed' });
  }
});

/** DELETE /:sampleId - soft delete sample, trigger re-aggregation */
router.delete('/:sampleId', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { sampleId } = req.params;
    const row = await db.query(
      `SELECT vs.id, vs.organization_id FROM voice_samples vs
       JOIN organizations o ON o.id = vs.organization_id AND o.owner_user_id = $1
       WHERE vs.id = $2`,
      [userId, sampleId]
    );
    if (row.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Sample not found or access denied' });
    }
    const orgId = row.rows[0].organization_id;
    await db.query("UPDATE voice_samples SET is_active = FALSE, updated_at = NOW() WHERE id = $1", [sampleId]);
    const voiceAnalyzer = (await import('../services/voice-analyzer.js')).default;
    await voiceAnalyzer.updateAggregatedProfile(orgId);
    return res.json({ success: true, message: 'Sample deactivated' });
  } catch (err) {
    console.error('Voice sample delete error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Delete failed' });
  }
});

/** POST /:sampleId/reanalyze - re-queue analysis job */
router.post('/:sampleId/reanalyze', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { sampleId } = req.params;
    const row = await db.query(
      `SELECT vs.id, vs.organization_id FROM voice_samples vs
       JOIN organizations o ON o.id = vs.organization_id AND o.owner_user_id = $1
       WHERE vs.id = $2 AND vs.is_active = TRUE`,
      [userId, sampleId]
    );
    if (row.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Sample not found or access denied' });
    }
    const { organization_id } = row.rows[0];
    await db.query("UPDATE voice_samples SET processing_status = 'pending', error_message = NULL, updated_at = NOW() WHERE id = $1", [sampleId]);
    const { jobId } = await createVoiceAnalysisJob(sampleId, organization_id, userId);
    return res.json({ success: true, message: 'Reanalysis queued', jobId });
  } catch (err) {
    console.error('Voice sample reanalyze error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Reanalyze failed' });
  }
});

export default router;
