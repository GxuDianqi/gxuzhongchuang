/* ========================================================
 * register.js — 报名表单提交逻辑
 *
 * 流程：
 *   1. supabase.auth.signUp 用邮箱创建 Auth 账号
 *   2. 自动创建 profiles 表记录（由数据库触发器处理）
 *   3. 插入 registrations 表提交报名信息
 * ======================================================== */
import { supabase, showAlert, hideAlert, setLoading } from './supabase-init.js';

const form = document.getElementById('register-form');
const alertEl = document.getElementById('alert');
const submitBtn = document.getElementById('submit-btn');

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert(alertEl);

  // --- 读取表单 ---
  const data = {
    // Auth
    email:    document.getElementById('email').value.trim(),
    password: document.getElementById('password').value,
    // Profile
    name:         document.getElementById('name').value.trim(),
    gender:       document.getElementById('gender').value,
    student_id:   document.getElementById('student_id').value.trim(),
    phone:        document.getElementById('phone').value.trim(),
    college:      document.getElementById('college').value.trim(),
    major:        document.getElementById('major').value.trim(),
    grade:        document.getElementById('grade').value,
    first_department:  document.getElementById('first_department').value,
    second_department: document.getElementById('second_department').value,
    skills:       document.getElementById('skills').value.trim(),
    motivation:   document.getElementById('motivation').value.trim(),
    expectation:  document.getElementById('expectation').value.trim(),
  };

  // --- 基础校验 ---
  if (data.password.length < 6) {
    showAlert(alertEl, 'error', '❌ 密码至少需要 6 位');
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

  setLoading(submitBtn, true, '正在提交报名...');

  try {
    // Step 1: Sign Up 创建 Auth 用户
    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        // signup 时顺带写入 public.profiles（由 auth 触发器自动完成）
        data: {
          name: data.name,
          student_id: data.student_id,
          phone: data.phone,
          college: data.college,
          major: data.major,
          grade: data.grade,
        },
      },
    });
    if (signUpError) {
      // 邮箱已存在 → 提示登录
      if ((signUpError.message || '').toLowerCase().includes('already registered')
          || (signUpError.message || '').includes('已经被注册')) {
        throw new Error('该邮箱已注册！请<a href="login.html" style="color:var(--accent-gold)">直接登录</a> （忘记密码可在登录页找回）');
      }
      throw signUpError;
    }

    const user = authData?.user;
    if (!user) throw new Error('账号创建失败，请稍后重试');

    // Step 2: 提交报名信息 到 registrations 表
    const registrationPayload = {
      user_id: user.id,
      name: data.name,
      gender: data.gender,
      student_id: data.student_id,
      phone: data.phone,
      email: data.email,
      college: data.college,
      major: data.major,
      grade: data.grade,
      first_department: data.first_department,
      second_department: data.second_department || null,
      skills: data.skills || null,
      motivation: data.motivation,
      expectation: data.expectation || null,
    };

    const { error: regErr } = await supabase
      .from('registrations')
      .insert([registrationPayload]);
    if (regErr) throw regErr;

    // --- 成功 ---
    showAlert(
      alertEl,
      'success',
      authData.session
        ? '🎉 报名成功！已自动登录，稍后将跳转到首页查看协会介绍。'
        : '🎉 报名提交成功！请前往邮箱点击确认链接完成注册（如未收到可在 Supabase Auth 设置中关闭邮箱确认）。确认后即可登录查看状态。'
    );

    // 禁用表单，防止重复提交
    submitBtn.disabled = true;
    submitBtn.innerHTML = '✅ 报名已提交';

    if (authData.session) {
      setTimeout(() => { location.href = 'index.html'; }, 2200);
    }
  } catch (err) {
    console.error('register err', err);
    showAlert(alertEl, 'error', '❌ ' + (err.message || '提交失败，请重试'));
    setLoading(submitBtn, false);
  }
});

// 如已登录，提示先退出
(async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    showAlert(alertEl, 'info',
      `当前已登录：${user.email}。若要用其他邮箱报名，请先<a href="login.html" style="color:var(--accent-cyan)">退出登录</a>。已报名可直接<a href="login.html" style="color:var(--accent-cyan)">登录查看审批状态</a>。`
    );
  }
})();
