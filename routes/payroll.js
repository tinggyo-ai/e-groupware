const express = require('express');
const router = express.Router();
const { run, get, all, now, today } = require('../database/db');
const { requireLogin, requireHrAccess } = require('./middleware');

router.use(requireLogin, requireHrAccess);

// GET /payroll - 급여관리 대시보드
router.get('/', (req, res) => {
  const thisMonth = today().slice(0, 7);

  const targetCount = (get(
    'SELECT COUNT(DISTINCT employee_id) as cnt FROM payroll_monthly_records WHERE pay_month = ?',
    [thisMonth]
  ) || {}).cnt || 0;

  const totals = get(
    'SELECT SUM(total_payment) as total_pay, SUM(total_deduction) as total_ded, SUM(net_payment) as net_pay FROM payroll_monthly_records WHERE pay_month = ?',
    [thisMonth]
  ) || {};

  const unconfirmedCount = (get(
    "SELECT COUNT(*) as cnt FROM payroll_monthly_records WHERE pay_month = ? AND payment_status NOT IN ('확정','지급완료')",
    [thisMonth]
  ) || {}).cnt || 0;

  const paidCount = (get(
    "SELECT COUNT(*) as cnt FROM payroll_monthly_records WHERE pay_month = ? AND payment_status = '지급완료'",
    [thisMonth]
  ) || {}).cnt || 0;

  res.render('payroll/index', {
    title: '급여관리',
    thisMonth,
    stats: {
      targetCount,
      totalPayment: totals.total_pay || 0,
      totalDeduction: totals.total_ded || 0,
      netPayment: totals.net_pay || 0,
      unconfirmedCount,
      paidCount
    }
  });
});

// GET /payroll/salaries - 연봉정보 목록
router.get('/salaries', (req, res) => {
  const salaries = all(`
    SELECT s.*, e.employee_no, e.name, e.position, d.name AS department_name
    FROM payroll_salary_standards s
    JOIN employees e ON s.employee_id = e.id
    LEFT JOIN departments d ON e.department_id = d.id
    ORDER BY e.employee_no
  `);
  const employees = all('SELECT id, employee_no, name FROM employees WHERE employment_status = ? ORDER BY employee_no', ['재직']);

  res.render('payroll/salaries', {
    title: '연봉정보 관리',
    salaries,
    employees
  });
});

// GET /payroll/salaries/new
router.get('/salaries/new', (req, res) => {
  const employees = all('SELECT id, employee_no, name FROM employees WHERE employment_status = ? ORDER BY employee_no', ['재직']);
  res.render('payroll/salary-form', {
    title: '연봉정보 등록',
    editSalary: null,
    employees
  });
});

// POST /payroll/salaries
router.post('/salaries', (req, res) => {
  const {
    employee_id, salary_type, annual_salary, monthly_base_salary,
    meal_allowance, car_allowance, position_allowance, fixed_allowance,
    other_allowance, apply_start_date, apply_end_date, approver, memo
  } = req.body;

  run(
    `INSERT INTO payroll_salary_standards
     (employee_id, salary_type, annual_salary, monthly_base_salary,
      meal_allowance, car_allowance, position_allowance, fixed_allowance,
      other_allowance, apply_start_date, apply_end_date, approver, memo, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      employee_id, salary_type || '연봉제',
      parseInt(annual_salary) || 0, parseInt(monthly_base_salary) || 0,
      parseInt(meal_allowance) || 0, parseInt(car_allowance) || 0,
      parseInt(position_allowance) || 0, parseInt(fixed_allowance) || 0,
      parseInt(other_allowance) || 0,
      apply_start_date || null, apply_end_date || null,
      approver || null, memo || null, now(), now()
    ]
  );

  req.session.flash = { type: 'success', message: '연봉정보가 등록되었습니다.' };
  res.redirect('/payroll/salaries');
});

// GET /payroll/salaries/:id/edit
router.get('/salaries/:id/edit', (req, res) => {
  const editSalary = get('SELECT * FROM payroll_salary_standards WHERE id = ?', [req.params.id]);
  if (!editSalary) return res.redirect('/payroll/salaries');
  const employees = all('SELECT id, employee_no, name FROM employees ORDER BY employee_no');
  res.render('payroll/salary-form', {
    title: '연봉정보 수정',
    editSalary,
    employees
  });
});

// POST /payroll/salaries/:id
router.post('/salaries/:id', (req, res) => {
  const {
    employee_id, salary_type, annual_salary, monthly_base_salary,
    meal_allowance, car_allowance, position_allowance, fixed_allowance,
    other_allowance, apply_start_date, apply_end_date, approver, memo
  } = req.body;

  run(
    `UPDATE payroll_salary_standards SET
     employee_id=?, salary_type=?, annual_salary=?, monthly_base_salary=?,
     meal_allowance=?, car_allowance=?, position_allowance=?, fixed_allowance=?,
     other_allowance=?, apply_start_date=?, apply_end_date=?, approver=?, memo=?, updated_at=?
     WHERE id=?`,
    [
      employee_id, salary_type || '연봉제',
      parseInt(annual_salary) || 0, parseInt(monthly_base_salary) || 0,
      parseInt(meal_allowance) || 0, parseInt(car_allowance) || 0,
      parseInt(position_allowance) || 0, parseInt(fixed_allowance) || 0,
      parseInt(other_allowance) || 0,
      apply_start_date || null, apply_end_date || null,
      approver || null, memo || null, now(),
      req.params.id
    ]
  );

  req.session.flash = { type: 'success', message: '연봉정보가 수정되었습니다.' };
  res.redirect('/payroll/salaries');
});

// GET /payroll/monthly - 월별 급여 목록
router.get('/monthly', (req, res) => {
  const { pay_month = '', name = '' } = req.query;
  let sql = `
    SELECT r.*, e.employee_no, e.name, e.position, d.name AS department_name
    FROM payroll_monthly_records r
    JOIN employees e ON r.employee_id = e.id
    LEFT JOIN departments d ON e.department_id = d.id
    WHERE 1=1
  `;
  const params = [];
  if (pay_month) { sql += ' AND r.pay_month = ?'; params.push(pay_month); }
  if (name) { sql += ' AND e.name LIKE ?'; params.push(`%${name}%`); }
  sql += ' ORDER BY r.pay_month DESC, e.employee_no';

  const records = all(sql, params);
  res.render('payroll/monthly', {
    title: '월별 급여',
    records,
    filters: { pay_month, name }
  });
});

// GET /payroll/monthly/new
router.get('/monthly/new', (req, res) => {
  const employees = all("SELECT id, employee_no, name FROM employees WHERE employment_status = '재직' ORDER BY employee_no");
  res.render('payroll/monthly-form', {
    title: '월급여 등록',
    editRecord: null,
    employees
  });
});

// POST /payroll/monthly
router.post('/monthly', (req, res) => {
  const {
    employee_id, pay_month, pay_date,
    base_salary, meal_allowance, position_allowance,
    overtime_pay, night_work_pay, holiday_work_pay,
    bonus, incentive, other_payment,
    national_pension, health_insurance, long_term_care,
    employment_insurance, income_tax, local_income_tax, other_deduction,
    payment_status, memo
  } = req.body;

  const pays = [base_salary, meal_allowance, position_allowance, overtime_pay,
    night_work_pay, holiday_work_pay, bonus, incentive, other_payment].map(v => parseInt(v) || 0);
  const deds = [national_pension, health_insurance, long_term_care,
    employment_insurance, income_tax, local_income_tax, other_deduction].map(v => parseInt(v) || 0);
  const total_payment = pays.reduce((a, b) => a + b, 0);
  const total_deduction = deds.reduce((a, b) => a + b, 0);
  const net_payment = total_payment - total_deduction;

  run(
    `INSERT INTO payroll_monthly_records
     (employee_id, pay_month, pay_date, base_salary, meal_allowance, position_allowance,
      overtime_pay, night_work_pay, holiday_work_pay, bonus, incentive, other_payment,
      total_payment, national_pension, health_insurance, long_term_care,
      employment_insurance, income_tax, local_income_tax, other_deduction,
      total_deduction, net_payment, payment_status, memo, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      employee_id, pay_month, pay_date || null,
      pays[0], pays[1], pays[2], pays[3], pays[4], pays[5], pays[6], pays[7], pays[8],
      total_payment,
      deds[0], deds[1], deds[2], deds[3], deds[4], deds[5], deds[6],
      total_deduction, net_payment,
      payment_status || '작성중', memo || null,
      now(), now()
    ]
  );

  req.session.flash = { type: 'success', message: '월급여가 등록되었습니다.' };
  res.redirect('/payroll/monthly');
});

// GET /payroll/monthly/:id - 상세
router.get('/monthly/:id', (req, res) => {
  const record = get(`
    SELECT r.*, e.employee_no, e.name, e.position, d.name AS department_name
    FROM payroll_monthly_records r
    JOIN employees e ON r.employee_id = e.id
    LEFT JOIN departments d ON e.department_id = d.id
    WHERE r.id = ?`, [req.params.id]);
  if (!record) return res.redirect('/payroll/monthly');

  res.render('payroll/monthly-detail', {
    title: '급여 상세',
    record
  });
});

// GET /payroll/monthly/:id/edit
router.get('/monthly/:id/edit', (req, res) => {
  const editRecord = get('SELECT * FROM payroll_monthly_records WHERE id = ?', [req.params.id]);
  if (!editRecord) return res.redirect('/payroll/monthly');
  const employees = all('SELECT id, employee_no, name FROM employees ORDER BY employee_no');
  res.render('payroll/monthly-form', {
    title: '월급여 수정',
    editRecord,
    employees
  });
});

// POST /payroll/monthly/:id
router.post('/monthly/:id', (req, res) => {
  const {
    employee_id, pay_month, pay_date,
    base_salary, meal_allowance, position_allowance,
    overtime_pay, night_work_pay, holiday_work_pay,
    bonus, incentive, other_payment,
    national_pension, health_insurance, long_term_care,
    employment_insurance, income_tax, local_income_tax, other_deduction,
    payment_status, memo
  } = req.body;

  const pays = [base_salary, meal_allowance, position_allowance, overtime_pay,
    night_work_pay, holiday_work_pay, bonus, incentive, other_payment].map(v => parseInt(v) || 0);
  const deds = [national_pension, health_insurance, long_term_care,
    employment_insurance, income_tax, local_income_tax, other_deduction].map(v => parseInt(v) || 0);
  const total_payment = pays.reduce((a, b) => a + b, 0);
  const total_deduction = deds.reduce((a, b) => a + b, 0);
  const net_payment = total_payment - total_deduction;

  run(
    `UPDATE payroll_monthly_records SET
     employee_id=?, pay_month=?, pay_date=?,
     base_salary=?, meal_allowance=?, position_allowance=?,
     overtime_pay=?, night_work_pay=?, holiday_work_pay=?,
     bonus=?, incentive=?, other_payment=?,
     total_payment=?, national_pension=?, health_insurance=?, long_term_care=?,
     employment_insurance=?, income_tax=?, local_income_tax=?, other_deduction=?,
     total_deduction=?, net_payment=?, payment_status=?, memo=?, updated_at=?
     WHERE id=?`,
    [
      employee_id, pay_month, pay_date || null,
      pays[0], pays[1], pays[2], pays[3], pays[4], pays[5], pays[6], pays[7], pays[8],
      total_payment,
      deds[0], deds[1], deds[2], deds[3], deds[4], deds[5], deds[6],
      total_deduction, net_payment,
      payment_status || '작성중', memo || null, now(),
      req.params.id
    ]
  );

  req.session.flash = { type: 'success', message: '월급여가 수정되었습니다.' };
  res.redirect('/payroll/monthly/' + req.params.id);
});

// POST /payroll/monthly/:id/delete
router.post('/monthly/:id/delete', (req, res) => {
  run('DELETE FROM payroll_monthly_records WHERE id = ?', [req.params.id]);
  req.session.flash = { type: 'success', message: '급여 기록이 삭제되었습니다.' };
  res.redirect('/payroll/monthly');
});

module.exports = router;
