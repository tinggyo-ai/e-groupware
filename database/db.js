const path = require('path');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'groupware.sqlite');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');

function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function now() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 19);
}

function today() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function getSetting(key) {
  const row = get('SELECT setting_value FROM system_settings WHERE setting_key = ?', [key]);
  return row ? row.setting_value : null;
}

function setSetting(key, value) {
  const existing = get('SELECT id FROM system_settings WHERE setting_key = ?', [key]);
  if (existing) {
    run('UPDATE system_settings SET setting_value = ?, updated_at = ? WHERE setting_key = ?', [value, now(), key]);
  } else {
    run('INSERT INTO system_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?)', [key, value, now()]);
  }
}

function logAdmin(adminUserId, action, targetType, targetId, description) {
  run(
    'INSERT INTO admin_logs (admin_user_id, action, target_type, target_id, description, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [adminUserId, action, targetType, targetId || null, description || '', now()]
  );
}

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      manager_user_id INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      department_id INTEGER,
      position TEXT,
      role TEXT NOT NULL DEFAULT 'employee',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (department_id) REFERENCES departments(id)
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      work_date TEXT NOT NULL,
      check_in_time TEXT,
      check_out_time TEXT,
      status TEXT DEFAULT '출근 전',
      memo TEXT,
      modified_by INTEGER,
      modified_reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, work_date),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS approval_forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_name TEXT NOT NULL,
      form_type TEXT,
      form_schema TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      amount INTEGER DEFAULT 0,
      form_id INTEGER,
      requester_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT '임시저장',
      current_step INTEGER DEFAULT 1,
      total_steps INTEGER DEFAULT 1,
      reject_reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (form_id) REFERENCES approval_forms(id),
      FOREIGN KEY (requester_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS approval_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      approval_id INTEGER NOT NULL,
      approver_id INTEGER NOT NULL,
      step_order INTEGER NOT NULL,
      status TEXT DEFAULT '대기',
      comment TEXT,
      approved_at TEXT,
      FOREIGN KEY (approval_id) REFERENCES approvals(id),
      FOREIGN KEY (approver_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      permission_type TEXT DEFAULT 'public',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      is_notice INTEGER DEFAULT 0,
      is_pinned INTEGER DEFAULT 0,
      is_hidden INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (board_id) REFERENCES boards(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      file_name TEXT,
      file_path TEXT,
      file_size INTEGER,
      uploaded_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_key TEXT NOT NULL UNIQUE,
      setting_value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS work_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      log_type TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      department_id INTEGER,
      position TEXT,
      entry_date TEXT,
      period_start TEXT,
      period_end TEXT,
      target_month TEXT,
      summary TEXT,
      content_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT '임시저장',
      review_comment TEXT,
      reviewed_by INTEGER,
      reviewed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (department_id) REFERENCES departments(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_no TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      english_name TEXT,
      department_id INTEGER,
      team TEXT,
      position TEXT,
      job_title TEXT,
      employment_type TEXT DEFAULT '정규직',
      employment_status TEXT DEFAULT '재직',
      hire_date TEXT,
      resignation_date TEXT,
      contract_start_date TEXT,
      contract_end_date TEXT,
      probation_start TEXT,
      probation_end TEXT,
      birthdate TEXT,
      gender TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      emergency_name TEXT,
      emergency_relation TEXT,
      emergency_phone TEXT,
      education TEXT,
      career_years INTEGER DEFAULT 0,
      job_description TEXT,
      memo TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (department_id) REFERENCES departments(id)
    );

    CREATE TABLE IF NOT EXISTS hr_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      contract_title TEXT,
      contract_type TEXT,
      contract_start_date TEXT,
      contract_end_date TEXT,
      department TEXT,
      position TEXT,
      job_description TEXT,
      work_location TEXT,
      work_time TEXT,
      salary_amount INTEGER DEFAULT 0,
      contract_date TEXT,
      signed_status TEXT DEFAULT '미서명',
      file_path TEXT,
      special_terms TEXT,
      memo TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS hr_histories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      change_date TEXT,
      change_type TEXT,
      before_department TEXT,
      after_department TEXT,
      before_position TEXT,
      after_position TEXT,
      before_job_title TEXT,
      after_job_title TEXT,
      reason TEXT,
      approver TEXT,
      file_path TEXT,
      memo TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS payroll_salary_standards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      salary_type TEXT DEFAULT '연봉제',
      annual_salary INTEGER DEFAULT 0,
      monthly_base_salary INTEGER DEFAULT 0,
      meal_allowance INTEGER DEFAULT 0,
      car_allowance INTEGER DEFAULT 0,
      position_allowance INTEGER DEFAULT 0,
      fixed_allowance INTEGER DEFAULT 0,
      other_allowance INTEGER DEFAULT 0,
      non_taxable_amount INTEGER DEFAULT 0,
      apply_start_date TEXT,
      apply_end_date TEXT,
      approver TEXT,
      approval_date TEXT,
      memo TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS payroll_monthly_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      pay_month TEXT NOT NULL,
      pay_date TEXT,
      base_salary INTEGER DEFAULT 0,
      meal_allowance INTEGER DEFAULT 0,
      position_allowance INTEGER DEFAULT 0,
      overtime_pay INTEGER DEFAULT 0,
      night_work_pay INTEGER DEFAULT 0,
      holiday_work_pay INTEGER DEFAULT 0,
      bonus INTEGER DEFAULT 0,
      incentive INTEGER DEFAULT 0,
      other_payment INTEGER DEFAULT 0,
      total_payment INTEGER DEFAULT 0,
      national_pension INTEGER DEFAULT 0,
      health_insurance INTEGER DEFAULT 0,
      long_term_care INTEGER DEFAULT 0,
      employment_insurance INTEGER DEFAULT 0,
      income_tax INTEGER DEFAULT 0,
      local_income_tax INTEGER DEFAULT 0,
      other_deduction INTEGER DEFAULT 0,
      total_deduction INTEGER DEFAULT 0,
      net_payment INTEGER DEFAULT 0,
      payment_status TEXT DEFAULT '작성중',
      payslip_issued INTEGER DEFAULT 0,
      memo TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS payroll_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      apply_month TEXT,
      adjustment_type TEXT,
      item_name TEXT,
      amount INTEGER DEFAULT 0,
      taxable_status TEXT DEFAULT '과세',
      reason TEXT,
      approver TEXT,
      file_path TEXT,
      memo TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS user_mail_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      mail_address TEXT,
      mail_password_enc TEXT,
      imap_host TEXT DEFAULT 'pop3s.hiworks.com',
      imap_port INTEGER DEFAULT 995,
      smtp_host TEXT DEFAULT 'smtps.hiworks.com',
      smtp_port INTEGER DEFAULT 587,
      is_configured INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS mail_seen (
      user_id INTEGER NOT NULL,
      uid_hash TEXT NOT NULL,
      PRIMARY KEY (user_id, uid_hash)
    );
  `);

  seedData();
}

function seedData() {
  if (!get('SELECT id FROM departments WHERE name = ?', ['IT운영팀'])) {
    run('INSERT INTO departments (name, sort_order) VALUES (?, ?)', ['IT운영팀', 1]);
    run('INSERT INTO departments (name, sort_order) VALUES (?, ?)', ['경영지원팀', 2]);
  }

  const itDept = get('SELECT id FROM departments WHERE name = ?', ['IT운영팀']);
  const adminHash = bcrypt.hashSync('1234', 10);
  const userHash = bcrypt.hashSync('1234', 10);
  const managerHash = bcrypt.hashSync('1234', 10);

  const users = [
    ['admin', adminHash, '시스템관리자', 'changgyo@cgessence.co.kr', '02-0000-0000', itDept.id, '관리자', 'admin'],
    ['user01', userHash, '김창교', 'changgyo.kim@example.com', '010-1111-2222', itDept.id, '차장', 'employee'],
    ['manager01', managerHash, '홍길동', 'gildong.hong@example.com', '010-3333-4444', itDept.id, '팀장', 'manager']
  ];

  users.forEach((user) => {
    const existing = get('SELECT id, password_hash FROM users WHERE username = ?', [user[0]]);
    if (!existing) {
      run(
        `INSERT INTO users
         (username, password_hash, name, email, phone, department_id, position, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        [...user, now(), now()]
      );
    } else {
      // 비밀번호가 현재 seed 값과 다르면 업데이트
      const pwKey = user[0] === 'admin' ? '1234' : '1234';
      if (!bcrypt.compareSync(pwKey, existing.password_hash || '')) {
        run('UPDATE users SET password_hash = ? WHERE id = ?', [user[1], existing.id]);
      }
    }
  });

  const manager = get('SELECT id FROM users WHERE username = ?', ['manager01']);
  run('UPDATE departments SET manager_user_id = ? WHERE id = ?', [manager.id, itDept.id]);

  ['일반 품의서', '지출결의서', '휴가신청서', '구매요청서', '출장신청서'].forEach((name) => {
    if (!get('SELECT id FROM approval_forms WHERE form_name = ?', [name])) {
      run('INSERT INTO approval_forms (form_name, form_type, form_schema, is_active, created_at) VALUES (?, ?, ?, 1, ?)', [
        name,
        name.replace('서', ''),
        JSON.stringify({ fields: ['title', 'content', 'amount', 'attachments'] }),
        now()
      ]);
    }
  });

  if (!get('SELECT id FROM boards WHERE name = ?', ['공지사항'])) {
    run('INSERT INTO boards (name, description, permission_type, created_at) VALUES (?, ?, ?, ?)', [
      '공지사항',
      '회사 공지와 중요 안내',
      'public',
      now()
    ]);
    run('INSERT INTO boards (name, description, permission_type, created_at) VALUES (?, ?, ?, ?)', [
      '자유게시판',
      '직원 커뮤니케이션 공간',
      'public',
      now()
    ]);
  }

  const noticeBoard = get('SELECT id FROM boards WHERE name = ?', ['공지사항']);
  const freeBoard = get('SELECT id FROM boards WHERE name = ?', ['자유게시판']);
  const admin = get('SELECT id FROM users WHERE username = ?', ['admin']);
  const employee = get('SELECT id FROM users WHERE username = ?', ['user01']);

  if (!get('SELECT id FROM posts WHERE title = ?', ['그룹웨어 MVP 오픈 안내'])) {
    run(
      'INSERT INTO posts (board_id, user_id, title, content, is_notice, is_pinned, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)',
      [noticeBoard.id, admin.id, '그룹웨어 MVP 오픈 안내', '출퇴근 체크, 결재, 게시판, 조직도를 사용할 수 있습니다.', now(), now()]
    );
    run(
      'INSERT INTO posts (board_id, user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [freeBoard.id, employee.id, '첫 게시글입니다', '업무 공유와 소통은 자유게시판을 활용해 주세요.', now(), now()]
    );
  }

  if (!getSetting('company_name') || getSetting('company_name') === '스마트 그룹웨어') setSetting('company_name', 'E-Groupware');
  else setSetting('company_name', getSetting('company_name'));
  run(`UPDATE users SET email = 'changgyo@cgessence.co.kr' WHERE username = 'admin' AND (email = 'admin@example.com' OR email IS NULL OR email = '')`);
  setSetting('work_start_time', getSetting('work_start_time') || '09:00');
  setSetting('work_end_time', getSetting('work_end_time') || '18:00');
  seedEmployees();
  seedWorkLogs();
}

function seedEmployees() {
  if (get('SELECT id FROM employees LIMIT 1')) return;

  const itDept = get('SELECT id FROM departments WHERE name = ?', ['IT운영팀']);
  const mgmtDept = get('SELECT id FROM departments WHERE name = ?', ['경영지원팀']);
  const itId = itDept ? itDept.id : null;
  const mgmtId = mgmtDept ? mgmtDept.id : null;

  const empData = [
    ['EMP001', '김철수', itId, '과장', '정규직', '재직', '2022-03-01', 'chulsoo@example.com', '010-1234-5678'],
    ['EMP002', '이영희', mgmtId, '대리', '정규직', '재직', '2023-06-01', 'younghee@example.com', null],
    ['EMP003', '박민준', itId, '사원', '계약직', '재직', '2024-01-15', 'minjun@example.com', null]
  ];

  empData.forEach(([emp_no, name, dept_id, pos, emp_type, emp_status, hire_date, email, phone]) => {
    if (!get('SELECT id FROM employees WHERE employee_no = ?', [emp_no])) {
      run(
        `INSERT INTO employees
         (employee_no, name, department_id, position, employment_type, employment_status, hire_date, email, phone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [emp_no, name, dept_id, pos, emp_type, emp_status, hire_date, email, phone || null, now(), now()]
      );
    }
  });

  const emp1 = get('SELECT id FROM employees WHERE employee_no = ?', ['EMP001']);
  const emp2 = get('SELECT id FROM employees WHERE employee_no = ?', ['EMP002']);
  const emp3 = get('SELECT id FROM employees WHERE employee_no = ?', ['EMP003']);

  if (emp1 && !get('SELECT id FROM payroll_salary_standards WHERE employee_id = ?', [emp1.id])) {
    run(
      `INSERT INTO payroll_salary_standards
       (employee_id, salary_type, annual_salary, monthly_base_salary, meal_allowance, apply_start_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [emp1.id, '연봉제', 52000000, 4000000, 100000, '2024-01-01', now(), now()]
    );
  }
  if (emp2 && !get('SELECT id FROM payroll_salary_standards WHERE employee_id = ?', [emp2.id])) {
    run(
      `INSERT INTO payroll_salary_standards
       (employee_id, salary_type, annual_salary, monthly_base_salary, meal_allowance, apply_start_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [emp2.id, '연봉제', 42000000, 3200000, 100000, '2024-01-01', now(), now()]
    );
  }
  if (emp3 && !get('SELECT id FROM payroll_salary_standards WHERE employee_id = ?', [emp3.id])) {
    run(
      `INSERT INTO payroll_salary_standards
       (employee_id, salary_type, annual_salary, monthly_base_salary, meal_allowance, apply_start_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [emp3.id, '월급제', 30000000, 2500000, 0, '2024-01-15', now(), now()]
    );
  }

  const payMonth = '2026-05';
  if (emp1 && !get('SELECT id FROM payroll_monthly_records WHERE employee_id = ? AND pay_month = ?', [emp1.id, payMonth])) {
    run(
      `INSERT INTO payroll_monthly_records
       (employee_id, pay_month, base_salary, meal_allowance, total_payment, national_pension, health_insurance, employment_insurance, income_tax, total_deduction, net_payment, payment_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [emp1.id, payMonth, 4000000, 100000, 4100000, 184500, 143650, 36900, 100000, 465050, 3634950, '확정', now(), now()]
    );
  }
  if (emp2 && !get('SELECT id FROM payroll_monthly_records WHERE employee_id = ? AND pay_month = ?', [emp2.id, payMonth])) {
    run(
      `INSERT INTO payroll_monthly_records
       (employee_id, pay_month, base_salary, meal_allowance, total_payment, national_pension, health_insurance, employment_insurance, income_tax, total_deduction, net_payment, payment_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [emp2.id, payMonth, 3200000, 100000, 3300000, 148500, 115650, 29700, 75000, 368850, 2931150, '지급완료', now(), now()]
    );
  }
}

function seedWorkLogs() {
  if (get('SELECT id FROM work_logs LIMIT 1')) return;

  const employee = get('SELECT * FROM users WHERE username = ?', ['user01']);
  const manager = get('SELECT * FROM users WHERE username = ?', ['manager01']);
  if (!employee || !manager) return;

  const rows = [
    {
      log_type: 'daily',
      user: employee,
      entry_date: today(),
      summary: '그룹웨어 사용자 문의 응대 및 게시판 기능 점검',
      status: '제출완료',
      content: {
        today_work: '사용자 문의 응대\n게시판 권한 확인\n조직도 데이터 점검',
        resolved_work: '공지사항 고정 표시 확인 완료',
        issues: '특이 이슈 없음',
        unfinished_work: '모바일 목록 간격 추가 점검 필요',
        tomorrow_plan: '전자결재 승인 흐름 테스트',
        cooperation: '부서별 사용자 명단 확인 요청',
        note: '샘플 일일업무일지'
      }
    },
    {
      log_type: 'weekly',
      user: manager,
      period_start: today(),
      period_end: today(),
      summary: 'IT운영팀 그룹웨어 MVP 안정화 작업',
      status: '검토완료',
      review_comment: '주요 업무 정리가 명확합니다.',
      content: {
        weekly_summary: '출퇴근, 사용자 관리, 게시판 기능 안정화',
        monday_work: '사용자 관리 화면 점검',
        tuesday_work: '근태 기능 테스트',
        wednesday_work: '전자결재 샘플 문서 확인',
        thursday_work: '게시판 UI 정리',
        friday_work: '조직도 검색 확인',
        completed: '기본 메뉴 구성 완료',
        in_progress: '업무일지 기능 추가 검토',
        issues: '메일 연동은 별도 SMTP 설정 필요',
        next_week_plan: '관리자 통계 개선',
        note: '샘플 주간업무일지'
      }
    },
    {
      log_type: 'monthly',
      user: employee,
      target_month: today().slice(0, 7),
      summary: '월간 시스템 운영 현황 정리',
      status: '임시저장',
      content: {
        monthly_summary: 'MVP 기능 점검 및 개선사항 취합',
        processed_count: '12',
        completed: '기본 사용자/부서/근태 관리 확인',
        in_progress: '업무일지 및 관리자 편의 기능 개선',
        issues: '첨부파일 기능은 후속 단계 필요',
        improvements: '좌측 메뉴와 목록 정렬 기능 개선',
        next_month_plan: '알림과 메일 연동 검토',
        special_note: '특이사항 없음',
        note: '샘플 월간업무일지'
      }
    }
  ];

  rows.forEach((item) => {
    run(
      `INSERT INTO work_logs
       (log_type, user_id, department_id, position, entry_date, period_start, period_end, target_month, summary, content_json, status, review_comment, reviewed_by, reviewed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.log_type,
        item.user.id,
        item.user.department_id,
        item.user.position,
        item.entry_date || null,
        item.period_start || null,
        item.period_end || null,
        item.target_month || null,
        item.summary,
        JSON.stringify(item.content),
        item.status,
        item.review_comment || null,
        item.status === '검토완료' ? manager.id : null,
        item.status === '검토완료' ? now() : null,
        now(),
        now()
      ]
    );
  });
}

module.exports = {
  db,
  run,
  get,
  all,
  now,
  today,
  initDatabase,
  getSetting,
  setSetting,
  logAdmin
};
