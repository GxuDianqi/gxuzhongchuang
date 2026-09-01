/* ========================================================
 * auth.login.js — 登录页逻辑（双 Tab：密码登录优先 + OTP 备选）
 *
 * 【Tab 1 · 默认】邮箱 + 密码：所有已设置好密码的用户通用（学生/管理员）
 *                  → 忘记密码点底部链接，邮箱发重置邮件
 * 【Tab 2 · 备选】邮箱 + 8 位验证码 OTP：新生首次登录 = 自动注册 + 验证邮箱
 *                  → 登录成功后进入首页，再从 CTA 或右上角进入报名表 / 设置密码
 *
 * 附加：
 * ======================================================== */
import { supabase, showAlert, hideAlert, setLoading, isCurrentUserAdmin } from './supabase-init.js';

// ---------- DOM ----------
const alertEl         = document.getElementById('alert');
const subEl           = document.getElementById('form-sub');

// 双 Tab 按钮
const tabBtns         = document.querySelectorAll('.auth-tab-btn[data-auth-tab]');

// OTP 表单
const otpForm         = document.getElementById('otp-form');
const otpEmailInput   = document.getElementById('otp-email');
const otpStepEmailBox = document.getElementById('otp-step-email');
const otpStepCodeBox  = document.getElementById('otp-step-code');
const otpTokenInput   = document.getElementById('otp-token');
const otpSubmitBtn    = document.getElementById('otp-submit-btn');
const resendLink      = document.getElementById('resend-link');
const resendCountdown = document.getElementById('resend-countdown');
const otpHintLine     = document.getElementById('otp-hint-line');

// 密码表单
const pwdForm         = document.getElementById('password-form');
const pwdEmailInput   = document.getElementById('pwd-email');
const pwdPwdInput     = document.getElementById('pwd-password');
const pwdSubmitBtn    = document.getElementById('pwd-submit-btn');
const forgotLink      = document.getElementById('forgot-link');

// OTP 状态机
let otpPhase = 'send'; // 'send' | 'verify'
let resendTimer = null;
let resendLeft  = 0;

// ---------- 工具：错误翻译 ----------
function friendlyErrMsg(err) {
  const raw    = (err && err.message) ? err.message : String(err || '操作失败，请重试');
  const status = (err && err.status) || 0;
  const code   = (err && err.code)   || '';

  if ((status === 500 || /\/auth\/v1\/(token|otp)/i.test(raw)) &&
      raw.includes('Database error querying schema')) {
    return (
      '🚨 Supabase 认证服务还没就绪（平台 500）：\n' +
      '   ① 项目首页灯必须是绿色 Healthy，否则等 2-5 分钟恢复\n' +
      '   ② Auth → Users 页要能正常加载列表\n' +
      '   ③ 还是不行就用 Add user 方式重建管理员账号'
    );
  }
  if (String(code).includes('42501') || /permission|policy.*violation/i.test(raw)) {
    return '❌ 权限被拒（RLS）：请重新执行 schema.sql，并确认当前账号 is_admin=true。';
  }
  if (/infinite recursion/i.test(raw)) {
    return '❌ RLS 策略递归：请重新执行"清空+重建 4 条无递归策略"的 SQL。';
  }
  if (raw.includes('Invalid login credentials')) {
    return '❌ 邮箱或密码不正确（注意区分大小写）。<br/>如果还未设置密码，请切换到「邮箱验证码登录」Tab，首次登录后再设置密码。';
  }
  if (/Email not confirmed|邮箱.*?验证/i.test(raw)) {
    return '⚠️ 邮箱尚未完成验证：请切换到「邮箱验证码登录」Tab，先完成 6 位码验证（设置密码也要求邮箱先验证）。';
  }
  if (/Email rate limit|rate.*limit/i.test(raw)) {
    return '⏳ 邮件发送频率超限：① 请 1 分钟后重试；② 推荐在 Supabase → Auth → URL/SMTP 配置自定义 SMTP 解除限流。';
  }
  if (/otp.*(expired|invalid|mismatch)|验证码.*(过期|错误|不匹配)/i.test(raw)) {
    return '❌ 验证码已过期或错误：请重新点"发送验证码"获取新的 8 位码。';
  }
  return '❌ ' + raw;
}

// ---------- 读取并校验 redirect 参数 ----------
function getSafeRedirect() {
  try {
    const params = new URLSearchParams(location.search);
    const raw = params.get('redirect');
    if (!raw) return null;
    const decoded = decodeURIComponent(raw).trim();
    if (!decoded) return null;
    if (/^(https?:|\/\/|ftp:|data:|javascript:)/i.test(decoded)) return null;
    if (decoded.includes('@')) return null;
    if (!/^(\/|[\w.-]+\.html(\?|#|$))/.test(decoded)) return null;
    return decoded;
  } catch (_) { return null; }
}

// ---------- 登录成功后统一处理 ----------
async function afterLoginSuccess(email, sourceHint) {
  // 刷新 session，让 set_admin 的 app_metadata 进入 JWT
  const refreshed = await supabase.auth.refreshSession();
  if (refreshed.error) throw refreshed.error;

  const admin    = await isCurrentUserAdmin();
  const redirect = getSafeRedirect();
  // 策略：
  //   · 管理员 → 永远跳 admin.html（优先级最高）
  //   · 有 redirect 参数 → 跳 redirect（从报名页/个人中心被踢过来时）
  //   · 其他 → 都跳 index.html 首页（给用户选择权：先逛/先设密码/去点立即报名）
  //     【2026-09-01 调整】OTP 不再强制跳报名表，首次登录直接进首页自由浏览
  //                       报名按钮在首页 CTA / 顶部导航栏 / 用户下拉菜单随时可达
  let target;
  if (admin) target = 'admin.html';
  else if (redirect) target = redirect;
  else target = 'index.html';

  showAlert(alertEl, 'success', admin
    ? `✅ ${sourceHint}：管理员登录成功，正在进入审批后台...`
    : `✅ ${sourceHint}：登录成功，正在跳转首页...<br/>` +
      `<span style="font-size:0.88rem;">进入后可点击右上角「填写报名表」报名 / 或到「修改密码」设置登录密码。</span>`);

  setTimeout(() => { location.href = target; }, 1100);
}

// ---------- Tab 切换：密码 ↔ OTP ----------
let currentMode = 'password';
function applyMode(nextMode, { focusInput = true } = {}) {
  currentMode = nextMode;
  hideAlert(alertEl);

  // 1) Tab 激活态
  tabBtns.forEach(b => {
    const match = b.getAttribute('data-auth-tab') === nextMode;
    b.classList.toggle('active', match);
    b.setAttribute('aria-selected', match ? 'true' : 'false');
  });

  if (nextMode === 'password') {
    subEl.textContent = '已报名同学请直接登录；忘记密码点下方"邮箱重置"。新生首次登录请切换到右侧「邮箱验证码」Tab。';
    pwdForm.style.display   = 'block';
    otpForm.style.display   = 'none';
    otpHintLine.style.display = 'none';
    forgotLink.style.display = 'inline';
    if (focusInput) setTimeout(() => (pwdPwdInput.value ? pwdPwdInput.focus() : pwdEmailInput.focus()), 50);
    return;
  }

  // OTP 模式
  subEl.textContent = '新生首次登录即自动注册并验证邮箱。请使用广西大学在校邮箱或常用邮箱接收 8 位验证码。';
  pwdForm.style.display   = 'none';
  otpForm.style.display   = 'block';
  otpHintLine.style.display = 'block';
  forgotLink.style.display = 'none';
  // 重置 OTP Phase
  otpPhase = 'send';
  otpStepEmailBox.style.display = 'block';
  otpStepCodeBox.style.display  = 'none';
  otpTokenInput.setAttribute('disabled', '');
  otpTokenInput.removeAttribute('required');
  otpSubmitBtn.textContent      = '发送验证码';
  otpTokenInput.value           = '';
  if (focusInput) setTimeout(() => otpEmailInput.focus(), 50);
}
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    applyMode(btn.getAttribute('data-auth-tab') || 'password');
  });
});

// ---------- OTP 登录 ----------
function startResendCountdown(seconds = 60) {
  resendLeft = seconds;
  resendLink.style.pointerEvents = 'none';
  resendLink.style.opacity        = '0.5';
  resendCountdown.textContent     = `（${resendLeft} 秒后可重发）`;
  clearInterval(resendTimer);
  resendTimer = setInterval(() => {
    resendLeft -= 1;
    if (resendLeft <= 0) {
      clearInterval(resendTimer);
      resendCountdown.textContent = '';
      resendLink.style.pointerEvents = 'auto';
      resendLink.style.opacity        = '1';
      return;
    }
    resendCountdown.textContent = `（${resendLeft} 秒后可重发）`;
  }, 1000);
}

otpForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert(alertEl);
  const email = otpEmailInput.value.trim();
  if (!email) { showAlert(alertEl,'error','请先填写邮箱'); return; }

  if (otpPhase === 'send') {
    setLoading(otpSubmitBtn, true, '发送中...');
    try {
      const redirectTo = location.origin + location.pathname.replace(/[^/]*$/, '') + 'login.html';
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: redirectTo,
        },
      });
      if (error) throw error;
      otpPhase = 'verify';
      otpStepEmailBox.style.display = 'none';
      otpStepCodeBox.style.display  = 'block';
      otpTokenInput.removeAttribute('disabled');
      otpTokenInput.setAttribute('required', '');
      otpTokenInput.value = '';
      otpTokenInput.focus();
      otpSubmitBtn.textContent      = '验证并登录';
      setLoading(otpSubmitBtn, false);
      startResendCountdown(60);
      showAlert(alertEl, 'success',
        `✅ 验证码已发送至 ${email}，请到邮箱（含垃圾箱）中找到我们的邮件，复制其中的 8 位验证码粘贴到上方。`);
    } catch (err) {
      console.error('OTP send err', err);
      showAlert(alertEl, 'error', friendlyErrMsg(err));
      setLoading(otpSubmitBtn, false);
    }
    return;
  }

  // Phase 2：验证
  const token = (otpTokenInput.value || '').trim();
  if (!token) { showAlert(alertEl,'error','请输入邮件中收到的 8 位验证码'); return; }
  setLoading(otpSubmitBtn, true, '验证中...');
  try {
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error && /(invalid|unknown|wrong).*(type|otp)/i.test(error.message || '')) {
      const r2 = await supabase.auth.verifyOtp({ email, token, type: 'magiclink' });
      if (r2.error) throw r2.error;
    } else if (error) {
      throw error;
    }
    await afterLoginSuccess(email, 'OTP 验证通过');
  } catch (err) {
    console.error('OTP verify err', err);
    showAlert(alertEl, 'error', friendlyErrMsg(err));
    setLoading(otpSubmitBtn, false);
  }
});

// 重发 OTP
resendLink?.addEventListener('click', async (e) => {
  e.preventDefault();
  if (resendLeft > 0) return;
  const email = otpEmailInput.value.trim();
  if (!email) { showAlert(alertEl,'error','请先填写邮箱'); return; }
  hideAlert(alertEl);
  setLoading(otpSubmitBtn, true, '重发中...');
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error) throw error;
    otpTokenInput.value = '';
    otpTokenInput.focus();
    setLoading(otpSubmitBtn, false);
    startResendCountdown(60);
    showAlert(alertEl, 'success', '✅ 验证码已重新发送，请查收（含垃圾箱）');
  } catch (err) {
    console.error('OTP resend err', err);
    showAlert(alertEl, 'error', friendlyErrMsg(err));
    setLoading(otpSubmitBtn, false);
  }
});

// ---------- 密码登录 ----------
pwdForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert(alertEl);
  setLoading(pwdSubmitBtn, true, '登录中...');
  try {
    const email    = pwdEmailInput.value.trim();
    const password = pwdPwdInput.value;
    if (!email || !password) { showAlert(alertEl,'error','请填写邮箱和密码'); return; }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await afterLoginSuccess(email, '密码登录');
  } catch (err) {
    console.error('password login err', err);
    showAlert(alertEl, 'error', friendlyErrMsg(err));
  } finally {
    setLoading(pwdSubmitBtn, false);
  }
});

// ---------- 忘记密码 / 重置密码：发邮件到邮箱 ----------
forgotLink?.addEventListener('click', async (e) => {
  e.preventDefault();
  const email = (pwdEmailInput.value || otpEmailInput.value || '').trim();
  if (!email) {
    showAlert(alertEl,'info','请先在上方填写邮箱，再点击"忘记密码"');
    setTimeout(() => pwdEmailInput.focus(), 100);
    return;
  }
  setLoading(pwdSubmitBtn, true, '发送重置邮件中...');
  try {
    const redirectTo = location.origin + location.pathname.replace(/[^/]*$/, '') + 'login.html?reset=1';
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    showAlert(alertEl, 'success',
      `✅ 密码设置 / 重置邮件已发送至 <b>${email}</b><br/>` +
      '<span style="font-size:0.85rem;color:var(--text-muted);">请到邮箱（含垃圾箱）中找到我们的邮件，点击其中的蓝色按钮即可设置新密码。</span>');
  } catch (err) {
    showAlert(alertEl, 'error', friendlyErrMsg(err));
  } finally {
    setLoading(pwdSubmitBtn, false);
  }
});

// ========================================================
// 页面启动：按 URL 参数决定初始 Tab → 不自动跳走
// ========================================================
(async () => {
  // ① 初始 Tab 判断：
  //   · URL 带 ?mode=otp  → 从报名页"切换邮箱"过来，需要 OTP
  //   · 无 lastEmail      → 默认密码登录（也兼容新生切换到 OTP Tab）
  const params = new URLSearchParams(location.search);
  const initMode = (params.get('mode') === 'otp') ? 'otp' : 'password';
  applyMode(initMode, { focusInput: true });

  // ③ 已登录时提供"继续前往"选项（不强制跳走，尊重用户"不要保存上次记录直接进入"的要求）
  //    只在 URL 带 ?redirect=xxx（从报名页被跳过来）时自动走
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const redirect = getSafeRedirect();
    if (user && redirect) {
      // 带 redirect 的情况（如从报名页被踢回登录）→ 如果已经登录直接返回
      const admin = await isCurrentUserAdmin();
      location.href = admin ? 'admin.html' : redirect;
      return;
    }
    if (user) {
      const linkStyle = 'color:var(--accent-cyan);font-weight:600;';
      showAlert(alertEl, 'info',
        `ℹ️ 检测到您已以 <b>${user.email}</b> 身份登录。<br/>` +
        `如需切换账号请先「退出登录」，或直接点击下方快捷入口继续：<br/>` +
        `<div style="margin-top:8px;display:flex;gap:14px;justify-content:center;flex-wrap:wrap;">` +
          `<a href="index.html" style="${linkStyle}">🏠 前往首页</a>` +
          `<a href="register.html" style="${linkStyle}">📝 填写 / 修改报名表</a>` +
          `<a href="#" id="quick-logout" style="color:#f87171;font-weight:600;">🚪 退出登录</a>` +
        `</div>`, 9999999);
      // 绑定"快速退出登录"按钮
      setTimeout(() => {
        const ql = document.getElementById('quick-logout');
        if (ql) ql.addEventListener('click', async (e) => {
          e.preventDefault();
          await supabase.auth.signOut().catch(() => {});
          location.reload();
        });
      }, 0);
    }
  } catch (err) {
    console.warn('[boot] 检查登录态异常：', err && err.message);
  }
})();
