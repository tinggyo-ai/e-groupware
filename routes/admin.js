const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const { all, get, run, now, today, getSetting, setSetting, logAdmin } = require('../database/db');
const { requireAdmin } = require('./middleware');

const router = express.Router();
router.use(requireAdmin);

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 5 * 1024 * 1024 }
});

function adminUserId(req) {
  return req.session.user.id;
}

function userListByStatus(statusFilter = 'active', sort = 'name', order = 'asc') {
  const where =
    statusFilter === 'all'
      ? ''
      : statusFilter === 'inactive'
        ? "WHERE u.status = 'inactive'"
        : "WHERE u.status = 'active'";
  const sortMap = {
    username: 'u.username',
    name: 'u.name',
    department: 'd.name',
    position: 'u.position',
    role: 'u.role',
    status: 'u.status',
    created: 'u.created_at'
  };
  const sortColumn = sortMap[sort] || sortMap.name;
  const direction = order === 'desc' ? 'DESC' : 'ASC';
  return all(
    `SELECT u.*, d.name AS department_name FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     ${where}
     ORDER BY ${sortColumn} ${direction}, u.name ASC`
  );
}

router.get('/', (req, res) => {
  const stats = {
    totalUsers: get("SELECT COUNT(*) AS count FROM users WHERE status = 'active'").count,
    checkedIn: get('SELECT COUNT(*) AS count FROM attendance WHERE work_date = ? AND check_in_time IS NOT NULL', [today()]).count,
    absent: get(
      `SELECT COUNT(*) AS count FROM users
       WHERE status = 'active' AND id NOT IN (SELECT user_id FROM attendance WHERE work_date = ? AND check_in_time IS NOT NULL)`,
      [today()]
    ).count,
    pendingApprovals: get("SELECT COUNT(*) AS count FROM approvals WHERE status = '진행중'").count
  };
  const notices = all('SELECT * FROM posts WHERE is_notice = 1 ORDER BY created_at DESC LIMIT 5');
  const logs = all(
    `SELECT l.*, u.name AS admin_name FROM admin_logs l
     JOIN users u ON u.id = l.admin_user_id ORDER BY l.created_at DESC LIMIT 8`
  );
  res.render('admin/dashboard', { title: '관리자 대시보드', stats, notices, logs });
});

router.get('/users', (req, res) => {
  const statusFilter = req.query.status || 'active';
  const sort = req.query.sort || 'name';
  const order = req.query.order || 'asc';
  const search = req.query.search || '';
  const deptFilter = req.query.department_id || '';

  const sortMap = { username: 'u.username', name: 'u.name', department: 'd.name', position: 'u.position', role: 'u.role', status: 'u.status', created: 'u.created_at' };
  const sortColumn = sortMap[sort] || sortMap.name;
  const direction = order === 'desc' ? 'DESC' : 'ASC';

  const where = [];
  const params = [];
  if (statusFilter !== 'all') { where.push(`u.status = ?`); params.push(statusFilter === 'inactive' ? 'inactive' : 'active'); }
  if (search) { where.push(`(u.name LIKE ? OR u.username LIKE ?)`); params.push(`%${search}%`, `%${search}%`); }
  if (deptFilter) { where.push(`u.department_id = ?`); params.push(deptFilter); }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const users = all(
    `SELECT u.*, d.name AS department_name FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     ${whereClause}
     ORDER BY ${sortColumn} ${direction}, u.name ASC`,
    params
  );
  const departments = all('SELECT * FROM departments ORDER BY sort_order, name');
  res.render('admin/users', { title: '사용자 관리', users, departments, editUser: null, statusFilter, sort, order, search, deptFilter });
});

router.get('/users/:id/edit', (req, res) => {
  const statusFilter = req.query.status || 'active';
  const sort = req.query.sort || 'name';
  const order = req.query.order || 'asc';
  const users = userListByStatus(statusFilter, sort, order);
  const departments = all('SELECT * FROM departments ORDER BY sort_order, name');
  const editUser = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  res.render('admin/users', { title: '사용자 수정', users, departments, editUser, statusFilter, sort, order, search: '', deptFilter: '' });
});

router.get('/users/:id/hr', (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.redirect('/admin/users');

  const emp = get('SELECT id FROM employees WHERE employee_no = ?', [user.username]);
  if (emp) return res.redirect(`/hr/employees/${emp.id}`);

  const empByEmail = user.email
    ? get('SELECT id FROM employees WHERE email = ?', [user.email])
    : null;
  if (empByEmail) return res.redirect(`/hr/employees/${empByEmail.id}`);

  req.session.flash = { type: 'warning', message: `${user.name}의 인사 기록이 없습니다. 신규 등록해주세요.` };
  res.redirect('/hr/employees/new');
});

router.post('/users', (req, res) => {
  const { username, password, name, email, phone, department_id, position, role } = req.body;
  const hash = bcrypt.hashSync(password || '1234', 10);
  run(
    `INSERT INTO users (username, password_hash, name, email, phone, department_id, position, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [username, hash, name, email, phone, department_id || null, position, role, now(), now()]
  );
  logAdmin(adminUserId(req), 'CREATE_USER', 'users', null, `${name} 계정 등록`);
  req.session.flash = { type: 'success', message: '직원을 등록했습니다.' };
  res.redirect('/admin/users');
});

function bulkDeleteUsers(req, res) {
  const selected = Array.isArray(req.body.user_ids)
    ? req.body.user_ids
    : req.body.user_ids
      ? [req.body.user_ids]
      : [];

  const ids = selected.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0 && id !== adminUserId(req));
  if (!ids.length) {
    req.session.flash = { type: 'warning', message: '삭제할 직원을 선택해 주세요. 현재 로그인한 관리자 계정은 제외됩니다.' };
    return res.redirect('/admin/users');
  }

  const placeholders = ids.map(() => '?').join(',');
  run(`UPDATE users SET status = 'inactive', updated_at = ? WHERE id IN (${placeholders})`, [now(), ...ids]);
  logAdmin(adminUserId(req), 'BULK_DEACTIVATE_USERS', 'users', null, `사용자 ${ids.length}명 일괄 비활성화`);
  req.session.flash = { type: 'success', message: `${ids.length}명의 사용자를 삭제 처리했습니다.` };
  res.redirect('/admin/users');
}

router.post('/users/bulk-delete', bulkDeleteUsers);
router.post('/users/bulk-deactivate', bulkDeleteUsers);

router.get('/users/import-template', (req, res) => {
  const rows = [
    {
      username: 'user02',
      password: '1234',
      name: '이영희',
      email: 'younghee.lee@example.com',
      phone: '010-5555-6666',
      department: '경영지원팀',
      position: '대리',
      role: 'employee',
      status: 'active'
    }
  ];
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'users');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="user-import-template.xlsx"');
  res.send(buffer);
});

router.post('/users/import', upload.single('excel_file'), (req, res) => {
  if (!req.file) {
    req.session.flash = { type: 'danger', message: '업로드할 엑셀 파일을 선택해 주세요.' };
    return res.redirect('/admin/users');
  }

  const result = { inserted: 0, skipped: 0, errors: [] };
  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

    rows.forEach((row, index) => {
      const line = index + 2;
      const username = String(row.username || row['아이디'] || '').trim();
      const password = String(row.password || row['비밀번호'] || '').trim();
      const name = String(row.name || row['이름'] || '').trim();
      const email = String(row.email || row['이메일'] || '').trim();
      const phone = String(row.phone || row['연락처'] || '').trim();
      const departmentName = String(row.department || row['부서'] || '').trim();
      const position = String(row.position || row['직급'] || '').trim();
      const role = String(row.role || row['권한'] || 'employee').trim();
      const status = String(row.status || row['상태'] || 'active').trim();

      if (!username || !password || !name) {
        result.skipped += 1;
        result.errors.push(`${line}행: 아이디, 비밀번호, 이름은 필수입니다.`);
        return;
      }
      if (!['admin', 'manager', 'employee'].includes(role)) {
        result.skipped += 1;
        result.errors.push(`${line}행: 권한은 admin, manager, employee 중 하나여야 합니다.`);
        return;
      }
      if (get('SELECT id FROM users WHERE username = ?', [username])) {
        result.skipped += 1;
        result.errors.push(`${line}행: 이미 존재하는 아이디(${username})입니다.`);
        return;
      }

      let departmentId = null;
      if (departmentName) {
        let department = get('SELECT id FROM departments WHERE name = ?', [departmentName]);
        if (!department) {
          const created = run('INSERT INTO departments (name, sort_order, created_at) VALUES (?, ?, ?)', [departmentName, 999, now()]);
          department = { id: created.lastInsertRowid };
        }
        departmentId = department.id;
      }

      run(
        `INSERT INTO users
         (username, password_hash, name, email, phone, department_id, position, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          username,
          bcrypt.hashSync(password, 10),
          name,
          email,
          phone,
          departmentId,
          position,
          role,
          status === 'inactive' ? 'inactive' : 'active',
          now(),
          now()
        ]
      );
      result.inserted += 1;
    });

    logAdmin(
      adminUserId(req),
      'IMPORT_USERS',
      'users',
      null,
      `엑셀 사용자 일괄 등록: 성공 ${result.inserted}건, 건너뜀 ${result.skipped}건`
    );
    const errorText = result.errors.slice(0, 5).join(' / ');
    req.session.flash = {
      type: result.inserted ? 'success' : 'warning',
      message: `엑셀 등록 완료: 성공 ${result.inserted}건, 건너뜀 ${result.skipped}건${errorText ? ` (${errorText})` : ''}`
    };
  } catch (error) {
    console.error(error);
    req.session.flash = { type: 'danger', message: '엑셀 파일 처리 중 오류가 발생했습니다. 양식을 확인해 주세요.' };
  } finally {
    fs.unlink(req.file.path, () => {});
  }

  res.redirect('/admin/users');
});

router.post('/users/:id/update', (req, res) => {
  const { name, email, phone, department_id, position, role, status } = req.body;
  run(
    `UPDATE users SET name = ?, email = ?, phone = ?, department_id = ?, position = ?, role = ?, status = ?, updated_at = ?
     WHERE id = ?`,
    [name, email, phone, department_id || null, position, role, status, now(), req.params.id]
  );
  logAdmin(adminUserId(req), 'UPDATE_USER', 'users', req.params.id, `${name} 계정 수정`);
  req.session.flash = { type: 'success', message: '사용자 정보를 수정했습니다.' };
  res.redirect('/admin/users');
});

router.post('/users/:id/reset-password', (req, res) => {
  const newPassword = req.body.password || '1234';
  run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [bcrypt.hashSync(newPassword, 10), now(), req.params.id]);
  logAdmin(adminUserId(req), 'RESET_PASSWORD', 'users', req.params.id, '비밀번호 초기화');
  req.session.flash = { type: 'success', message: `비밀번호를 ${newPassword} 로 초기화했습니다.` };
  res.redirect('/admin/users');
});

router.post('/users/:id/deactivate', (req, res) => {
  run("UPDATE users SET status = 'inactive', updated_at = ? WHERE id = ?", [now(), req.params.id]);
  logAdmin(adminUserId(req), 'DEACTIVATE_USER', 'users', req.params.id, '사용자 비활성화');
  req.session.flash = { type: 'success', message: '사용자를 비활성화했습니다.' };
  res.redirect('/admin/users');
});

router.get('/departments', (req, res) => {
  const departments = all(
    `SELECT d.*, p.name AS parent_name, u.name AS manager_name
     FROM departments d
     LEFT JOIN departments p ON p.id = d.parent_id
     LEFT JOIN users u ON u.id = d.manager_user_id
     ORDER BY d.sort_order, d.name`
  );
  const managers = all("SELECT id, name, position FROM users WHERE status = 'active' AND role IN ('manager','admin') ORDER BY name");
  res.render('admin/departments', { title: '부서 관리', departments, managers });
});

router.post('/departments', (req, res) => {
  run('INSERT INTO departments (name, parent_id, manager_user_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?)', [
    req.body.name,
    req.body.parent_id || null,
    req.body.manager_user_id || null,
    Number(req.body.sort_order || 0),
    now()
  ]);
  logAdmin(adminUserId(req), 'CREATE_DEPARTMENT', 'departments', null, `${req.body.name} 부서 등록`);
  req.session.flash = { type: 'success', message: '부서를 등록했습니다.' };
  res.redirect('/admin/departments');
});

router.post('/departments/:id/update', (req, res) => {
  run('UPDATE departments SET name = ?, parent_id = ?, manager_user_id = ?, sort_order = ? WHERE id = ?', [
    req.body.name,
    req.body.parent_id || null,
    req.body.manager_user_id || null,
    Number(req.body.sort_order || 0),
    req.params.id
  ]);
  logAdmin(adminUserId(req), 'UPDATE_DEPARTMENT', 'departments', req.params.id, `${req.body.name} 부서 수정`);
  req.session.flash = { type: 'success', message: '부서를 수정했습니다.' };
  res.redirect('/admin/departments');
});

router.get('/roles', (req, res) => {
  const users = all(
    `SELECT u.id, u.username, u.name, u.role, d.name AS department_name
     FROM users u LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.status = 'active' ORDER BY u.role, u.name`
  );
  res.render('admin/roles', { title: '권한 관리', users });
});

router.post('/roles/:id', (req, res) => {
  run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', [req.body.role, now(), req.params.id]);
  logAdmin(adminUserId(req), 'UPDATE_ROLE', 'users', req.params.id, `권한을 ${req.body.role}(으)로 변경`);
  req.session.flash = { type: 'success', message: '권한을 변경했습니다.' };
  res.redirect('/admin/roles');
});

router.get('/attendance', (req, res) => {
  const date = req.query.date || today();
  const rows = all(
    `SELECT a.*, u.id AS user_id, u.name, u.position, d.name AS department_name
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN attendance a ON a.user_id = u.id AND a.work_date = ?
     WHERE u.status = 'active'
       AND (? = '' OR u.name LIKE ?)
       AND (? = '' OR d.id = ?)
     ORDER BY d.sort_order, u.name`,
    [date, req.query.user || '', `%${req.query.user || ''}%`, req.query.department_id || '', req.query.department_id || '']
  );
  const departments = all('SELECT * FROM departments ORDER BY sort_order, name');
  res.render('admin/attendance', { title: '근태 관리', rows, departments, date, query: req.query });
});

router.post('/attendance/:userId/update', (req, res) => {
  const workDate = req.body.work_date;
  const checkIn = req.body.check_in_time ? `${workDate}T${req.body.check_in_time}:00.000Z` : null;
  const checkOut = req.body.check_out_time ? `${workDate}T${req.body.check_out_time}:00.000Z` : null;
  const existing = get('SELECT id FROM attendance WHERE user_id = ? AND work_date = ?', [req.params.userId, workDate]);
  if (existing) {
    run(
      `UPDATE attendance SET check_in_time = ?, check_out_time = ?, status = ?, memo = ?, modified_by = ?,
       modified_reason = ?, updated_at = ? WHERE id = ?`,
      [checkIn, checkOut, req.body.status, req.body.memo || '', adminUserId(req), req.body.modified_reason || '', now(), existing.id]
    );
  } else {
    run(
      `INSERT INTO attendance
       (user_id, work_date, check_in_time, check_out_time, status, memo, modified_by, modified_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.userId,
        workDate,
        checkIn,
        checkOut,
        req.body.status,
        req.body.memo || '',
        adminUserId(req),
        req.body.modified_reason || '',
        now(),
        now()
      ]
    );
  }
  logAdmin(adminUserId(req), 'UPDATE_ATTENDANCE', 'attendance', req.params.userId, req.body.modified_reason || '근태 수정');
  req.session.flash = { type: 'success', message: '근태 정보를 수정했습니다.' };
  res.redirect(`/admin/attendance?date=${workDate}`);
});

router.get('/attendance/export', (req, res) => {
  const date = req.query.date || today();
  const rows = all(
    `SELECT u.name, d.name AS department_name, u.position, a.work_date, a.check_in_time, a.check_out_time, a.status, a.modified_reason
     FROM attendance a JOIN users u ON u.id = a.user_id LEFT JOIN departments d ON d.id = u.department_id
     WHERE a.work_date LIKE ? ORDER BY a.work_date DESC, d.sort_order, u.name`,
    [`${date.slice(0, 7)}%`]
  );
  const header = ['이름', '부서', '직급', '날짜', '출근', '퇴근', '상태', '수정사유'];
  const csv = [header, ...rows.map((r) => [r.name, r.department_name, r.position, r.work_date, r.check_in_time, r.check_out_time, r.status, r.modified_reason])]
    .map((cols) => cols.map((v) => `"${String(v || '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${date}.csv"`);
  res.send(`\uFEFF${csv}`);
});

router.get('/work-logs', (req, res) => {
  const { status, department_id, log_type, date, search } = req.query;

  const stats = {
    total:    get(`SELECT COUNT(*) AS n FROM work_logs WHERE status != '임시저장'`).n,
    pending:  get(`SELECT COUNT(*) AS n FROM work_logs WHERE status = '제출완료'`).n,
    reviewed: get(`SELECT COUNT(*) AS n FROM work_logs WHERE status = '검토완료'`).n,
    today:    get(`SELECT COUNT(*) AS n FROM work_logs WHERE status != '임시저장' AND date(created_at) = date('now','localtime')`).n,
  };

  const where = [`wl.status != '임시저장'`];
  const params = [];

  if (status) { where.push(`wl.status = ?`); params.push(status); }
  if (department_id) { where.push(`u.department_id = ?`); params.push(department_id); }
  if (log_type) { where.push(`wl.log_type = ?`); params.push(log_type); }
  if (search) { where.push(`u.name LIKE ?`); params.push(`%${search}%`); }
  if (date) {
    where.push(`(wl.entry_date = ? OR wl.period_start <= ? AND wl.period_end >= ? OR wl.target_month = ?)`);
    params.push(date, date, date, date.slice(0, 7));
  }

  const rows = all(
    `SELECT wl.id, wl.log_type, wl.status, wl.entry_date, wl.period_start, wl.period_end,
            wl.target_month, wl.summary, wl.created_at, wl.reviewed_at,
            u.name AS user_name, u.position,
            d.name AS department_name,
            ru.name AS reviewer_name
     FROM work_logs wl
     JOIN users u ON u.id = wl.user_id
     LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN users ru ON ru.id = wl.reviewed_by
     WHERE ${where.join(' AND ')}
     ORDER BY wl.status = '검토완료' ASC, wl.created_at DESC`,
    params
  );

  const departments = all('SELECT * FROM departments ORDER BY sort_order, name');
  res.render('admin/work-logs', { title: '업무일지 관리', rows, stats, departments, query: req.query });
});

router.get('/approval-forms', (req, res) => {
  res.render('admin/approval-forms', { title: '결재 양식 관리', forms: all('SELECT * FROM approval_forms ORDER BY id') });
});

router.post('/approval-forms', (req, res) => {
  run('INSERT INTO approval_forms (form_name, form_type, form_schema, is_active, created_at) VALUES (?, ?, ?, ?, ?)', [
    req.body.form_name,
    req.body.form_type,
    req.body.form_schema || '{}',
    req.body.is_active ? 1 : 0,
    now()
  ]);
  logAdmin(adminUserId(req), 'CREATE_APPROVAL_FORM', 'approval_forms', null, req.body.form_name);
  req.session.flash = { type: 'success', message: '결재 양식을 등록했습니다.' };
  res.redirect('/admin/approval-forms');
});

router.post('/approval-forms/:id/update', (req, res) => {
  run('UPDATE approval_forms SET form_name = ?, form_type = ?, form_schema = ?, is_active = ? WHERE id = ?', [
    req.body.form_name,
    req.body.form_type,
    req.body.form_schema || '{}',
    req.body.is_active ? 1 : 0,
    req.params.id
  ]);
  logAdmin(adminUserId(req), 'UPDATE_APPROVAL_FORM', 'approval_forms', req.params.id, req.body.form_name);
  req.session.flash = { type: 'success', message: '결재 양식을 수정했습니다.' };
  res.redirect('/admin/approval-forms');
});

router.get('/approval-lines', (req, res) => {
  const managers = all(
    `SELECT u.*, d.name AS department_name FROM users u
     LEFT JOIN departments d ON d.id = u.department_id WHERE u.role IN ('manager','admin') AND u.status = 'active'`
  );
  res.render('admin/approval-lines', { title: '결재라인 관리', managers });
});

router.get('/boards', (req, res) => {
  const boards = all('SELECT * FROM boards ORDER BY id');
  const posts = all(
    `SELECT p.*, b.name AS board_name, u.name AS author
     FROM posts p JOIN boards b ON b.id = p.board_id JOIN users u ON u.id = p.user_id
     ORDER BY p.created_at DESC LIMIT 100`
  );
  res.render('admin/boards', { title: '게시판 관리', boards, posts });
});

router.post('/boards', (req, res) => {
  run('INSERT INTO boards (name, description, permission_type, created_at) VALUES (?, ?, ?, ?)', [
    req.body.name,
    req.body.description,
    req.body.permission_type,
    now()
  ]);
  logAdmin(adminUserId(req), 'CREATE_BOARD', 'boards', null, req.body.name);
  req.session.flash = { type: 'success', message: '게시판을 등록했습니다.' };
  res.redirect('/admin/boards');
});

router.post('/boards/:id/update', (req, res) => {
  run('UPDATE boards SET name = ?, description = ?, permission_type = ? WHERE id = ?', [
    req.body.name,
    req.body.description,
    req.body.permission_type,
    req.params.id
  ]);
  logAdmin(adminUserId(req), 'UPDATE_BOARD', 'boards', req.params.id, req.body.name);
  req.session.flash = { type: 'success', message: '게시판을 수정했습니다.' };
  res.redirect('/admin/boards');
});

router.post('/posts/:id/hide', (req, res) => {
  run('UPDATE posts SET is_hidden = 1, updated_at = ? WHERE id = ?', [now(), req.params.id]);
  logAdmin(adminUserId(req), 'HIDE_POST', 'posts', req.params.id, '게시글 숨김');
  req.session.flash = { type: 'success', message: '게시글을 숨김 처리했습니다.' };
  res.redirect('/admin/boards');
});

router.get('/settings', (req, res) => {
  res.render('admin/settings', {
    title: '시스템 설정',
    settings: {
      company_name: getSetting('company_name'),
      work_start_time: getSetting('work_start_time'),
      work_end_time: getSetting('work_end_time')
    }
  });
});

router.post('/settings', (req, res) => {
  setSetting('company_name', req.body.company_name);
  setSetting('work_start_time', req.body.work_start_time);
  setSetting('work_end_time', req.body.work_end_time);
  logAdmin(adminUserId(req), 'UPDATE_SETTINGS', 'system_settings', null, '시스템 설정 수정');
  req.session.flash = { type: 'success', message: '시스템 설정을 저장했습니다.' };
  res.redirect('/admin/settings');
});

router.get('/logs', (req, res) => {
  const logs = all(
    `SELECT l.*, u.name AS admin_name FROM admin_logs l
     JOIN users u ON u.id = l.admin_user_id ORDER BY l.created_at DESC LIMIT 200`
  );
  res.render('admin/logs', { title: '관리자 로그', logs });
});

module.exports = router;
