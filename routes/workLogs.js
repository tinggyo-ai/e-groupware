const express = require('express');
const { all, get, run, now, today } = require('../database/db');
const { requireLogin } = require('./middleware');

const router = express.Router();
router.use(requireLogin);

const TYPE_META = {
  daily: {
    label: '일일업무일지',
    writeLabel: '일일업무일지 작성',
    basePath: '/work-logs/daily',
    dateLabel: '작성일',
    fields: [
      ['today_work', '금일 진행업무'],
      ['resolved_work', '해결작업'],
      ['issues', '장애 및 이슈사항'],
      ['unfinished_work', '미완료 업무'],
      ['tomorrow_plan', '내일 예정업무'],
      ['cooperation', '협조 요청사항'],
      ['note', '비고']
    ]
  },
  weekly: {
    label: '주간업무일지',
    writeLabel: '주간업무일지 작성',
    basePath: '/work-logs/weekly',
    dateLabel: '주간 기간',
    fields: [
      ['weekly_summary', '이번 주 주요업무 요약'],
      ['monday_work', '월요일 업무'],
      ['tuesday_work', '화요일 업무'],
      ['wednesday_work', '수요일 업무'],
      ['thursday_work', '목요일 업무'],
      ['friday_work', '금요일 업무'],
      ['completed', '주요 완료사항'],
      ['in_progress', '진행 중 업무'],
      ['issues', '주요 이슈사항'],
      ['next_week_plan', '다음 주 예정업무'],
      ['note', '비고']
    ]
  },
  monthly: {
    label: '월간업무일지',
    writeLabel: '월간업무일지 작성',
    basePath: '/work-logs/monthly',
    dateLabel: '대상 월',
    fields: [
      ['monthly_summary', '월간 주요업무 요약'],
      ['processed_count', '주요 처리 건수'],
      ['completed', '완료 업무'],
      ['in_progress', '진행 중 업무'],
      ['issues', '장애 및 이슈사항'],
      ['improvements', '개선사항'],
      ['next_month_plan', '다음 달 예정업무'],
      ['special_note', '특이사항'],
      ['note', '비고']
    ]
  }
};

const STATUSES = ['임시저장', '제출완료', '검토완료'];

function isAdmin(req) {
  return req.session.user.role === 'admin';
}

function typeMeta(type) {
  return TYPE_META[type];
}

function currentUserFull(req) {
  return get(
    `SELECT u.*, d.name AS department_name
     FROM users u LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.id = ?`,
    [req.session.user.id]
  );
}

function parseContent(type, body) {
  return Object.fromEntries(typeMeta(type).fields.map(([key]) => [key, body[key] || '']));
}

function summaryFor(type, body) {
  if (type === 'daily') return (body.today_work || '').split('\n')[0].slice(0, 120);
  if (type === 'weekly') return (body.weekly_summary || '').split('\n')[0].slice(0, 120);
  return (body.monthly_summary || '').split('\n')[0].slice(0, 120);
}

function normalizeStatus(action, status) {
  if (action === 'submit') return '제출완료';
  return STATUSES.includes(status) ? status : '임시저장';
}

function loadWorkLog(id) {
  const row = get(
    `SELECT wl.*, u.name AS author_name, u.email, d.name AS department_name, reviewer.name AS reviewer_name
     FROM work_logs wl
     JOIN users u ON u.id = wl.user_id
     LEFT JOIN departments d ON d.id = wl.department_id
     LEFT JOIN users reviewer ON reviewer.id = wl.reviewed_by
     WHERE wl.id = ?`,
    [id]
  );
  if (!row) return null;
  row.content = JSON.parse(row.content_json || '{}');
  row.meta = typeMeta(row.log_type);
  return row;
}

function ensureCanView(req, log) {
  return isAdmin(req) || log.user_id === req.session.user.id;
}

function ensureCanEdit(req, log) {
  if (isAdmin(req)) return true;
  return log.user_id === req.session.user.id && log.status === '임시저장';
}

router.get('/work-logs', (req, res) => {
  const counts = {};
  Object.keys(TYPE_META).forEach((type) => {
    const where = isAdmin(req) ? 'WHERE log_type = ?' : 'WHERE log_type = ? AND user_id = ?';
    const params = isAdmin(req) ? [type] : [type, req.session.user.id];
    counts[type] = get(`SELECT COUNT(*) AS count FROM work_logs ${where}`, params).count;
  });
  res.render('work-logs-index', { title: '업무일지', types: TYPE_META, counts });
});

router.get('/work-logs/:type(daily|weekly|monthly)', (req, res) => {
  const type = req.params.type;
  const meta = typeMeta(type);
  const filters = {
    date: req.query.date || '',
    month: req.query.month || '',
    author: req.query.author || '',
    department: req.query.department || '',
    status: req.query.status || ''
  };
  const where = ['wl.log_type = ?'];
  const params = [type];

  if (!isAdmin(req)) {
    where.push('wl.user_id = ?');
    params.push(req.session.user.id);
  }
  if (filters.status) {
    where.push('wl.status = ?');
    params.push(filters.status);
  }
  if (filters.author) {
    where.push('u.name LIKE ?');
    params.push(`%${filters.author}%`);
  }
  if (filters.department) {
    where.push('d.name LIKE ?');
    params.push(`%${filters.department}%`);
  }
  if (filters.date) {
    if (type === 'daily') {
      where.push('wl.entry_date = ?');
      params.push(filters.date);
    } else if (type === 'weekly') {
      where.push('(wl.period_start <= ? AND wl.period_end >= ?)');
      params.push(filters.date, filters.date);
    }
  }
  if (filters.month && type === 'monthly') {
    where.push('wl.target_month = ?');
    params.push(filters.month);
  }

  const logs = all(
    `SELECT wl.*, u.name AS author_name, d.name AS department_name
     FROM work_logs wl
     JOIN users u ON u.id = wl.user_id
     LEFT JOIN departments d ON d.id = wl.department_id
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(wl.entry_date, wl.period_start, wl.target_month) DESC, wl.created_at DESC`,
    params
  );
  const departments = all('SELECT name FROM departments ORDER BY sort_order, name');
  res.render('work-logs-list', { title: meta.label, type, meta, logs, filters, departments, statuses: STATUSES, isAdmin: isAdmin(req) });
});

router.get('/work-logs/:type(daily|weekly|monthly)/new', (req, res) => {
  const type = req.params.type;
  const user = currentUserFull(req);
  const log = {
    log_type: type,
    user_id: user.id,
    author_name: user.name,
    department_name: user.department_name,
    department_id: user.department_id,
    position: user.position,
    entry_date: today(),
    period_start: today(),
    period_end: today(),
    target_month: today().slice(0, 7),
    status: '임시저장',
    content: {}
  };
  res.render('work-log-form', { title: `${typeMeta(type).label} 작성`, type, meta: typeMeta(type), log, statuses: STATUSES, mode: 'new' });
});

router.post('/work-logs/:type(daily|weekly|monthly)/new', (req, res) => {
  const type = req.params.type;
  const user = currentUserFull(req);
  const summary = summaryFor(type, req.body);
  if (!summary.trim()) {
    req.session.flash = { type: 'danger', message: '주요업무 요약 또는 진행업무를 입력해 주세요.' };
    return res.redirect(`/work-logs/${type}/new`);
  }

  const status = req.body.action === 'submit' ? '제출완료' : '임시저장';
  const result = run(
    `INSERT INTO work_logs
     (log_type, user_id, department_id, position, entry_date, period_start, period_end, target_month, summary, content_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      type,
      user.id,
      user.department_id,
      user.position,
      type === 'daily' ? req.body.entry_date : null,
      type === 'weekly' ? req.body.period_start : null,
      type === 'weekly' ? req.body.period_end : null,
      type === 'monthly' ? req.body.target_month : null,
      summary,
      JSON.stringify(parseContent(type, req.body)),
      status,
      now(),
      now()
    ]
  );
  req.session.flash = { type: 'success', message: '업무일지를 저장했습니다.' };
  res.redirect(`/work-logs/${result.lastInsertRowid}`);
});

router.get('/work-logs/:id(\\d+)', (req, res) => {
  const log = loadWorkLog(req.params.id);
  if (!log) return res.status(404).render('error', { title: '업무일지 없음', message: '업무일지를 찾을 수 없습니다.' });
  if (!ensureCanView(req, log)) return res.status(403).render('error', { title: '접근 불가', message: '업무일지를 조회할 권한이 없습니다.' });
  res.render('work-log-detail', { title: log.meta.label, log, canEdit: ensureCanEdit(req, log), isAdmin: isAdmin(req), statuses: STATUSES });
});

router.get('/work-logs/:id(\\d+)/edit', (req, res) => {
  const log = loadWorkLog(req.params.id);
  if (!log) return res.status(404).render('error', { title: '업무일지 없음', message: '업무일지를 찾을 수 없습니다.' });
  if (!ensureCanEdit(req, log)) {
    req.session.flash = { type: 'warning', message: '제출완료 상태에서는 일반 사용자가 수정할 수 없습니다.' };
    return res.redirect(`/work-logs/${log.id}`);
  }
  res.render('work-log-form', { title: `${log.meta.label} 수정`, type: log.log_type, meta: log.meta, log, statuses: STATUSES, mode: 'edit' });
});

router.post('/work-logs/:id(\\d+)/edit', (req, res) => {
  const log = loadWorkLog(req.params.id);
  if (!log) return res.status(404).render('error', { title: '업무일지 없음', message: '업무일지를 찾을 수 없습니다.' });
  if (!ensureCanEdit(req, log)) {
    req.session.flash = { type: 'warning', message: '수정 권한이 없습니다.' };
    return res.redirect(`/work-logs/${log.id}`);
  }
  const summary = summaryFor(log.log_type, req.body);
  if (!summary.trim()) {
    req.session.flash = { type: 'danger', message: '주요업무 요약 또는 진행업무를 입력해 주세요.' };
    return res.redirect(`/work-logs/${log.id}/edit`);
  }
  const status = isAdmin(req) ? normalizeStatus(req.body.action, req.body.status) : normalizeStatus(req.body.action, '임시저장');
  run(
    `UPDATE work_logs
     SET entry_date = ?, period_start = ?, period_end = ?, target_month = ?, summary = ?, content_json = ?, status = ?, updated_at = ?
     WHERE id = ?`,
    [
      log.log_type === 'daily' ? req.body.entry_date : null,
      log.log_type === 'weekly' ? req.body.period_start : null,
      log.log_type === 'weekly' ? req.body.period_end : null,
      log.log_type === 'monthly' ? req.body.target_month : null,
      summary,
      JSON.stringify(parseContent(log.log_type, req.body)),
      status,
      now(),
      log.id
    ]
  );
  req.session.flash = { type: 'success', message: '업무일지를 수정했습니다.' };
  res.redirect(`/work-logs/${log.id}`);
});

router.post('/work-logs/:id(\\d+)/review', (req, res) => {
  const log = loadWorkLog(req.params.id);
  if (!log || !isAdmin(req)) {
    req.session.flash = { type: 'danger', message: '검토 권한이 없습니다.' };
    return res.redirect('/work-logs');
  }
  run(
    `UPDATE work_logs
     SET status = '검토완료', review_comment = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
     WHERE id = ?`,
    [req.body.review_comment || '', req.session.user.id, now(), now(), log.id]
  );
  req.session.flash = { type: 'success', message: '업무일지를 검토완료 처리했습니다.' };
  res.redirect(`/work-logs/${log.id}`);
});

module.exports = router;
