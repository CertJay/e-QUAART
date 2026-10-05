import { describe, expect, it } from 'vitest';
import { app, asUser, currentSchoolYear, prisma, request } from '../helpers.js';
import { ACCOUNTS } from '../support/fixtures.js';

/**
 * Personas who run the system rather than teach: the System Administrator (ICT unit) and the
 * Data Protection Officer. Both administer; neither sees learner records (spec §4, §12).
 */
describe('Persona · System Administrator (ICT unit)', () => {
  const email = 'persona.newhire@deped.gov.ph';
  let userId: number;
  let tempPassword: string;

  it('creates an account; the new user must change the one-time password at first sign-in', async () => {
    const ict = await asUser(ACCOUNTS.SYSTEM_ADMIN);
    const school = await prisma.school.findFirstOrThrow({ where: { schoolIdDeped: '900101' } });
    const created = await ict.post('/users').send({ email, fullName: 'Jose Persona', role: 'TEACHER', position: 'Teacher I', scopes: [{ scopeType: 'SCHOOL', schoolId: school.id }] });
    expect(created.status).toBe(201);
    userId = created.body.id;
    tempPassword = created.body.temporaryPassword;

    const first = await request(app).post('/api/v1/auth/login').send({ email, password: tempPassword });
    expect(first.status).toBe(200);
    expect(first.body.user.mustChangePassword).toBe(true);
    const weak = await request(app).post('/api/v1/auth/change-password').set('Authorization', `Bearer ${first.body.token}`).send({ currentPassword: tempPassword, newPassword: 'password' });
    expect(weak.status).toBe(400);
    const changed = await request(app).post('/api/v1/auth/change-password').set('Authorization', `Bearer ${first.body.token}`).send({ currentPassword: tempPassword, newPassword: 'Bagong#Guro2026' });
    expect(changed.status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login').send({ email, password: 'Bagong#Guro2026' })).status).toBe(200);
  });

  it('deactivates an account, which ends its sessions at once, then reactivates and resets it', async () => {
    const ict = await asUser(ACCOUNTS.SYSTEM_ADMIN);
    const session = await request(app).post('/api/v1/auth/login').send({ email, password: 'Bagong#Guro2026' });
    const token = session.body.token;
    expect((await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    const off = await ict.put(`/users/${userId}`).send({ isActive: false });
    expect(off.body.isActive).toBe(false);
    expect((await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/login').send({ email, password: 'Bagong#Guro2026' })).status).toBe(401);

    expect((await ict.put(`/users/${userId}`).send({ isActive: true })).body.isActive).toBe(true);
    const reset = await ict.post(`/users/${userId}/reset-password`);
    expect(reset.body.temporaryPassword).toBeTruthy();
    const again = await request(app).post('/api/v1/auth/login').send({ email, password: reset.body.temporaryPassword });
    expect(again.body.user.mustChangePassword).toBe(true);
  });

  it('cannot deactivate their own account', async () => {
    const ict = await asUser(ACCOUNTS.SYSTEM_ADMIN);
    const me = await prisma.user.findUniqueOrThrow({ where: { email: ACCOUNTS.SYSTEM_ADMIN } });
    expect((await ict.put(`/users/${me.id}`).send({ isActive: false })).status).toBe(400);
  });

  it('opens the end-of-year validation window and reopens encoding, all audit-logged', async () => {
    const ict = await asUser(ACCOUNTS.SYSTEM_ADMIN);
    const sy = await currentSchoolYear();
    try {
      expect((await ict.post(`/reference/school-years/${sy.id}/status`).send({ status: 'CLOSING', note: 'Persona test' })).body.status).toBe('CLOSING');
    } finally {
      expect((await ict.post(`/reference/school-years/${sy.id}/status`).send({ status: 'OPEN' })).body.status).toBe('OPEN');
    }
    const logs = await ict.get(`/governance/audit-logs?entity=SchoolYear&action=STATUS_CHANGE&entityId=${sy.id}`);
    expect(logs.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('adjusts the small-cell privacy threshold', async () => {
    const ict = await asUser(ACCOUNTS.SYSTEM_ADMIN);
    expect((await ict.put('/governance/settings/smallCellThreshold').send({ value: 101 })).status).toBe(400);
    expect((await ict.put('/governance/settings/smallCellThreshold').send({ value: 6 })).status).toBe(200);
    expect((await ict.put('/governance/settings/smallCellThreshold').send({ value: 5 })).status).toBe(200);
  });

  it('has no access to learners, results or analytics', async () => {
    const ict = await asUser(ACCOUNTS.SYSTEM_ADMIN);
    for (const path of ['/learners', '/assessments', '/analytics/summary', '/gaps', '/interventions']) {
      expect((await ict.get(path)).status, path).toBe(403);
    }
  });
});

describe('Persona · Data Protection Officer', () => {
  it('traces who viewed a learner’s record', async () => {
    const teacher = await asUser(ACCOUNTS.TEACHER);
    const learner = await prisma.learner.findFirstOrThrow({ where: { enrolments: { some: { section: { adviser: { email: ACCOUNTS.TEACHER } }, isCurrent: true } } } });
    await teacher.get(`/learners/${learner.id}`);
    const dpo = await asUser(ACCOUNTS.DPO);
    const logs = await dpo.get(`/governance/audit-logs?entity=Learner&entityId=${learner.id}&action=VIEW_LEARNER`);
    expect(logs.body.data[0]).toMatchObject({ userEmail: ACCOUNTS.TEACHER, action: 'VIEW_LEARNER' });
  });

  it('sets a retention period for a record class', async () => {
    const dpo = await asUser(ACCOUNTS.DPO);
    const policies = await dpo.get('/governance/retention');
    const p = policies.body.find((x: { entity: string }) => x.entity === 'UserSession');
    expect((await dpo.put(`/governance/retention/${p.id}`).send({ retentionMonths: 0 })).status).toBe(400);
    const updated = await dpo.put(`/governance/retention/${p.id}`).send({ retentionMonths: 3 });
    expect(updated.body.retentionMonths).toBe(3);
    await dpo.put(`/governance/retention/${p.id}`).send({ retentionMonths: p.retentionMonths });
  });

  it('records a data breach and follows it to NPC notification', async () => {
    const dpo = await asUser(ACCOUNTS.DPO);
    const created = await dpo.post('/governance/breaches').send({ title: 'Lost USB with class list', description: 'A printed class list export was copied to a USB drive that was lost.', discoveredAt: '2026-10-01', affectedRecords: 24 });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('OPEN');
    const contained = await dpo.put(`/governance/breaches/${created.body.id}`).send({ status: 'CONTAINED', actionsTaken: 'Exports disabled for the account; parents informed' });
    expect(contained.body.status).toBe('CONTAINED');
    const notified = await dpo.put(`/governance/breaches/${created.body.id}`).send({ status: 'NOTIFIED', npcNotifiedAt: '2026-10-03' });
    expect(notified.body.status).toBe('NOTIFIED');
    expect((await dpo.get('/governance/breaches')).body.some((b: { id: number }) => b.id === created.body.id)).toBe(true);
  });

  it('cannot manage users or read learner records', async () => {
    const dpo = await asUser(ACCOUNTS.DPO);
    expect((await dpo.get('/users')).status).toBe(403);
    expect((await dpo.get('/learners')).status).toBe(403);
  });
});
