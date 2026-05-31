const express = require('express');
const router = express.Router();
const { run, get, all, now, today } = require('../database/db');
const { requireLogin, requireHrAccess } = require('./middleware');

router.use(requireLogin, requireHrAccess);

// GET /hr - 인사관리 대시보드
router.get('/', (req, res) => {
  const todayStr = today();
  const thisMonth = todayStr.slice(0, 7);

  // 날짜 30일 후
  const d30 = new Date(Date.now() + 9 * 60 * 60 * 1000 + 30 * 24 * 60 * 60 * 1000);
  const in30Days = d30.toISOString().slice(0, 10);

  const totalCount = (get('SELECT COUNT(*) as cnt FROM employees') || {}).cnt || 0;
  const activeCount = (get("SELECT COUNT(*) as cnt FROM employees WHERE employment_status = '재직'") || {}).cnt || 0;
  const resignedCount = (get("SELECT COUNT(*) as cnt FROM employees WHERE employment_status = '퇴사'") || {}).cnt || 0;
  const expiringSoon = (get(
    "SELECT COUNT(*) as cnt FROM employees WHERE employment_status = '재직' AND contract_end_date IS NOT NULL AND contract_end_date != '' AND contract_end_date >= ? AND contract_end_date <= ?",
    [todayStr, in30Days]
  ) || {}).cnt || 0;
  const hiredThisMonth = (get(
    "SELECT COUNT(*) as cnt FROM employees WHERE substr(hire_date,1,7) = ?",
    [thisMonth]
  ) || {}).cnt || 0;
  const resignedThisMonth = (get(
    "SELECT COUNT(*) as cnt FROM employees WHERE employment_status = '퇴사' AND substr(resignation_date,1,7) = ?",
    [thisMonth]
  ) || {}).cnt || 0;

  res.render('hr/index', {
    title: '인사관리',
    stats: { totalCount, activeCount, resignedCount, expiringSoon, hiredThisMonth, resignedThisMonth }
  });
});

// GET /hr/employees - 직원 목록
router.get('/employees', (req, res) => {
  const { name = '', department = '', employment_type = '', employment_status = '' } = req.query;
  let sql = `
    SELECT e.*, d.name AS department_name
    FROM employees e
    LEFT JOIN departments d ON e.department_id = d.id
    WHERE 1=1
  `;
  const params = [];
  if (name) { sql += ' AND e.name LIKE ?'; params.push(`%${name}%`); }
  if (department) { sql += ' AND e.department_id = ?'; params.push(department); }
  if (employment_type) { sql += ' AND e.employment_type = ?'; params.push(employment_type); }
  if (employment_status) { sql += ' AND e.employment_status = ?'; params.push(employment_status); }
  sql += ' ORDER BY e.employee_no';

  const employees = all(sql, params);
  const departments = all('SELECT * FROM departments ORDER BY sort_order, name');

  res.render('hr/employees', {
    title: '직원 목록',
    employees,
    departments,
    filters: { name, department, employment_type, employment_status }
  });
});

// GET /hr/employees/new
router.get('/employees/new', (req, res) => {
  const departments = all('SELECT * FROM departments ORDER BY sort_order, name');
  res.render('hr/employee-form', {
    title: '직원 등록',
    editEmployee: null,
    departments
  });
});

// POST /hr/employees - 직원 등록
router.post('/employees', (req, res) => {
  const {
    employee_no, name, english_name, department_id, team, position, job_title,
    employment_type, employment_status, hire_date, resignation_date,
    contract_start_date, contract_end_date, probation_start, probation_end,
    birthdate, gender, phone, email, address,
    emergency_name, emergency_relation, emergency_phone,
    education, career_years, job_description, memo
  } = req.body;

  run(
    `INSERT INTO employees
     (employee_no, name, english_name, department_id, team, position, job_title,
      employment_type, employment_status, hire_date, resignation_date,
      contract_start_date, contract_end_date, probation_start, probation_end,
      birthdate, gender, phone, email, address,
      emergency_name, emergency_relation, emergency_phone,
      education, career_years, job_description, memo, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      employee_no, name, english_name || null, department_id || null, team || null,
      position || null, job_title || null,
      employment_type || '정규직', employment_status || '재직',
      hire_date || null, resignation_date || null,
      contract_start_date || null, contract_end_date || null,
      probation_start || null, probation_end || null,
      birthdate || null, gender || null, phone || null, email || null, address || null,
      emergency_name || null, emergency_relation || null, emergency_phone || null,
      education || null, career_years ? parseInt(career_years) : 0,
      job_description || null, memo || null,
      req.session.user.id, now(), now()
    ]
  );

  req.session.flash = { type: 'success', message: '직원이 등록되었습니다.' };
  res.redirect('/hr/employees');
});

// GET /hr/employees/:id/edit
router.get('/employees/:id/edit', (req, res) => {
  const emp = get(`
    SELECT e.*, d.name AS department_name
    FROM employees e LEFT JOIN departments d ON e.department_id = d.id
    WHERE e.id = ?`, [req.params.id]);
  if (!emp) return res.redirect('/hr/employees');
  const departments = all('SELECT * FROM departments ORDER BY sort_order, name');
  res.render('hr/employee-form', {
    title: '직원 수정',
    editEmployee: emp,
    departments
  });
});

// GET /hr/employees/:id - 직원 상세
router.get('/employees/:id', (req, res) => {
  const emp = get(`
    SELECT e.*, d.name AS department_name
    FROM employees e LEFT JOIN departments d ON e.department_id = d.id
    WHERE e.id = ?`, [req.params.id]);
  if (!emp) return res.redirect('/hr/employees');

  const contracts = all('SELECT * FROM hr_contracts WHERE employee_id = ? ORDER BY created_at DESC', [emp.id]);
  const histories = all('SELECT * FROM hr_histories WHERE employee_id = ? ORDER BY change_date DESC', [emp.id]);

  res.render('hr/employee-detail', {
    title: emp.name + ' - 직원 상세',
    emp,
    contracts,
    histories
  });
});

// POST /hr/employees/:id - 직원 수정
router.post('/employees/:id', (req, res) => {
  const {
    employee_no, name, english_name, department_id, team, position, job_title,
    employment_type, employment_status, hire_date, resignation_date,
    contract_start_date, contract_end_date, probation_start, probation_end,
    birthdate, gender, phone, email, address,
    emergency_name, emergency_relation, emergency_phone,
    education, career_years, job_description, memo
  } = req.body;

  run(
    `UPDATE employees SET
     employee_no=?, name=?, english_name=?, department_id=?, team=?, position=?, job_title=?,
     employment_type=?, employment_status=?, hire_date=?, resignation_date=?,
     contract_start_date=?, contract_end_date=?, probation_start=?, probation_end=?,
     birthdate=?, gender=?, phone=?, email=?, address=?,
     emergency_name=?, emergency_relation=?, emergency_phone=?,
     education=?, career_years=?, job_description=?, memo=?, updated_at=?
     WHERE id=?`,
    [
      employee_no, name, english_name || null, department_id || null, team || null,
      position || null, job_title || null,
      employment_type || '정규직', employment_status || '재직',
      hire_date || null, resignation_date || null,
      contract_start_date || null, contract_end_date || null,
      probation_start || null, probation_end || null,
      birthdate || null, gender || null, phone || null, email || null, address || null,
      emergency_name || null, emergency_relation || null, emergency_phone || null,
      education || null, career_years ? parseInt(career_years) : 0,
      job_description || null, memo || null, now(),
      req.params.id
    ]
  );

  req.session.flash = { type: 'success', message: '직원 정보가 수정되었습니다.' };
  res.redirect('/hr/employees/' + req.params.id);
});

// POST /hr/employees/:id/delete - 퇴사 처리
router.post('/employees/:id/delete', (req, res) => {
  run("UPDATE employees SET employment_status='퇴사', resignation_date=?, updated_at=? WHERE id=?",
    [today(), now(), req.params.id]);
  req.session.flash = { type: 'success', message: '퇴사 처리되었습니다.' };
  res.redirect('/hr/employees');
});

// POST /hr/contracts - 계약 등록
router.post('/contracts', (req, res) => {
  const {
    employee_id, contract_title, contract_type,
    contract_start_date, contract_end_date,
    department, position, job_description, work_location, work_time,
    salary_amount, contract_date, signed_status, special_terms, memo
  } = req.body;

  run(
    `INSERT INTO hr_contracts
     (employee_id, contract_title, contract_type, contract_start_date, contract_end_date,
      department, position, job_description, work_location, work_time,
      salary_amount, contract_date, signed_status, special_terms, memo, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      employee_id, contract_title || null, contract_type || null,
      contract_start_date || null, contract_end_date || null,
      department || null, position || null, job_description || null,
      work_location || null, work_time || null,
      salary_amount ? parseInt(salary_amount) : 0,
      contract_date || null, signed_status || '미서명',
      special_terms || null, memo || null, now(), now()
    ]
  );

  req.session.flash = { type: 'success', message: '계약이 등록되었습니다.' };
  res.redirect('/hr/employees/' + employee_id);
});

// POST /hr/contracts/:id/delete
router.post('/contracts/:id/delete', (req, res) => {
  const contract = get('SELECT employee_id FROM hr_contracts WHERE id = ?', [req.params.id]);
  run('DELETE FROM hr_contracts WHERE id = ?', [req.params.id]);
  req.session.flash = { type: 'success', message: '계약이 삭제되었습니다.' };
  if (contract) return res.redirect('/hr/employees/' + contract.employee_id);
  res.redirect('/hr/employees');
});

// POST /hr/histories - 인사변동 등록
router.post('/histories', (req, res) => {
  const {
    employee_id, change_date, change_type,
    before_department, after_department,
    before_position, after_position,
    before_job_title, after_job_title,
    reason, approver, memo
  } = req.body;

  run(
    `INSERT INTO hr_histories
     (employee_id, change_date, change_type,
      before_department, after_department,
      before_position, after_position,
      before_job_title, after_job_title,
      reason, approver, memo, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      employee_id, change_date || null, change_type || null,
      before_department || null, after_department || null,
      before_position || null, after_position || null,
      before_job_title || null, after_job_title || null,
      reason || null, approver || null, memo || null,
      now(), now()
    ]
  );

  req.session.flash = { type: 'success', message: '인사변동이 등록되었습니다.' };
  res.redirect('/hr/employees/' + employee_id);
});

// POST /hr/histories/:id/delete
router.post('/histories/:id/delete', (req, res) => {
  const hist = get('SELECT employee_id FROM hr_histories WHERE id = ?', [req.params.id]);
  run('DELETE FROM hr_histories WHERE id = ?', [req.params.id]);
  req.session.flash = { type: 'success', message: '이력이 삭제되었습니다.' };
  if (hist) return res.redirect('/hr/employees/' + hist.employee_id);
  res.redirect('/hr/employees');
});

module.exports = router;
