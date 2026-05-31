const express = require('express');
const { all, get, run, now, today, getSetting } = require('../database/db');
const { requireLogin, requireApprover } = require('./middleware');

const router = express.Router();
router.use(requireLogin);

function calculateStatus(checkIn, checkOut) {
  const start = getSetting('work_start_time') || '09:00';
  const end = getSetting('work_end_time') || '18:00';
  if (!checkIn) return '출근 전';
  if (checkIn.slice(11, 16) > start) return checkOut && checkOut.slice(11, 16) < end ? '조퇴' : '지각';
  if (checkOut) return checkOut.slice(11, 16) < end ? '조퇴' : '퇴근 완료';
  return '근무 중';
}

function dashboardData(userId) {
  const workDate = today();
  const month = workDate.slice(0, 7);
  const attendance = get('SELECT * FROM attendance WHERE user_id = ? AND work_date = ?', [userId, workDate]) || {};
  const monthStats = get(
    `SELECT
       COUNT(CASE WHEN check_in_time IS NOT NULL THEN 1 END) AS work_days,
       COUNT(CASE WHEN status = '지각' THEN 1 END) AS late_count
     FROM attendance WHERE user_id = ? AND work_date LIKE ?`,
    [userId, `${month}%`]
  );
  const pendingApprovals = get(
    `SELECT COUNT(*) AS count FROM approval_lines
     WHERE approver_id = ? AND status = '대기'`,
    [userId]
  );
  const myApprovals = all(
    `SELECT status, COUNT(*) AS count FROM approvals
     WHERE requester_id = ? GROUP BY status`,
    [userId]
  );
  const latestNotices = all(
    `SELECT p.*, b.name AS board_name, u.name AS author
     FROM posts p
     JOIN boards b ON b.id = p.board_id
     JOIN users u ON u.id = p.user_id
     WHERE p.is_notice = 1 AND p.is_hidden = 0
     ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT 5`
  );
  const latestPosts = all(
    `SELECT p.*, b.name AS board_name, u.name AS author
     FROM posts p
     JOIN boards b ON b.id = p.board_id
     JOIN users u ON u.id = p.user_id
     WHERE p.is_notice = 0 AND p.is_hidden = 0
     ORDER BY p.created_at DESC LIMIT 5`
  );

  return { attendance, monthStats, pendingApprovals, myApprovals, latestNotices, latestPosts };
}

router.get('/dashboard', (req, res) => {
  res.render('dashboard', { title: '대시보드', data: dashboardData(req.session.user.id) });
});

router.post('/attendance/check-in', (req, res) => {
  const userId = req.session.user.id;
  const workDate = today();
  const existing = get('SELECT * FROM attendance WHERE user_id = ? AND work_date = ?', [userId, workDate]);
  if (existing && existing.check_in_time) {
    req.session.flash = { type: 'warning', message: '이미 출근 체크가 완료되었습니다.' };
    return res.redirect('/dashboard');
  }

  const checkIn = now();
  const status = calculateStatus(checkIn, null);
  if (existing) {
    run('UPDATE attendance SET check_in_time = ?, status = ?, updated_at = ? WHERE id = ?', [checkIn, status, now(), existing.id]);
  } else {
    run('INSERT INTO attendance (user_id, work_date, check_in_time, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
      userId,
      workDate,
      checkIn,
      status,
      now(),
      now()
    ]);
  }
  req.session.flash = { type: 'success', message: '출근 체크가 완료되었습니다.' };
  res.redirect('/dashboard');
});

router.post('/attendance/check-out', (req, res) => {
  const userId = req.session.user.id;
  const workDate = today();
  const existing = get('SELECT * FROM attendance WHERE user_id = ? AND work_date = ?', [userId, workDate]);
  if (!existing || !existing.check_in_time) {
    req.session.flash = { type: 'warning', message: '출근 체크 후 퇴근할 수 있습니다.' };
    return res.redirect('/dashboard');
  }
  if (existing.check_out_time) {
    req.session.flash = { type: 'warning', message: '이미 퇴근 체크가 완료되었습니다.' };
    return res.redirect('/dashboard');
  }
  const checkOut = now();
  run('UPDATE attendance SET check_out_time = ?, status = ?, updated_at = ? WHERE id = ?', [
    checkOut,
    calculateStatus(existing.check_in_time, checkOut),
    now(),
    existing.id
  ]);
  req.session.flash = { type: 'success', message: '퇴근 체크가 완료되었습니다.' };
  res.redirect('/dashboard');
});

router.get('/attendance', (req, res) => {
  const month = req.query.month || today().slice(0, 7);
  const rows = all('SELECT * FROM attendance WHERE user_id = ? AND work_date LIKE ? ORDER BY work_date DESC', [
    req.session.user.id,
    `${month}%`
  ]);
  res.render('attendance', { title: '내 근태', rows, month });
});

router.get('/approvals', (req, res) => res.redirect('/approvals/my'));

router.get('/approvals/new', (req, res) => {
  const forms = all('SELECT * FROM approval_forms WHERE is_active = 1 ORDER BY id');
  const approvers = all(
    `SELECT u.id, u.name, u.position, d.name AS department_name
     FROM users u LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.status = 'active' AND u.role IN ('manager', 'admin') ORDER BY u.role, u.name`
  );
  res.render('approval-new', { title: '결재 작성', forms, approvers });
});

router.post('/approvals/new', (req, res) => {
  const { form_id, title, content, amount, approver_id, action } = req.body;
  const status = action === 'submit' ? '진행중' : '임시저장';
  const result = run(
    `INSERT INTO approvals (title, content, amount, form_id, requester_id, status, current_step, total_steps, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
    [title, content, Number(amount || 0), form_id, req.session.user.id, status, now(), now()]
  );
  if (status === '진행중') {
    run('INSERT INTO approval_lines (approval_id, approver_id, step_order, status) VALUES (?, ?, 1, ?)', [
      result.lastInsertRowid,
      approver_id,
      '대기'
    ]);
  }
  req.session.flash = { type: 'success', message: status === '진행중' ? '결재 문서를 상신했습니다.' : '임시저장했습니다.' };
  res.redirect('/approvals/my');
});

router.get('/approvals/my', (req, res) => {
  const docs = all(
    `SELECT a.*, f.form_name
     FROM approvals a LEFT JOIN approval_forms f ON f.id = a.form_id
     WHERE a.requester_id = ? ORDER BY a.created_at DESC`,
    [req.session.user.id]
  );
  const waiting = all(
    `SELECT a.*, f.form_name, u.name AS requester_name
     FROM approval_lines l
     JOIN approvals a ON a.id = l.approval_id
     LEFT JOIN approval_forms f ON f.id = a.form_id
     JOIN users u ON u.id = a.requester_id
     WHERE l.approver_id = ? AND l.status = '대기'
     ORDER BY a.created_at DESC`,
    [req.session.user.id]
  );
  res.render('approvals-my', { title: '내 결재함', docs, waiting });
});

router.get('/approvals/:id', (req, res) => {
  const doc = get(
    `SELECT a.*, f.form_name, u.name AS requester_name
     FROM approvals a
     LEFT JOIN approval_forms f ON f.id = a.form_id
     JOIN users u ON u.id = a.requester_id
     WHERE a.id = ?`,
    [req.params.id]
  );
  if (!doc) return res.status(404).render('error', { title: '문서 없음', message: '결재 문서를 찾을 수 없습니다.' });
  const canView =
    doc.requester_id === req.session.user.id ||
    req.session.user.role === 'admin' ||
    get('SELECT id FROM approval_lines WHERE approval_id = ? AND approver_id = ?', [doc.id, req.session.user.id]);
  if (!canView) return res.status(403).render('error', { title: '접근 불가', message: '문서를 조회할 권한이 없습니다.' });
  const lines = all(
    `SELECT l.*, u.name, u.position FROM approval_lines l
     JOIN users u ON u.id = l.approver_id WHERE l.approval_id = ? ORDER BY l.step_order`,
    [doc.id]
  );
  res.render('approval-detail', { title: '결재 상세', doc, lines });
});

router.post('/approvals/:id/approve', requireApprover, (req, res) => {
  const line = get('SELECT * FROM approval_lines WHERE approval_id = ? AND approver_id = ? AND status = ?', [
    req.params.id,
    req.session.user.id,
    '대기'
  ]);
  if (!line) {
    req.session.flash = { type: 'danger', message: '승인할 수 있는 문서가 아닙니다.' };
    return res.redirect('/approvals/my');
  }
  run('UPDATE approval_lines SET status = ?, comment = ?, approved_at = ? WHERE id = ?', ['승인', req.body.comment || '', now(), line.id]);
  run('UPDATE approvals SET status = ?, updated_at = ? WHERE id = ?', ['승인', now(), req.params.id]);
  req.session.flash = { type: 'success', message: '결재 문서를 승인했습니다.' };
  res.redirect('/approvals/my');
});

router.post('/approvals/:id/reject', requireApprover, (req, res) => {
  const line = get('SELECT * FROM approval_lines WHERE approval_id = ? AND approver_id = ? AND status = ?', [
    req.params.id,
    req.session.user.id,
    '대기'
  ]);
  if (!line) {
    req.session.flash = { type: 'danger', message: '반려할 수 있는 문서가 아닙니다.' };
    return res.redirect('/approvals/my');
  }
  run('UPDATE approval_lines SET status = ?, comment = ?, approved_at = ? WHERE id = ?', ['반려', req.body.comment || '', now(), line.id]);
  run('UPDATE approvals SET status = ?, reject_reason = ?, updated_at = ? WHERE id = ?', ['반려', req.body.comment || '', now(), req.params.id]);
  req.session.flash = { type: 'success', message: '결재 문서를 반려했습니다.' };
  res.redirect('/approvals/my');
});

router.get('/boards', (req, res) => {
  const boards = all('SELECT * FROM boards ORDER BY id');
  const posts = all(
    `SELECT p.*, b.name AS board_name, u.name AS author
     FROM posts p JOIN boards b ON b.id = p.board_id JOIN users u ON u.id = p.user_id
     WHERE p.is_hidden = 0
     ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT 30`
  );
  res.render('boards', { title: '게시판', boards, posts, selectedBoard: null, q: '' });
});

router.get('/boards/:id', (req, res) => {
  const board = get('SELECT * FROM boards WHERE id = ?', [req.params.id]);
  const q = req.query.q || '';
  const posts = all(
    `SELECT p.*, u.name AS author, b.name AS board_name
     FROM posts p JOIN users u ON u.id = p.user_id JOIN boards b ON b.id = p.board_id
     WHERE p.board_id = ? AND p.is_hidden = 0 AND (p.title LIKE ? OR p.content LIKE ?)
     ORDER BY p.is_pinned DESC, p.created_at DESC`,
    [req.params.id, `%${q}%`, `%${q}%`]
  );
  res.render('boards', { title: board ? board.name : '게시판', boards: all('SELECT * FROM boards ORDER BY id'), posts, selectedBoard: board, q });
});

router.post('/boards/:id/posts', (req, res) => {
  run('INSERT INTO posts (board_id, user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
    req.params.id,
    req.session.user.id,
    req.body.title,
    req.body.content,
    now(),
    now()
  ]);
  req.session.flash = { type: 'success', message: '게시글을 등록했습니다.' };
  res.redirect(`/boards/${req.params.id}`);
});

router.get('/organization', (req, res) => {
  const q = req.query.q || '';
  const departments = all('SELECT * FROM departments ORDER BY sort_order, name');
  const users = all(
    `SELECT u.name, u.email, u.phone, u.position, u.role, d.name AS department_name
     FROM users u LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.status = 'active' AND (u.name LIKE ? OR d.name LIKE ?)
     ORDER BY d.sort_order, u.position DESC, u.name`,
    [`%${q}%`, `%${q}%`]
  );
  res.render('organization', { title: '조직도', departments, users, q });
});

router.get('/profile', (req, res) => {
  const user = get(
    `SELECT u.*, d.name AS department_name FROM users u
     LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?`,
    [req.session.user.id]
  );
  res.render('profile', { title: '내 정보', user });
});

module.exports = router;
