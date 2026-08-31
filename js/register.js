/* ========================================================
 * register.js — 纯报名表逻辑（【身份验证】和【填写资料】彻底分离）
 *
 * 全新流程（学生侧）：
 *   1. 学生先进入 login.html → 邮箱 + OTP 6 位码 完成登录
 *        = Supabase 自动建 auth.users 账号 + 邮箱自动标记为 email_confirmed_at
 *   2. 登录成功后跳回 register.html → 显示身份信息卡（邮箱只读）
 *   3. 学生填写报名表 → 提交：
 *        a. upsert profiles 表（把姓名/学号/学院等真实身份资料写入档案）
 *        b. insert registrations 表（当次招新的报名申请，带审批状态）
 *
 *  ⭐ 硬保险：提交前强制检查 email_confirmed_at 必须非空
 *      = 假邮箱 / 未验证邮箱绝对不可能写入报名池
 * ======================================================== */
import { supabase, showAlert, hideAlert, setLoading } from './supabase-init.js';

// ---------- DOM ----------
const alertEl          = document.getElementById('alert');
const identityCard     = document.getElementById('identity-card');
const currentEmailEl   = document.getElementById('current-email');
const logoutLink       = document.getElementById('logout-link');
const form             = document.getElementById('register-form');
const submitBtn        = document.getElementById('submit-btn');

// 所有可预填的字段
const PRE_FILL_FIELDS = ['name', 'gender', 'student_id', 'phone', 'college', 'major', 'grade'];

// ========================================================
// 页面加载：强制鉴权 + 渲染身份卡 + 预填表单
// ========================================================
(async () => {
  hideAlert(alertEl);

  try {
    // ① 检查是否已登录
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      showAlert(alertEl, 'info',
        '🔐 报名前请先完成邮箱验证登录，正在跳转登录页...<br/>' +
        '<span style="font-size:0.85rem;color:var(--text-muted);">登录后会自动跳回报名页继续填写。</span>');
      setTimeout(() => {
        location.href = 'login.html?redirect=' + encodeURIComponent('register.html');
      }, 900);
      return;
    }

    // ② 邮箱必须已确认（OTP 登录成功后，Supabase 一定会填上 email_confirmed_at；这里做最后硬拦截）
    if (!user.email_confirmed_at) {
      showAlert(alertEl, 'error',
        '⚠️ 该邮箱尚未完成真实性验证！<br/>' +
        '请先去 <a href="login.html" style="color:var(--accent-cyan)">登录页</a> 用邮箱收到的 6 位验证码完成一次 OTP 登录（验证成功后邮箱会被自动标记为已确认）。'
      );
      // 跳登录页
      setTimeout(() => {
        supabase.auth.signOut().finally(() => {
          location.href = 'login.html?redirect=' + encodeURIComponent('register.html');
        });
      }, 1600);
      return;
    }

    // ③ 登录验证通过 → 显示身份卡和表单
    identityCard.style.display = 'flex';
    form.style.display         = 'block';
    currentEmailEl.textContent = user.email || '(未识别)';

    // ④ 从 profiles 表预填学生上次写过的资料（如果存在）
    try {
      const { data: profile, error: pfErr } = await supabase
        .from('profiles')
        .select(PRE_FILL_FIELDS.join(','))
        .eq('id', user.id)
        .maybeSingle();
      if (!pfErr && profile) {
        for (const f of PRE_FILL_FIELDS) {
          if (profile[f] != null && profile[f] !== '') {
            const el = document.getElementById(f);
            if (el) el.value = String(profile[f]);
          }
        }
        showAlert(alertEl, 'info',
          'ℹ️ 已自动预填您上次保存的个人资料，可修改后再提交报名。');
      }
    } catch (pfLoadErr) {
      // 预填失败不影响主流程，只记录
      console.warn('[register] profiles 预填失败，忽略：', pfLoadErr);
    }
  } catch (bootErr) {
    console.error('[register] 初始化失败：', bootErr);
    showAlert(alertEl, 'error', '❌ ' + (bootErr.message || '页面初始化失败，请刷新重试'));
  }
})();

// ---------- 切换邮箱：退出后跳登录页 ----------
logoutLink?.addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    await supabase.auth.signOut();
  } catch (_) {}
  location.href = 'login.html?redirect=' + encodeURIComponent('register.html');
});

// ========================================================
// 表单提交：upsert profiles + insert registrations
// ========================================================
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert(alertEl);

  try {
    // ① 确认当前仍然有登录态 + 邮箱已确认
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      showAlert(alertEl, 'error', '🔐 登录态已失效，正在跳回登录页...');
      setTimeout(() => location.href = 'login.html?redirect=' + encodeURIComponent('register.html'), 800);
      return;
    }
    if (!user.email_confirmed_at) {
      throw new Error('邮箱尚未完成真实性验证，请先去登录页完成 OTP 验证。');
    }

    // ② 读取表单数据（邮箱从 Auth 拿，不从表单拿，彻底避免被改）
    const password        = document.getElementById('password').value;
    const passwordConfirm = document.getElementById('password_confirm').value;
    const data = {
      email:            user.email,
      name:             document.getElementById('name').value.trim(),
      gender:           document.getElementById('gender').value,
      student_id:       document.getElementById('student_id').value.trim(),
      phone:            document.getElementById('phone').value.trim(),
      college:          document.getElementById('college').value.trim(),
      major:            document.getElementById('major').value.trim(),
      grade:            document.getElementById('grade').value,
      first_department: document.getElementById('first_department').value,
      second_department:document.getElementById('second_department').value || null,
      skills:           document.getElementById('skills').value.trim() || null,
      motivation:       document.getElementById('motivation').value.trim(),
      expectation:      document.getElementById('expectation').value.trim() || null,
    };

    // ③ 基础校验（必填项、手机格式、自我介绍字数）
    if (!data.name || !data.gender || !data.student_id || !data.phone
        || !data.college || !data.major || !data.grade || !data.first_department
        || !data.motivation) {
      showAlert(alertEl, 'error', '❌ 请填写所有带 * 的必填项');
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(data.phone)) {
      showAlert(alertEl, 'error', '❌ 请输入 11 位有效的手机号码');
      return;
    }
    if (data.motivation.length < 30) {
      showAlert(alertEl, 'error', '❌ 自我介绍至少 30 字，请多写一点点～');
      return;
    }

    // ④ 密码校验（推荐必填：两个都空跳过；任意一个填了就两个都必填 + 长度≥6 + 两次一致）
    let passwordSet = false;
    if (password || passwordConfirm) {
      if (!password)          { showAlert(alertEl, 'error', '❌ 请填写「设置密码」'); return; }
      if (!passwordConfirm)   { showAlert(alertEl, 'error', '❌ 请填写「确认密码」'); return; }
      if (password.length < 6){ showAlert(alertEl, 'error', '❌ 密码至少需要 6 位'); return; }
      if (password !== passwordConfirm) {
        showAlert(alertEl, 'error', '❌ 两次输入的密码不一致，请重新输入');
        return;
      }
      passwordSet = true;
    }

    setLoading(submitBtn, true, passwordSet ? '正在设置密码并提交报名...' : '正在提交报名...');

    // ⑤ 如果填写了密码 → 先调用 Supabase Auth 写入密码（写入成功再继续后面的 DB 操作）
    if (passwordSet) {
      const { error: pwErr } = await supabase.auth.updateUser({ password });
      if (pwErr) {
        if ((pwErr.message || '').includes('same password')) {
          showAlert(alertEl, 'error', '❌ 新密码不能和旧密码相同，请换一个。');
        } else if ((pwErr.message || '').toLowerCase().includes('weak')) {
          showAlert(alertEl, 'error', '❌ 密码过于简单（Supabase 风控）：请增加长度，使用字母 + 数字 + 符号组合。');
        } else {
          throw pwErr;
        }
        setLoading(submitBtn, false);
        return;
      }
      // 密码写入成功后再刷新一次 session，避免被踢出
      await supabase.auth.refreshSession().catch(() => {});
    }

    // ⑦ 再更新 profiles（学生档案，便于以后登录可以随时修改个人资料）
    const { error: pfErr } = await supabase.from('profiles').upsert({
      id:         user.id,
      email:      data.email,
      name:       data.name,
      gender:     data.gender,
      student_id: data.student_id,
      phone:      data.phone,
      college:    data.college,
      major:      data.major,
      grade:      data.grade,
    }, { onConflict: 'id', ignoreDuplicates: false, defaultToNull: true });
    if (pfErr) throw pfErr;

    // ⑧ 最后插入当次报名申请（registrations = 一次招新一次记录，审批状态挂这）
    const { error: regErr } = await supabase.from('registrations').insert([{
      user_id:            user.id,
      name:               data.name,
      gender:             data.gender,
      student_id:         data.student_id,
      phone:              data.phone,
      email:              data.email,
      college:            data.college,
      major:              data.major,
      grade:              data.grade,
      first_department:   data.first_department,
      second_department:  data.second_department,
      skills:             data.skills,
      motivation:         data.motivation,
      expectation:        data.expectation,
    }]);
    if (regErr) {
      // 如果学生重复提交（同一年度重复报名？我们没加唯一索引，这里给一个友好提示即可）
      if ((regErr.message || '').includes('duplicate')
          || (regErr.message || '').toLowerCase().includes('unique')) {
        throw new Error('您使用当前邮箱已经提交过一次报名，无需重复提交。可登录后查看审批状态。');
      }
      throw regErr;
    }

    // ⑨ 成功
    const extraPwMsg = passwordSet
      ? '<br/>🔐 <span style="color:var(--accent-cyan)">登录密码设置成功</span>，下次可直接在登录页使用「邮箱 + 密码」登录，无需每次收验证码。'
      : '';
    showAlert(alertEl, 'success',
      '🎉 报名提交成功！<br/>' +
      '我们会在 48 小时内完成审核，结果将通过邮箱（' + data.email + '）通知您。' + extraPwMsg +
      '<br/><span style="font-size:0.85rem;color:var(--text-muted);">即将跳转到首页，您可随时从登录页查询审批进度。</span>'
    );
    submitBtn.disabled = true;
    submitBtn.innerHTML = '✅ 报名已提交';

    setTimeout(() => { location.href = 'index.html'; }, 2400);
  } catch (err) {
    console.error('register submit err', err);
    showAlert(alertEl, 'error', '❌ ' + (err.message || '提交失败，请稍后重试'));
    setLoading(submitBtn, false);
  }
});
