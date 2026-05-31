function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.session.flash = { type: 'warning', message: '로그인이 필요합니다.' };
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    req.session.flash = { type: 'danger', message: '관리자 권한이 필요합니다.' };
    return res.redirect('/dashboard');
  }
  next();
}

function requireApprover(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (!['admin', 'manager'].includes(req.session.user.role)) {
    req.session.flash = { type: 'danger', message: '결재 권한이 필요합니다.' };
    return res.redirect('/approvals');
  }
  next();
}

function requireHrAccess(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  const role = req.session.user?.role;
  if (!role || !['admin', 'hr', 'payroll'].includes(role)) {
    req.session.flash = { type: 'danger', message: '접근 권한이 없습니다.' };
    return res.redirect('/dashboard');
  }
  next();
}

module.exports = { requireLogin, requireAdmin, requireApprover, requireHrAccess };
