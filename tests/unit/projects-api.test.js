import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { NotFoundError, UnauthorizedError } from '../../lib/errors.js';

const mockGetProjectSettingsForUser = vi.fn();
const mockSaveProjectSettingsForUser = vi.fn();

vi.mock('../../services/project-settings.js', () => ({
  getProjectSettingsForUser: (...args) => mockGetProjectSettingsForUser(...args),
  saveProjectSettingsForUser: (...args) => mockSaveProjectSettingsForUser(...args)
}));

function mockAuth(req, _res, next) {
  const uid = req.headers['x-test-user-id'];
  if (uid) req.user = { userId: uid };
  next();
}

describe('projects api', () => {
  let app;

  beforeAll(async () => {
    const { default: projectsRouter } = await import('../../routes/projects.js');
    app = express();
    app.use(express.json());
    app.use(mockAuth);
    app.use('/api/v1/projects', projectsRouter);
  });

  beforeEach(() => {
    mockGetProjectSettingsForUser.mockReset();
    mockSaveProjectSettingsForUser.mockReset();
  });

  describe('GET /api/v1/projects/:id/settings', () => {
    it('returns 401 for unauthorized errors', async () => {
      mockGetProjectSettingsForUser.mockRejectedValue(new UnauthorizedError('Authentication required'));
      await request(app).get('/api/v1/projects/p1/settings').expect(401);
    });

    it('returns 404 when service reports not found', async () => {
      mockGetProjectSettingsForUser.mockRejectedValue(new NotFoundError('Project not found', 'project'));
      await request(app)
        .get('/api/v1/projects/p1/settings')
        .set('x-test-user-id', 'u1')
        .expect(404);
    });

    it('returns settings payload on success', async () => {
      mockGetProjectSettingsForUser.mockResolvedValue({
        settings: { audienceSegment: 'enterprise' },
        savedAt: '2026-02-01T10:00:00.000Z'
      });
      const res = await request(app)
        .get('/api/v1/projects/p1/settings')
        .set('x-test-user-id', 'u1')
        .expect(200);

      expect(mockGetProjectSettingsForUser).toHaveBeenCalledWith({ projectId: 'p1', userId: 'u1' });
      expect(res.body).toEqual({
        settings: { audienceSegment: 'enterprise' },
        savedAt: '2026-02-01T10:00:00.000Z'
      });
    });
  });

  describe('PUT /api/v1/projects/:id/settings', () => {
    it('returns 404 when service reports not found', async () => {
      mockSaveProjectSettingsForUser.mockRejectedValue(new NotFoundError('Project not found', 'project'));
      await request(app)
        .put('/api/v1/projects/p1/settings')
        .set('x-test-user-id', 'u1')
        .send({ settings: { contentTone: 'friendly' } })
        .expect(404);
    });

    it('returns saved settings payload on success', async () => {
      mockSaveProjectSettingsForUser.mockResolvedValue({
        settings: { contentTone: 'friendly' },
        savedAt: '2026-02-01T11:00:00.000Z'
      });
      const res = await request(app)
        .put('/api/v1/projects/p1/settings')
        .set('x-test-user-id', 'u1')
        .send({ settings: { contentTone: 'friendly' } })
        .expect(200);

      expect(mockSaveProjectSettingsForUser).toHaveBeenCalledWith({
        projectId: 'p1',
        userId: 'u1',
        incomingSettings: { contentTone: 'friendly' }
      });
      expect(res.body).toEqual({
        settings: { contentTone: 'friendly' },
        savedAt: '2026-02-01T11:00:00.000Z'
      });
    });
  });
});
