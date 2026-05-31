const express = require('express');
const bcrypt = require('bcryptjs');
const { get } = require('../database/db');

const router = express.Router();

router.get('/', (req, res) => {
  res.redirect(req.session.user ? '/dashboard' : '/login');
});

router.get('/login', (req, res) => {
  res.render('login', { title: '로그인' });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = get(
    `SELECT u.*, d.name AS department_name
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.username = ? AND u.status = 'active'`,
    [username]
  );

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    req.session.flash = { type: 'danger', message: '아이디 또는 비밀번호가 올바르지 않습니다.' };
    return res.redirect('/login');
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    departmentId: user.department_id,
    departmentName: user.department_name,
    position: user.position
  };
  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
