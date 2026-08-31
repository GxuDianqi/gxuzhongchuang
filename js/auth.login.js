/* ========================================================
 * auth.login.js — 登录页逻辑
 * ======================================================== */
import { supabase, showAlert, hideAlert, setLoading, isCurrentUserAdmin } from './supabase-init.js';

const form = document.getElementById('login-form');
const alertEl = document.getElementById('alert');
const submitBtn = document.getElementById('submit-btn');
const forgotLink = document.getElementById('forgot-link');

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert(alertEl);
  setLoading(submitBtn, true, '登录中...');

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    showAlert(alertEl, 'success', '✅ 登录成功，正在跳转...');

    // 管理员 → admin.html；普通用户 → index.html（未来可做个人中心）
    const admin = await isCurrentUserAdmin();
    setTimeout(() => {
      location.href = admin ? 'admin.html' : 'index.html';
    }, 600);
  } catch (err) {
    console.error('login err', err);
    let msg = err.message || '登录失败，请重试';
    if (msg.includes('Invalid login credentials') || msg.includes('凭据')) {
      msg = '❌ 邮箱或密码不正确';
    } else if (msg.includes('Email not confirmed') || msg.includes('确认')) {
      msg = '⚠️ 邮箱尚未验证，请检查邮箱的确认链接（可在 Supabase 后台关闭强制验证）';
    }
    showAlert(alertEl, 'error', msg);
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

// 如已登录，自动跳转
(async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const admin = await isCurrentUserAdmin();
    location.href = admin ? 'admin.html' : 'index.html';
  }
})();
