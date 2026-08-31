/* ========================================================
 * auth.login.js — 登录页逻辑（双模式：OTP + 管理员密码）
 *
 * 模式 A · 默认（学生）：邮箱 + 6 位验证码 OTP
 *           · 第一次输入邮箱就自动 signInWithOtp({shouldCreateUser:true})
 *             → Supabase 自动发邮件带 {{.Token}} 验证码
 *             → 学生输入验证码后 verifyOtp → 自动建号 + 邮箱自动标记已确认
 *             → 登录成功跳首页 / 报名页
 * 模式 B · 管理员专用：切到邮箱 + 密码登录（避免 OTP 邮件收不到时管理员也登不上）
 * ======================================================== */
import { supabase, showAlert, hideAlert, setLoading, isCurrentUserAdmin } from './supabase-init.js';

// ---------- DOM ----------
const alertEl         = document.getElementById('alert');
const titleEl         = document.getElementById('form-title');
const subEl           = document.getElementById('form-sub');
const modeSwitchEl    = document.getElementById('mode-switch');
const switchPwdLink   = document.getElementById('switch-pwd-link');
const forgotLink      = document.getElementById('forgot-link');

// OTP 表单
const otpForm         = document.getElementById('otp-form');
const otpEmailInput   = document.getElementById('otp-email');
const otpStepEmailBox = document.getElementById('otp-step-email');
const otpStepCodeBox  = document.getElementById('otp-step-code');
const otpTokenInput   = document.getElementById('otp-token');
const otpSubmitBtn    = document.getElementById('otp-submit-btn');
const resendLink      = document.getElementById('resend-link');
const resendCountdown = document.getElementById('resend-countdown');

// 密码表单（管理员）
const pwdForm         = document.getElementById('password-form');
const pwdEmailInput   = document.getElementById('pwd-email');
const pwdPwdInput     = document.getElementById('pwd-password');
const pwdSubmitBtn    = document.getElementById('pwd-submit-btn');

// OTP 状态机
// 'send'   = 第一步只显示邮箱，按钮"发送验证码"
// 'verify' = 显示邮箱+6位码输入框，按钮"验证并登录"
let otpPhase = 'send';
let resendTimer = null;
let resendLeft  = 0;

// ---------- 通用：友好错误翻译 ----------
function friendlyErrMsg(err) {
  const raw    = (err && err.message) ? err.message : String(err || '操作失败，请重试');
  const status = (err && err.status) || 0;
  const code   = (err && err.code)   || '';

  // GoTrue 服务本身 500（Supabase 平台实例异常）
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
    return '❌ 权限被拒（RLS）：请重新执行 schema.sql，并确认当前账号 is_admin=true（清缓存后重新登录可刷新 JWT）。';
  }
  if (/infinite recursion/i.test(raw)) {
    return '❌ RLS 策略递归：请重新执行"清空+重建 4 条无递归策略"的 SQL，不要用 exists(查 profiles 自己) 的写法。';
  }
  if (raw.includes('Invalid login credentials')) {
    return '❌ 邮箱或密码不正确';
  }
  if (/Email not confirmed|邮箱.*?验证/i.test(raw)) {
    return '⚠️ 邮箱尚未完成验证：请在邮箱里找到我们发送的验证码/确认链接，先完成验证再登录。如果是管理员可切换到"密码登录"模式并用 Add user 时设置的密码登录。';
  }
  if (/Email rate limit|rate.*limit/i.test(raw)) {
    return '⏳ 邮件发送频率超限（Supabase 内置邮箱仅 3 封/小时）。① 请 1 分钟后重试；② 强烈建议在 Supabase → Auth → URL/SMTP 里配置自己的 SMTP 发送服务器（QQ企业邮箱/SendGrid 均可，发送量不受限）。';
  }
  if (/otp.*(expired|invalid|mismatch)|验证码.*(过期|错误|不匹配)/i.test(raw)) {
    return '❌ 验证码已过期或错误：请重新点"发送验证码"获取新的 6 位码，注意大小写不敏感。';
  }
  if (/over.*email.*send|发送|send.*email/i.test(raw) && /limit/i.test(raw)) {
    return '⏳ 邮件发送频率超限：请等 1 分钟再试；或去 Supabase 后台配置自定义 SMTP 解除限流（见文档第 3 步）。';
  }
  return '❌ ' + raw;
}

// ---------- 读取并校验 URL 中的 redirect 参数（只允许站内相对路径，防钓鱼） ----------
function getSafeRedirect() {
  try {
    const params = new URLSearchParams(location.search);
    const raw = params.get('redirect');
    if (!raw) return null;
    const decoded = decodeURIComponent(raw).trim();
    if (!decoded) return null;
    // 拒绝带协议/带域名/带 // 协议相对/包含 @ 的恶意跳转
    if (/^(https?:|\/\/|ftp:|data:|javascript:)/i.test(decoded)) return null;
    if (decoded.includes('@')) return null;
    // 必须是站内相对路径（.html 结尾或 / 开头）
    if (!/^(\/|[\w.-]+\.html(\?|#|$))/.test(decoded)) return null;
    return decoded;
  } catch (_) { return null; }
}

// ---------- 登录成功后统一处理：刷新 JWT + redirect 参数优先 + 角色分流 ----------
async function afterLoginSuccess(sourceHint) {
  // 刷新 session，确保 SQL set_admin 写入的 app_metadata 同步进 JWT claims
  const refreshed = await supabase.auth.refreshSession();
  if (refreshed.error) throw refreshed.error;

  const admin   = await isCurrentUserAdmin();
  const redirect = getSafeRedirect();

  // 管理员永远跳 admin.html（优先级最高，即使有 redirect 也不回报名页）
  let target = admin ? 'admin.html' : (redirect || 'index.html');

  showAlert(alertEl, 'success', admin
    ? `✅ ${sourceHint}：管理员登录成功，正在进入审批后台...`
    : (redirect
        ? `✅ ${sourceHint}：登录成功，正在返回报名表单...`
        : `✅ ${sourceHint}：登录成功，正在跳转...`));

  setTimeout(() => { location.href = target; }, 700);
}

// ---------- OTP 登录 ----------
// 启动重发 60s 倒计时
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

  // ---------- Phase 1：发送 OTP ----------
  if (otpPhase === 'send') {
    setLoading(otpSubmitBtn, true, '发送中...');
    try {
      const redirectTo = location.origin + location.pathname.replace(/[^/]*$/, '') + 'login.html';
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,   // 第一次发 OTP = 自动建账号
          emailRedirectTo: redirectTo,
        },
      });
      if (error) throw error;

      // 切到 Phase 2：显示验证码输入框（此时 input 可见，才允许 required 生效，避免 Chrome focus 警告）
      otpPhase = 'verify';
      otpStepEmailBox.style.display = 'none'; // 不允许改邮箱（防作弊切换他人邮箱用自己验证码）
      otpStepCodeBox.style.display  = 'block';
      otpTokenInput.removeAttribute('disabled');
      otpTokenInput.setAttribute('required', '');
      otpTokenInput.value = '';
      otpTokenInput.focus();
      otpSubmitBtn.textContent      = '验证并登录';
      setLoading(otpSubmitBtn, false);
      startResendCountdown(60);
      showAlert(alertEl, 'success',
        `✅ 验证码已发送至 ${email}，请到邮箱（含垃圾箱）中找到我们的邮件，复制其中的 6 位验证码粘贴到上方。<br/>` +
        `<span style="font-size:0.85rem;color:var(--text-muted);">若邮件里是"确认链接"也可直接点链接，点完即可自动跳回这里并登录。</span>`);
    } catch (err) {
      console.error('OTP send err', err);
      showAlert(alertEl, 'error', friendlyErrMsg(err));
      setLoading(otpSubmitBtn, false);
    }
    return;
  }

  // ---------- Phase 2：验证 6 位码 ----------
  const token = (otpTokenInput.value || '').trim();
  if (!token) { showAlert(alertEl,'error','请输入邮件中收到的 6 位验证码'); return; }

  setLoading(otpSubmitBtn, true, '验证中...');
  try {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email', // 注意：Supabase 邮箱 OTP 类型为 'email'（或者 magiclink，视版本而定，两者都会试）
    });
    // 如果第一次用 'email' 类型不报 token 过期之外的错，就 OK；
    // 有些 Supabase SDK/实例要求类型是 'magiclink'——这里我们不盲猜，若 'email' 报 type 错就自动重试一次 magiclink。
    if (error && /(invalid|unknown|wrong).*(type|otp)/i.test(error.message || '')) {
      const r2 = await supabase.auth.verifyOtp({ email, token, type: 'magiclink' });
      if (r2.error) throw r2.error;
    } else if (error) {
      throw error;
    }
    await afterLoginSuccess('OTP 验证通过');
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

// ---------- 密码登录（管理员） ----------
pwdForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert(alertEl);
  setLoading(pwdSubmitBtn, true, '登录中...');
  try {
    const email    = pwdEmailInput.value.trim();
    const password = pwdPwdInput.value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await afterLoginSuccess('密码登录');
  } catch (err) {
    console.error('password login err', err);
    showAlert(alertEl, 'error', friendlyErrMsg(err));
  } finally {
    setLoading(pwdSubmitBtn, false);
  }
});

// 忘记密码（只有在密码模式可见时可用）
forgotLink?.addEventListener('click', async (e) => {
  e.preventDefault();
  const email = (pwdEmailInput.value || otpEmailInput.value || '').trim();
  if (!email) { showAlert(alertEl,'info','请先在上方填写邮箱，再点击找回密码'); return; }
  try {
    const redirectTo = location.origin + location.pathname.replace(/[^/]*$/, '') + 'login.html';
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    showAlert(alertEl, 'success', `✅ 密码重置邮件已发送至 ${email}，请查收（含垃圾箱）`);
  } catch (err) {
    showAlert(alertEl, 'error', '❌ 发送失败：' + (err.message || err));
  }
});

// ---------- 模式切换：OTP <-> 密码 ----------
let mode = 'otp'; // 'otp' | 'password'
function applyMode(nextMode) {
  mode = nextMode;
  hideAlert(alertEl);
  if (nextMode === 'password') {
    // 切换到管理员密码模式
    titleEl.textContent     = '🔑 管理员 · 密码登录';
    subEl.textContent       = '管理员专用登录方式，避免验证码邮件延迟时无法进入审批后台。';
    otpForm.style.display   = 'none';
    pwdForm.style.display   = 'block';
    forgotLink.style.display= 'inline';

    // 切换按钮文案 = "返回邮箱验证码登录"
    modeSwitchEl.innerHTML = `
      <span style="color:var(--text-muted);font-size:0.85rem;">学生报名请用邮箱验证码：</span>
      <a href="#" id="switch-otp-link" style="font-size:0.85rem;">← 使用验证码登录</a>`;
    document.getElementById('switch-otp-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      applyMode('otp');
    });
    setTimeout(() => pwdEmailInput.focus(), 50);
    return;
  }

  // 切回 OTP（默认）
  titleEl.textContent     = '🔐 邮箱验证码登录';
  subEl.textContent       = '新生首次登录即自动注册并验证邮箱。请使用广西大学在校邮箱或常用邮箱接收 6 位验证码。';
  otpForm.style.display   = 'block';
  pwdForm.style.display   = 'none';
  forgotLink.style.display= 'none';

  modeSwitchEl.innerHTML = `
    <span style="color:var(--text-muted);font-size:0.85rem;">管理员专用：</span>
    <a href="#" id="switch-pwd-link" style="font-size:0.85rem;">使用密码登录 →</a>`;
  document.getElementById('switch-pwd-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    applyMode('password');
  });

  // 重置 OTP Phase（回到 send 阶段，隐藏 token 输入框 → 禁用 required，避免 Chrome 尝试 focus 隐藏控件）
  otpPhase = 'send';
  otpStepEmailBox.style.display = 'block';
  otpStepCodeBox.style.display  = 'none';
  otpTokenInput.setAttribute('disabled', '');
  otpTokenInput.removeAttribute('required');
  otpSubmitBtn.textContent      = '发送验证码';
  otpTokenInput.value           = '';
  otpEmailInput.focus();
}
switchPwdLink?.addEventListener('click', (e) => { e.preventDefault(); applyMode('password'); });

// ---------- 已登录自动跳转（兜底，异常不打扰） ----------
(async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const admin    = await isCurrentUserAdmin();
    const redirect = getSafeRedirect();
    location.href = admin ? 'admin.html' : (redirect || 'index.html');
  } catch (err) {
    console.warn('[auto-redirect] 跳过自动跳转：', err && err.message);
  }
})();
