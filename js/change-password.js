/* ========================================================
 * change-password.js — 「设置/修改登录密码」独立页逻辑
 *
 *  与报名流程彻底解耦：
 *    - 未登录 → 跳 login.html?redirect=change-password.html
 *    - 已登录 → 读取当前 session，判断是"首次设置密码"还是"修改密码"
 *        a) 首次设置：提示"设置后可密码登录" → 提交后写 Supabase Auth
 *        b) 修改密码：提示"修改后所有设备会话失效"
 *    - 提交成功后：给用户 2 秒看到成功提示 → 跳回登录页（用新密码登录）
 * ======================================================== */
import { supabase, showAlert, setLoading } from './supabase-init.js';

const $ = id => document.getElementById(id);

const alertEl       = $('alert');
const loginRequired = $('login-required');
const pwdPanel      = $('pwd-panel');
const pwdForm       = $('password-form');
const submitBtn     = $('submit-btn');
const currentEmail  = $('current-email');
const hintFirstSet  = $('hint-first-set');  // 首次设置提示
const hintModify    = $('hint-modify');     // 修改密码提示
const navUser       = $('nav-user');
const userEmailEl   = $('user-email');

let CURRENT_USER_EMAIL = null;

(async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();

    // ① 未登录 → 强制跳登录页
    if (!user || !user.email) {
      loginRequired.style.display = 'block';
      setTimeout(() => {
        location.href = 'login.html?redirect=' + encodeURIComponent('change-password.html');
      }, 1200);
      return;
    }
    CURRENT_USER_EMAIL = user.email;

    // ② 邮箱未验证 → 必须先走 OTP
    if (!user.email_confirmed_at) {
      showAlert(alertEl, 'error', '⚠️ 该邮箱尚未完成真实性验证！<br/>请先前往登录页使用「邮箱验证码」登录一次。');
      setTimeout(() => supabase.auth.signOut().finally(() => {
        location.href = 'login.html?redirect=' + encodeURIComponent('change-password.html');
      }), 1500);
      return;
    }

    // ③ 显示密码面板 + 身份卡
    pwdPanel.style.display = 'block';
    navUser.style.display  = 'flex';
    userEmailEl.textContent  = user.email;
    currentEmail.textContent = user.email;

    $('btn-logout').addEventListener('click', async () => {
      await supabase.auth.signOut();
      location.href = 'login.html?redirect=' + encodeURIComponent('change-password.html');
    });
    $('logout-link').addEventListener('click', async e => {
      e.preventDefault();
      await supabase.auth.signOut();
      location.href = 'login.html?redirect=' + encodeURIComponent('change-password.html');
    });

    // ④ 判断是否"首次设置"还是"修改密码"
    //    ⚠️ Supabase 没有直接暴露"账号是否设置过密码"的 API；
    //    所以我们用 profiles 表的一个约定字段 + session 特征来判断：
    //    简化做法：一律按"修改密码"流程（因为就算首次设置，Supabase auth.updateUser({password}) 一样正常工作）。
    //    为了更好的用户体验，我们用一个更准确的启发：
    //    若是刚通过 OTP 登录进来的（last 登录方式只能从 session 推断），大概率是首次设置 → 展示"首次设置"提示。
    //    这里采用 profiles 启发：若 profiles 记录存在且姓名已填（已经报过名了）→ 展示"修改"提示；否则展示"首次设置"提示。
    try {
      const { data: profile, error: pfErr } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', user.id)
        .maybeSingle();
      if (!pfErr && profile && profile.name) {
        hintModify.style.display    = 'block';
        hintFirstSet.style.display  = 'none';
      } else {
        hintFirstSet.style.display = 'block';
        hintModify.style.display   = 'none';
      }
    } catch (_) {
      // profiles 读失败兜底：展示首次设置
      hintFirstSet.style.display = 'block';
    }

    // ⑤ 绑定提交
    pwdForm.addEventListener('submit', onSubmit);
  } catch (err) {
    console.error('change-password bootstrap err', err);
    showAlert(alertEl, 'error', '❌ 页面初始化失败：' + (err.message || err));
  }
})();

async function onSubmit(e) {
  e.preventDefault();
  try {
    const password        = $('password').value;
    const passwordConfirm = $('password_confirm').value;

    // 校验
    if (!password)          { showAlert(alertEl, 'error', '❌ 请填写新密码'); return; }
    if (password.length < 6){ showAlert(alertEl, 'error', '❌ 密码至少需要 6 位'); return; }
    if (!passwordConfirm)   { showAlert(alertEl, 'error', '❌ 请填写确认密码'); return; }
    if (password !== passwordConfirm) {
      showAlert(alertEl, 'error', '❌ 两次输入的密码不一致，请重新输入');
      return;
    }

    setLoading(submitBtn, true, '正在保存密码...');
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setLoading(submitBtn, false);
      const msg = error.message || '';
      if (/same password/i.test(msg)) {
        showAlert(alertEl, 'error', '❌ 新密码不能和旧密码相同，请换一个。');
      } else if (/weak/i.test(msg)) {
        showAlert(alertEl, 'error',
          '❌ 密码过于简单（被 Supabase 风控策略拦截）。<br/>' +
          '<span style="font-size:0.88rem;">建议：长度 ≥ 8，同时包含大写字母、小写字母、数字和符号（例如 <code style="color:var(--accent-cyan)">GxuZc@2026</code>）。</span>'
        );
      } else if (/reauthenticate/i.test(msg)) {
        showAlert(alertEl, 'error',
          '🔐 出于安全考虑，修改密码需要<strong>重新验证身份</strong>。<br/>' +
          '请点击顶部「切换邮箱」退出后，重新通过「邮箱验证码」登录一次，再设置密码即可。'
        );
      } else {
        showAlert(alertEl, 'error', '❌ 设置失败：' + msg);
      }
      return;
    }

    // 成功
    setLoading(submitBtn, false);
    submitBtn.disabled = true;
    submitBtn.innerHTML = '✅ 密码已保存';
    showAlert(alertEl, 'success',
      '🎉 登录密码设置成功！<br/>' +
      `<b>账号：</b>${CURRENT_USER_EMAIL}<br/>` +
      '现在可以前往 <a href="login.html" style="color:var(--accent-cyan);">登录页 → 🔑 邮箱密码登录</a> 直接登录，无需每次收验证码。' +
      '<br/><span style="font-size:0.85rem;color:var(--text-muted);">（安全起见，旧会话已失效，请用新密码重新登录）<br/>即将跳转到登录页……</span>'
    );
    setTimeout(() => { supabase.auth.signOut().finally(() => location.href = 'login.html'); }, 3000);
  } catch (err) {
    setLoading(submitBtn, false);
    showAlert(alertEl, 'error', '❌ ' + (err.message || err));
  }
}
