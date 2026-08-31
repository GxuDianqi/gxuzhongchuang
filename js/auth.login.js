/* ========================================================
 * auth.login.js — 登录页逻辑
 * ======================================================== */
import { supabase, showAlert, hideAlert, setLoading, isCurrentUserAdmin } from './supabase-init.js';

const form = document.getElementById('login-form');
const alertEl = document.getElementById('alert');
const submitBtn = document.getElementById('submit-btn');
const forgotLink = document.getElementById('forgot-link');

// 通用友好错误提示：把 Supabase 的原始错误翻译成"你该做什么"
function friendlyErrMsg(err) {
  const raw = (err && err.message) ? err.message : String(err || '登录失败，请重试');
  const status = (err && err.status) || 0;

  // ---- 最优先：Auth 服务（GoTrue）本身 500 = Supabase 平台/实例异常 ----
  if ((status === 500 || /\/auth\/v1\/token/.test(raw)) &&
      raw.includes('Database error querying schema')) {
    return (
      '🚨 Supabase 认证服务还没就绪（平台 500）：\n' +
      '   ① 先去 Supabase 项目首页看左上角的状态灯，必须是绿色 "Healthy"；如果显示 "Restoring/Paused"，' +
      '等 2-5 分钟恢复即可（免费版一周没人用会自动暂停，首次使用点 Resume project）。\n' +
      '   ② 如果状态 Healthy → 去 Supabase 后台 "Authentication → Users"，确认能看到用户列表（加载不出来就是 DB 挂了）。\n' +
      '   ③ 还是不行：建议用后台 Authentication → Users → Add user 方式新建 admin@gxu-ai.club，不要再用纯 SQL 手插 auth.users，避免字段写坏。'
    );
  }

  // ---- 业务表 / public schema 相关 ----
  if (raw.includes('Database error querying schema') ||
      (raw.includes('relation') && raw.includes('does not exist')) ||
      raw.includes('permission denied for table')) {
    return '❌ 业务数据库未初始化：请先在 SQL Editor 完整执行 supabase/schema.sql（先跑它！），再跑 00-seed-admin.sql。详见 DEPLOYMENT.md 第 1 步。';
  }
  if (raw.includes('Invalid login credentials') || raw.includes('凭据')) {
    return '❌ 邮箱或密码不正确';
  }
  if (raw.includes('Email not confirmed') || raw.includes('确认')) {
    return '⚠️ 邮箱尚未验证：在 Supabase → Authentication → Providers → Email 关闭 "Confirm email"（招新现场建议关闭），或点击邮箱确认链接。';
  }
  if (raw.includes('Email rate limit')) {
    return '⏳ 邮件发送频率超限，请 1 分钟后重试或改用其他邮箱。';
  }
  return '❌ ' + raw;
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert(alertEl);
  setLoading(submitBtn, true, '登录中...');

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    // ⭐ 强制刷新 Session：把我们刚才在 SQL 里写回 auth.users.raw_app_meta_data 的
    //    is_admin=true 同步进 JWT / session，避免拿到旧缓存
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error) throw refreshed.error;

    const admin = await isCurrentUserAdmin();
    showAlert(alertEl, 'success', admin
      ? '✅ 管理员登录成功，正在进入审批后台...'
      : '✅ 登录成功，正在跳转...');

    setTimeout(() => {
      location.href = admin ? 'admin.html' : 'index.html';
    }, 700);
  } catch (err) {
    console.error('login err', err);
    showAlert(alertEl, 'error', friendlyErrMsg(err));
  } finally {
    setLoading(submitBtn, false);
  }
});

// 忘记密码 → 发送重置邮件
forgotLink?.addEventListener('click', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  if (!email) {
    showAlert(alertEl, 'info', '请先在上方填写邮箱，再点击找回密码');
    return;
  }
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname.replace(/[^/]*$/, '') + 'login.html',
    });
    if (error) throw error;
    showAlert(alertEl, 'success', `✅ 密码重置邮件已发送至 ${email}，请查收（含垃圾邮件）`);
  } catch (err) {
    showAlert(alertEl, 'error', '❌ 发送失败：' + (err.message || err));
  }
});

// 如已登录，自动跳转（做了兜底：DB 查询失败不显示可怕的红框，只在控制台提示）
(async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const admin = await isCurrentUserAdmin();
    location.href = admin ? 'admin.html' : 'index.html';
  } catch (err) {
    console.warn('[auto-redirect] 跳过自动跳转，因为：', err && err.message);
    // 这里故意不 showAlert —— 登录页打开时不应该被奇怪的错误打扰
  }
})();
