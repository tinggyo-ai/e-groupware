const express = require('express');
const path = require('path');
const session = require('express-session');
const { initDatabase, getSetting } = require('./database/db');

const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employee');
const adminRoutes = require('./routes/admin');
const workLogRoutes = require('./routes/workLogs');
const hrRoutes = require('./routes/hr');
const payrollRoutes = require('./routes/payroll');
const mailRoutes = require('./routes/mail');

const app = express();
const PORT = process.env.PORT || 3000;

initDatabase();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'groupware-mvp-local-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 }
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.currentPath = req.path;
  res.locals.companyName = getSetting('company_name') || 'E-Groupware';
  res.locals.outlookUrl = 'https://outlook.office.com';
  res.locals.itReportUrl = 'https://it-manager.fly.dev/report';
  res.locals.messengerUrl = process.env.MESSENGER_WEB_URL || 'https://e-messenger.fly.dev';
  res.locals.messengerLaunchUrl = process.env.MESSENGER_LAUNCH_URL || 'emessenger://open';
  res.locals.messengerInstallUrl = process.env.MESSENGER_INSTALL_URL || 'https://e-messenger.fly.dev/download/windows';
  res.locals.assetMgmtUrl = 'http://localhost:3000';
  res.locals.securityUrl = 'http://127.0.0.1:5080';
  res.locals.adminEmail = getSetting('admin_email') || '';
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

app.use('/', authRoutes);
app.use('/', workLogRoutes);
app.use('/', employeeRoutes);
app.use('/admin', adminRoutes);
app.use('/hr', hrRoutes);
app.use('/payroll', payrollRoutes);
app.use('/mail', mailRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: '페이지 없음', message: '요청하신 페이지를 찾을 수 없습니다.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: '오류', message: '처리 중 오류가 발생했습니다.' });
});

app.listen(PORT, () => {
  console.log(`Groupware MVP running at http://localhost:${PORT}`);
});
