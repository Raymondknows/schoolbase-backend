// @ts-nocheck
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAdmin, requireTeacher, verifyAuth } from '../middleware/roleAuth.js';

const router = Router();
const prisma = new PrismaClient();

const timetableInclude = {
  periods: { orderBy: [{ dayOfWeek: 'asc' }, { sortOrder: 'asc' }] },
  entries: {
    include: {
      period: true,
      class: { select: { id: true, name: true, arm: true, phase: true } },
      subject: { select: { id: true, name: true, code: true } },
      teacher: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ period: { dayOfWeek: 'asc' } }, { period: { sortOrder: 'asc' } }],
  },
};

function schoolIdFromRequest(req: any) {
  return String(req.user?.schoolId || '');
}

function requiredString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function conflict(message: string, conflicts: any[] = []) {
  return { error: 'TIMETABLE_CONFLICT', message, conflicts };
}

async function getConfig(schoolId: string, configId: string) {
  return prisma.timetableConfig.findFirst({ where: { id: configId, schoolId } });
}

async function validateEntry(schoolId: string, configId: string, data: any, excludeEntryId?: string) {
  const classId = requiredString(data.classId);
  const subjectId = requiredString(data.subjectId);
  const teacherId = requiredString(data.teacherId);
  const periodId = requiredString(data.periodId);

  if (!classId || !subjectId || !teacherId || !periodId) {
    return { error: 'classId, subjectId, teacherId, and periodId are required.' };
  }

  const [config, period, schoolClass, subject, teacher] = await Promise.all([
    getConfig(schoolId, configId),
    prisma.timetablePeriod.findFirst({ where: { id: periodId, configId } }),
    prisma.class.findFirst({ where: { id: classId, schoolId } }),
    prisma.subject.findFirst({ where: { id: subjectId, schoolId } }),
    prisma.user.findFirst({ where: { id: teacherId, schoolId, role: 'TEACHER' } }),
  ]);

  if (!config) return { error: 'Timetable configuration not found.' };
  if (!period) return { error: 'Timetable period not found.' };
  if (!schoolClass) return { error: 'Class not found.' };
  if (!subject) return { error: 'Subject not found.' };
  if (!teacher) return { error: 'Teacher not found.' };

  const [subjectClass, teacherClass, teacherSubject] = await Promise.all([
    prisma.subjectClass.findFirst({ where: { schoolId, classId, subjectId } }),
    prisma.teacherClass.findFirst({ where: { schoolId, classId, teacherId } }),
    prisma.teacherSubject.findFirst({ where: { schoolId, subjectId, teacherId } }),
  ]);

  if (!subjectClass) return { error: 'This subject is not assigned to the selected class.' };
  if (!teacherClass || !teacherSubject) {
    return { error: 'This teacher is not assigned to the selected class and subject.' };
  }

  const existing = await prisma.timetableEntry.findMany({
    where: {
      schoolId,
      configId,
      periodId,
      ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}),
    },
    include: {
      class: { select: { id: true, name: true } },
      teacher: { select: { id: true, name: true } },
    },
  });

  const conflicts = [];
  const classConflict = existing.find((entry) => entry.classId === classId);
  const teacherConflict = existing.find((entry) => entry.teacherId === teacherId);
  const room = requiredString(data.room);
  const roomConflict = room && existing.find((entry) => entry.room && entry.room.toLowerCase() === room.toLowerCase());

  if (classConflict) conflicts.push({ type: 'CLASS', entryId: classConflict.id, message: `${schoolClass.name} already has a lesson in this period.` });
  if (teacherConflict) conflicts.push({ type: 'TEACHER', entryId: teacherConflict.id, message: `${teacher.name} is already teaching another class in this period.` });
  if (roomConflict) conflicts.push({ type: 'ROOM', entryId: roomConflict.id, message: `${room} is already in use in this period.` });

  return conflicts.length ? conflict('The timetable entry conflicts with an existing lesson.', conflicts) : {
    data: { classId, subjectId, teacherId, periodId, room: room || null, notes: requiredString(data.notes) || null },
  };
}

router.get('/admin/timetable', verifyAuth, requireAdmin, async (req, res) => {
  try {
    const schoolId = schoolIdFromRequest(req);
    const where: any = { schoolId };
    if (req.query.configId) where.id = String(req.query.configId);
    if (req.query.academicYearId) where.academicYearId = String(req.query.academicYearId);
    if (req.query.termId) where.termId = String(req.query.termId);
    if (req.query.status) where.status = String(req.query.status);

    const [configs, classes, subjects, teachers, academicYears] = await Promise.all([
      prisma.timetableConfig.findMany({
      where,
      include: timetableInclude,
      orderBy: { updatedAt: 'desc' },
      }),
      prisma.class.findMany({ where: { schoolId }, orderBy: [{ phase: 'asc' }, { name: 'asc' }] }),
      prisma.subject.findMany({ where: { schoolId }, orderBy: { name: 'asc' } }),
      prisma.user.findMany({ where: { schoolId, role: 'TEACHER' }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
      prisma.academicYear.findMany({ where: { schoolId }, select: { id: true, name: true, isCurrent: true }, orderBy: { createdAt: 'desc' } }),
    ]);
    res.json({ configs, classes, subjects, teachers, academicYears });
  } catch (error) {
    console.error('Error fetching admin timetable:', error);
    res.status(500).json({ error: 'Failed to fetch timetable.' });
  }
});

router.post('/admin/timetable/configs', verifyAuth, requireAdmin, async (req, res) => {
  try {
    const schoolId = schoolIdFromRequest(req);
    const academicYearId = requiredString(req.body?.academicYearId);
    const termId = requiredString(req.body?.termId);
    const name = requiredString(req.body?.name);
    if (!academicYearId || !name) return res.status(400).json({ error: 'academicYearId and name are required.' });

    const academicYear = await prisma.academicYear.findFirst({ where: { id: academicYearId, schoolId } });
    if (!academicYear) return res.status(404).json({ error: 'Academic year not found.' });
    if (termId) {
      const term = await prisma.term.findFirst({ where: { id: termId, academicYearId } });
      if (!term) return res.status(404).json({ error: 'Term not found for this academic year.' });
    }

    const config = await prisma.timetableConfig.create({
      data: { schoolId, academicYearId, termId: termId || null, name, timezone: requiredString(req.body?.timezone) || 'Africa/Lagos' },
    });
    const defaultPeriods = [
      ['Period 1', '08:00', '09:00'],
      ['Period 2', '09:00', '10:00'],
      ['Break', '10:00', '10:30'],
      ['Period 3', '10:30', '11:30'],
      ['Period 4', '11:30', '12:30'],
    ];
    await prisma.timetablePeriod.createMany({
      data: Array.from({ length: 5 }, (_, dayIndex) => defaultPeriods.map(([periodName, startsAt, endsAt], periodIndex) => ({
        configId: config.id,
        dayOfWeek: dayIndex + 1,
        name: periodName,
        startsAt,
        endsAt,
        sortOrder: periodIndex + 1,
      }))).flat(),
    });
    const createdConfig = await prisma.timetableConfig.findUnique({ where: { id: config.id }, include: timetableInclude });
    res.status(201).json({ config: createdConfig });
  } catch (error) {
    console.error('Error creating timetable config:', error);
    res.status(500).json({ error: 'Failed to create timetable.' });
  }
});

router.post('/admin/timetable/configs/:configId/periods', verifyAuth, requireAdmin, async (req, res) => {
  try {
    const schoolId = schoolIdFromRequest(req);
    const config = await getConfig(schoolId, req.params.configId);
    if (!config) return res.status(404).json({ error: 'Timetable configuration not found.' });
    const periods = Array.isArray(req.body?.periods) ? req.body.periods : [];
    if (!periods.length) return res.status(400).json({ error: 'At least one period is required.' });

    const normalized = periods.map((period, index) => ({
      dayOfWeek: Number(period.dayOfWeek),
      name: requiredString(period.name),
      startsAt: requiredString(period.startsAt),
      endsAt: requiredString(period.endsAt),
      sortOrder: Number(period.sortOrder ?? index + 1),
    }));
    if (normalized.some((period) => period.dayOfWeek < 1 || period.dayOfWeek > 7 || !period.name || !period.startsAt || !period.endsAt || period.startsAt >= period.endsAt)) {
      return res.status(400).json({ error: 'Each period needs a valid day, name, start time, and end time.' });
    }

    const entries = await prisma.timetableEntry.count({ where: { configId: config.id } });
    if (entries) return res.status(409).json({ error: 'Remove timetable entries before replacing periods.' });

    await prisma.$transaction([
      prisma.timetablePeriod.deleteMany({ where: { configId: config.id } }),
      prisma.timetablePeriod.createMany({ data: normalized.map((period) => ({ ...period, configId: config.id })) }),
    ]);
    const savedPeriods = await prisma.timetablePeriod.findMany({ where: { configId: config.id }, orderBy: [{ dayOfWeek: 'asc' }, { sortOrder: 'asc' }] });
    res.json({ periods: savedPeriods });
  } catch (error) {
    console.error('Error saving timetable periods:', error);
    res.status(500).json({ error: 'Failed to save timetable periods.' });
  }
});

router.post('/admin/timetable/configs/:configId/entries', verifyAuth, requireAdmin, async (req, res) => {
  try {
    const schoolId = schoolIdFromRequest(req);
    const result = await validateEntry(schoolId, req.params.configId, req.body || {});
    if (result.error) return res.status(result.error === 'TIMETABLE_CONFLICT' ? 409 : 400).json(result);
    const entry = await prisma.timetableEntry.create({ data: { ...result.data, configId: req.params.configId, schoolId } });
    res.status(201).json({ entry });
  } catch (error) {
    console.error('Error creating timetable entry:', error);
    res.status(500).json({ error: 'Failed to create timetable entry.' });
  }
});

router.patch('/admin/timetable/entries/:entryId', verifyAuth, requireAdmin, async (req, res) => {
  try {
    const schoolId = schoolIdFromRequest(req);
    const current = await prisma.timetableEntry.findFirst({ where: { id: req.params.entryId, schoolId } });
    if (!current) return res.status(404).json({ error: 'Timetable entry not found.' });
    const currentConfig = await getConfig(schoolId, current.configId);
    if (currentConfig?.status === 'PUBLISHED') return res.status(409).json({ error: 'Return the timetable to draft before editing lessons.' });
    const result = await validateEntry(schoolId, current.configId, { ...current, ...req.body }, current.id);
    if (result.error) return res.status(result.error === 'TIMETABLE_CONFLICT' ? 409 : 400).json(result);
    const entry = await prisma.timetableEntry.update({ where: { id: current.id }, data: result.data });
    res.json({ entry });
  } catch (error) {
    console.error('Error updating timetable entry:', error);
    res.status(500).json({ error: 'Failed to update timetable entry.' });
  }
});

router.delete('/admin/timetable/entries/:entryId', verifyAuth, requireAdmin, async (req, res) => {
  try {
    const schoolId = schoolIdFromRequest(req);
    const entry = await prisma.timetableEntry.findFirst({ where: { id: req.params.entryId, schoolId }, include: { config: true } });
    if (!entry) return res.status(404).json({ error: 'Timetable entry not found.' });
    if (entry.config.status === 'PUBLISHED') return res.status(409).json({ error: 'Published timetable entries cannot be deleted.' });
    await prisma.timetableEntry.delete({ where: { id: entry.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting timetable entry:', error);
    res.status(500).json({ error: 'Failed to delete timetable entry.' });
  }
});

router.post('/admin/timetable/configs/:configId/unpublish', verifyAuth, requireAdmin, async (req, res) => {
  try {
    const schoolId = schoolIdFromRequest(req);
    const config = await getConfig(schoolId, req.params.configId);
    if (!config) return res.status(404).json({ error: 'Timetable configuration not found.' });
    const updated = await prisma.timetableConfig.update({
      where: { id: config.id },
      data: { status: 'DRAFT', publishedAt: null, publishedBy: null },
      include: timetableInclude,
    });
    res.json({ config: updated });
  } catch (error) {
    console.error('Error returning timetable to draft:', error);
    res.status(500).json({ error: 'Failed to return timetable to draft.' });
  }
});

router.delete('/admin/timetable/configs/:configId', verifyAuth, requireAdmin, async (req, res) => {
  try {
    const schoolId = schoolIdFromRequest(req);
    const config = await getConfig(schoolId, req.params.configId);
    if (!config) return res.status(404).json({ error: 'Timetable configuration not found.' });
    if (config.status === 'PUBLISHED') return res.status(409).json({ error: 'Published timetables must be archived before deletion.' });
    await prisma.timetableConfig.delete({ where: { id: config.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting timetable configuration:', error);
    res.status(500).json({ error: 'Failed to delete timetable.' });
  }
});

router.post('/admin/timetable/configs/:configId/archive', verifyAuth, requireAdmin, async (req, res) => {
  try {
    const schoolId = schoolIdFromRequest(req);
    const config = await getConfig(schoolId, req.params.configId);
    if (!config) return res.status(404).json({ error: 'Timetable configuration not found.' });
    const updated = await prisma.timetableConfig.update({ where: { id: config.id }, data: { status: 'ARCHIVED' }, include: timetableInclude });
    res.json({ config: updated });
  } catch (error) {
    console.error('Error archiving timetable configuration:', error);
    res.status(500).json({ error: 'Failed to archive timetable.' });
  }
});

router.post('/admin/timetable/configs/:configId/publish', verifyAuth, requireAdmin, async (req, res) => {
  try {
    const schoolId = schoolIdFromRequest(req);
    const config = await prisma.timetableConfig.findFirst({ where: { id: req.params.configId, schoolId }, include: { entries: true, periods: true } });
    if (!config) return res.status(404).json({ error: 'Timetable configuration not found.' });
    if (!config.periods.length || !config.entries.length) return res.status(400).json({ error: 'Add periods and at least one lesson before publishing.' });

    const entryConflicts = [];
    const seen = new Map();
    for (const entry of config.entries) {
      for (const key of [`class:${entry.classId}`, `teacher:${entry.teacherId}`, entry.room ? `room:${entry.room.toLowerCase()}` : '']) {
        if (!key) continue;
        const previous = seen.get(`${entry.periodId}:${key}`);
        if (previous) entryConflicts.push({ type: key.split(':')[0].toUpperCase(), entryId: entry.id, conflictingEntryId: previous });
        seen.set(`${entry.periodId}:${key}`, entry.id);
      }
    }
    if (entryConflicts.length) return res.status(409).json(conflict('Resolve all conflicts before publishing.', entryConflicts));

    const updated = await prisma.timetableConfig.update({
      where: { id: config.id },
      data: { status: 'PUBLISHED', publishedAt: new Date(), publishedBy: String(req.user.userId) },
      include: timetableInclude,
    });
    res.json({ config: updated });
  } catch (error) {
    console.error('Error publishing timetable:', error);
    res.status(500).json({ error: 'Failed to publish timetable.' });
  }
});

router.get('/teacher/timetable', verifyAuth, requireTeacher, async (req, res) => {
  try {
    const schoolId = schoolIdFromRequest(req);
    const where: any = { schoolId, status: 'PUBLISHED', entries: { some: { teacherId: String(req.user.userId) } } };
    if (req.query.configId) where.id = String(req.query.configId);
    if (req.query.academicYearId) where.academicYearId = String(req.query.academicYearId);
    if (req.query.termId) where.termId = String(req.query.termId);
    const configs = await prisma.timetableConfig.findMany({ where, include: timetableInclude, orderBy: { publishedAt: 'desc' } });
    res.json({ configs: configs.map((config) => ({ ...config, entries: config.entries.filter((entry) => entry.teacherId === String(req.user.userId)) })) });
  } catch (error) {
    console.error('Error fetching teacher timetable:', error);
    res.status(500).json({ error: 'Failed to fetch timetable.' });
  }
});

router.get('/bells/active', verifyAuth, async (req, res) => {
  try {
    const config = await prisma.timetableConfig.findFirst({
      where: { schoolId: schoolIdFromRequest(req), status: 'PUBLISHED' },
      include: { periods: { orderBy: [{ dayOfWeek: 'asc' }, { sortOrder: 'asc' }] } },
      orderBy: { publishedAt: 'desc' },
    });
    res.json({
      schedule: config ? {
        timezone: config.timezone,
        events: config.periods.map((period) => ({ id: period.id, dayOfWeek: period.dayOfWeek, label: period.name, time: period.startsAt, enabled: true })),
      } : null,
    });
  } catch (error) {
    console.error('Error fetching active timetable bell schedule:', error);
    res.status(500).json({ error: 'Failed to fetch active timetable bell schedule.' });
  }
});

export default router;
