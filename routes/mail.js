const express = require('express');
const nodemailer = require('nodemailer');
const POP3Client = require('poplib');
const { simpleParser } = require('mailparser');
const crypto = require('crypto');
const { get, run, now } = require('../database/db');
const { requireLogin } = require('./middleware');

const router = express.Router();
router.use(requireLogin);

// ── 암호화 헬퍼 ────────────────────────────────────────────────────────────
const ENC_KEY = Buffer.from(
  (process.env.MAIL_ENC_KEY || 'groupware-mail-default-key-32b!!').slice(0, 32)
);
const IV_LEN = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  const [ivHex, encHex] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENC_KEY, iv);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

// ── DB 헬퍼 ──────────────────────────────────────────────────────────────
function getMailSettings(userId) {
  return get('SELECT * FROM user_mail_settings WHERE user_id = ?', [userId]);
}

function uidHash(uid) {
  return crypto.createHash('sha256').update(String(uid)).digest('hex');
}

function isSeen(userId, uid) {
  return !!get('SELECT 1 FROM mail_seen WHERE user_id = ? AND uid_hash = ?', [userId, uidHash(uid)]);
}

function markSeen(userId, uid) {
  try {
    run('INSERT OR IGNORE INTO mail_seen (user_id, uid_hash) VALUES (?, ?)', [userId, uidHash(uid)]);
  } catch (e) {}
}

// ── POP3 Promise 래퍼 ──────────────────────────────────────────────────────
function pop3Connect(host, port, username, password) {
  return new Promise((resolve, reject) => {
    const client = new POP3Client(port, host, {
      ignoretlserrs: false,
      enabletls: port === 995,
      debug: false
    });

    const timer = setTimeout(() => {
      try { client.end(); } catch (e) {}
      reject(new Error('POP3 연결 시간 초과 (15초)'));
    }, 15000);

    client.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    client.on('connect', (status) => {
      if (!status) {
        clearTimeout(timer);
        reject(new Error('POP3 서버 연결 실패'));
        return;
      }
      client.login(username, password);
    });

    client.on('login', (status) => {
      clearTimeout(timer);
      if (status) resolve(client);
      else reject(new Error('인증 실패 — 메일 주소/비밀번호를 확인하세요.'));
    });
  });
}

function pop3Stat(client) {
  return new Promise((resolve, reject) => {
    client.once('stat', (status, returnValue) => {
      if (status) resolve(parseInt(returnValue.count) || 0);
      else reject(new Error('STAT 실패'));
    });
    client.stat();
  });
}

function pop3Uidl(client, msgnum) {
  return new Promise((resolve, reject) => {
    client.once('uidl', (status, _n, returnValue) => {
      if (status) resolve(returnValue || []);
      else reject(new Error('UIDL 실패'));
    });
    if (msgnum !== undefined) client.uidl(msgnum);
    else client.uidl();
  });
}

function pop3Top(client, msgnum) {
  return new Promise((resolve, reject) => {
    client.once('top', (status, _n, data) => {
      if (status) resolve(data || '');
      else reject(new Error('TOP 실패: msg ' + msgnum));
    });
    client.top(msgnum, 0);
  });
}

function pop3Retr(client, msgnum) {
  return new Promise((resolve, reject) => {
    client.once('retr', (status, _n, data) => {
      if (status) resolve(data || '');
      else reject(new Error('RETR 실패: msg ' + msgnum));
    });
    client.retr(msgnum);
  });
}

function pop3Quit(client) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { client.end(); } catch (e) {}
      resolve();
    }, 3000);
    try {
      client.once('quit', () => { clearTimeout(timer); resolve(); });
      client.quit();
    } catch (e) {
      clearTimeout(timer);
      resolve();
    }
  });
}

// ── 메일 설정 ──────────────────────────────────────────────────────────────
// GET /mail/settings
router.get('/settings', (req, res) => {
  const settings = getMailSettings(req.session.user.id);
  res.render('mail/settings', { title: '메일 설정', settings: settings || null });
});

// POST /mail/settings
router.post('/settings', async (req, res) => {
  const { mail_address, mail_password, imap_host, imap_port, smtp_host, smtp_port } = req.body;
  const userId = req.session.user.id;

  const pop3Host = imap_host || 'pop3s.hiworks.com';
  const pop3Port = parseInt(imap_port) || 995;
  const smtpHost = smtp_host || 'smtps.hiworks.com';
  const smtpPort = parseInt(smtp_port) || 587;

  let testClient;
  try {
    testClient = await pop3Connect(pop3Host, pop3Port, mail_address, mail_password);
    await pop3Quit(testClient);
  } catch (err) {
    return res.render('mail/settings', {
      title: '메일 설정',
      settings: {
        mail_address,
        imap_host: pop3Host,
        imap_port: pop3Port,
        smtp_host: smtpHost,
        smtp_port: smtpPort
      },
      error: 'POP3 연결 테스트 실패: ' + err.message
    });
  }

  let smtpWarning = null;
  try {
    const testTransporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: mail_address, pass: mail_password }
    });
    await testTransporter.verify();
  } catch (smtpErr) {
    smtpWarning = 'SMTP 연결 경고: ' + smtpErr.message;
  }

  const enc = encrypt(mail_password);
  const existing = get('SELECT id FROM user_mail_settings WHERE user_id = ?', [userId]);

  if (existing) {
    run(
      `UPDATE user_mail_settings
       SET mail_address=?, mail_password_enc=?, imap_host=?, imap_port=?,
           smtp_host=?, smtp_port=?, is_configured=1, updated_at=?
       WHERE user_id=?`,
      [mail_address, enc, pop3Host, pop3Port, smtpHost, smtpPort, now(), userId]
    );
  } else {
    run(
      `INSERT INTO user_mail_settings
       (user_id, mail_address, mail_password_enc, imap_host, imap_port, smtp_host, smtp_port, is_configured, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [userId, mail_address, enc, pop3Host, pop3Port, smtpHost, smtpPort, now(), now()]
    );
  }

  req.session.flash = smtpWarning
    ? { type: 'warning', message: '메일 설정이 저장되었습니다. ' + smtpWarning }
    : { type: 'success', message: '메일 설정이 저장되었습니다.' };
  res.redirect('/mail');
});

// ── 메일 쓰기 ──────────────────────────────────────────────────────────────
// GET /mail/compose
router.get('/compose', (req, res) => {
  const settings = getMailSettings(req.session.user.id);
  if (!settings || !settings.is_configured) return res.redirect('/mail/settings');
  res.render('mail/compose', {
    title: '메일 쓰기',
    to: req.query.to || '',
    subject: req.query.subject || '',
    body: '',
    settings
  });
});

// POST /mail/compose
router.post('/compose', async (req, res) => {
  const settings = getMailSettings(req.session.user.id);
  if (!settings || !settings.is_configured) return res.redirect('/mail/settings');

  const { to, subject, body } = req.body;

  const transporter = nodemailer.createTransport({
    host: settings.smtp_host,
    port: settings.smtp_port,
    secure: settings.smtp_port === 465,
    auth: {
      user: settings.mail_address,
      pass: decrypt(settings.mail_password_enc)
    }
  });

  try {
    await transporter.sendMail({
      from: `"${req.session.user.name}" <${settings.mail_address}>`,
      to,
      subject,
      text: body,
      html: body.replace(/\n/g, '<br>')
    });
    req.session.flash = { type: 'success', message: '메일이 발송되었습니다.' };
    res.redirect('/mail');
  } catch (err) {
    req.session.flash = { type: 'danger', message: 'SMTP 발송 오류: ' + err.message };
    res.render('mail/compose', { title: '메일 쓰기', to, subject, body, settings, error: err.message });
  }
});

// ── 받은 편지함 ────────────────────────────────────────────────────────────
// GET /mail
router.get('/', async (req, res) => {
  const settings = getMailSettings(req.session.user.id);
  if (!settings || !settings.is_configured) return res.redirect('/mail/settings');

  const userId = req.session.user.id;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const PAGE_SIZE = 20;

  let client;
  try {
    const pass = decrypt(settings.mail_password_enc);
    client = await pop3Connect(settings.imap_host, settings.imap_port, settings.mail_address, pass);

    const total = await pop3Stat(client);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const messages = [];

    if (total > 0) {
      const uidlMap = await pop3Uidl(client);

      // 최신 메시지가 높은 번호 — 내림차순으로 20개
      const seqTo = Math.max(1, total - (page - 1) * PAGE_SIZE);
      const seqFrom = Math.max(1, seqTo - PAGE_SIZE + 1);

      for (let num = seqTo; num >= seqFrom; num--) {
        try {
          const rawHeaders = await pop3Top(client, num);
          const uidl = uidlMap[num] || String(num);
          const parsed = await simpleParser(rawHeaders);

          messages.push({
            uid: num,
            subject: parsed.subject || '(제목 없음)',
            from: parsed.from?.value?.[0]?.address || '',
            fromName: parsed.from?.value?.[0]?.name || parsed.from?.value?.[0]?.address || '',
            date: parsed.date,
            seen: isSeen(userId, uidl)
          });
        } catch (e) {
          // 개별 메시지 오류 건너뜀
        }
      }
    }

    await pop3Quit(client);
    res.render('mail/index', { title: '받은 편지함', messages, page, totalPages, total, settings });
  } catch (err) {
    if (client) { try { await pop3Quit(client); } catch (e) {} }
    res.render('mail/index', {
      title: '받은 편지함',
      messages: [],
      page: 1,
      totalPages: 1,
      total: 0,
      settings,
      error: 'POP3 연결 오류: ' + err.message
    });
  }
});

// ── 메일 상세 ──────────────────────────────────────────────────────────────
// GET /mail/:msgnum
router.get('/:msgnum', async (req, res) => {
  const settings = getMailSettings(req.session.user.id);
  if (!settings || !settings.is_configured) return res.redirect('/mail/settings');

  const msgnum = parseInt(req.params.msgnum);
  if (!msgnum) return res.redirect('/mail');

  const userId = req.session.user.id;
  let client;

  try {
    const pass = decrypt(settings.mail_password_enc);
    client = await pop3Connect(settings.imap_host, settings.imap_port, settings.mail_address, pass);

    const uidlMap = await pop3Uidl(client, msgnum);
    const uidl = uidlMap[msgnum] || String(msgnum);

    const rawSource = await pop3Retr(client, msgnum);
    await pop3Quit(client);

    if (!rawSource) {
      req.session.flash = { type: 'danger', message: '메일을 찾을 수 없습니다.' };
      return res.redirect('/mail');
    }

    markSeen(userId, uidl);
    const parsed = await simpleParser(rawSource);

    res.render('mail/read', {
      title: parsed.subject || '(제목 없음)',
      mail: {
        uid: msgnum,
        subject: parsed.subject || '(제목 없음)',
        from: parsed.from?.text || '',
        to: parsed.to?.text || '',
        date: parsed.date,
        html: parsed.html || null,
        text: parsed.text || '',
        attachments: (parsed.attachments || []).map(a => ({
          filename: a.filename || '첨부파일',
          size: a.size || 0,
          contentType: a.contentType
        }))
      }
    });
  } catch (err) {
    if (client) { try { await pop3Quit(client); } catch (e) {} }
    req.session.flash = { type: 'danger', message: '메일 로드 오류: ' + err.message };
    res.redirect('/mail');
  }
});

module.exports = router;
