/* ========================================================
 * register.js — 纯报名表逻辑 + 草稿自动保存
 *
 * 全新流程（学生侧）：
 *   1. 学生先进入 login.html → 邮箱 + OTP 8 位码 完成登录
 *        = Supabase 自动建 auth.users 账号 + 邮箱自动标记为 email_confirmed_at
 *   2. 登录成功后跳回 register.html → 显示身份信息卡（邮箱只读）
 *   3. 学生填写报名表：
 *        ⭐ 草稿自动保存：每 10 秒 + 任何 input 后 1.5s 防抖存 localStorage(draft_<uid>)
 *        ⭐ 页面加载检测草稿 → 顶部横幅提示用户【恢复草稿】或【舍弃】
 *        ⭐ 提交成功后自动清空该 uid 草稿
 *   4. 提交：
 *        a. upsert profiles 表（把姓名/学号/学院等真实身份资料写入档案）
 *        b. insert registrations 表（当次招新的报名申请，带审批状态）
 *        c. 如果设置了密码 → 同步写入 Supabase Auth
 * ======================================================== */
import { supabase, showAlert, hideAlert, setLoading } from './supabase-init.js';

// 工具函数（修复 '$ is not defined' Bug）
const $ = (id) => document.getElementById(id);

// ---------- DOM ----------
const alertEl          = document.getElementById('alert');
const identityCard     = document.getElementById('identity-card');
const currentEmailEl   = document.getElementById('current-email');
const logoutLink       = document.getElementById('logout-link');
const form             = document.getElementById('register-form');
const submitBtn        = document.getElementById('submit-btn');

// 在表单前插入草稿横幅和保存提示
const DRAFT_BANNER_HTML = `
  <div id="draft-banner" class="draft-banner" style="display:none;">
    <span id="draft-banner-text">📦 检测到您有未提交的报名草稿，保存于：<span id="draft-time"></span></span>
    <span class="db-btns">
      <button type="button" class="btn-restore" id="draft-restore">↩️ 恢复此草稿</button>
      <button type="button" class="btn-discard" id="draft-discard">🗑 舍弃</button>
    </span>
  </div>
`;
const DRAFT_HINT_HTML   = `<div id="draft-save-hint" class="draft-save-hint">💾 草稿已自动保存</div>`;

// 草稿涵盖字段（注意：密码设置已彻底移至 change-password.html，此处只存报名信息）
const DRAFT_FIELDS = [
  'name','gender','student_id','phone','college','major','grade',
  'first_department','second_department','skills','motivation','expectation'
];

// 所有可预填的字段（从 profiles 读取）
const PRE_FILL_FIELDS = ['name', 'gender', 'student_id', 'phone', 'college', 'major', 'grade'];

let CURRENT_USER = null;
let draftDirtyTimer = null;
let draftIntervalTimer = null;
let loadedDraft = null;   // 页面打开时检测到的旧草稿（供"恢复/舍弃"按钮用）

// ========================================================
// 页面加载：强制鉴权 + 渲染身份卡 + 草稿检测 + 预填表单
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
    CURRENT_USER = user;

    // ② 邮箱必须已确认（OTP 登录成功后，Supabase 一定会填上 email_confirmed_at；这里做最后硬拦截）
    if (!user.email_confirmed_at) {
      showAlert(alertEl, 'error',
        '⚠️ 该邮箱尚未完成真实性验证！<br/>' +
        '请先去 <a href="login.html" style="color:var(--accent-cyan)">登录页</a> 用邮箱收到的 8 位验证码完成一次 OTP 登录。'
      );
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

    // 在 alertEl 之后插入草稿横幅 + 保存提示
    alertEl.insertAdjacentHTML('afterend', DRAFT_BANNER_HTML);
    document.body.insertAdjacentHTML('beforeend', DRAFT_HINT_HTML);
    bindDraftUI();

    // ④ 草稿检测：先读本地草稿（不立即回填，等用户点"恢复"）
    loadedDraft = loadDraft(user.id);
    if (loadedDraft) {
      $('draft-banner').style.display = 'flex';
      $('draft-time').textContent = new Date(loadedDraft.__savedAt || Date.now()).toLocaleString('zh-CN');
    }

    // ⑤ 从 profiles 表预填学生上次写过的资料（如果存在且用户还没点恢复草稿）
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
            if (el && !el.value) el.value = String(profile[f]);
          }
        }
        if (!loadedDraft) {
          showAlert(alertEl, 'info',
            'ℹ️ 已自动预填您上次保存的个人资料，可修改后再提交报名。');
        }
      }
    } catch (pfLoadErr) {
      console.warn('[register] profiles 预填失败，忽略：', pfLoadErr);
    }

    // ⑥ 开启草稿自动保存
    startDraftAutoSave();
  } catch (bootErr) {
    console.error('[register] 初始化失败：', bootErr);
    showAlert(alertEl, 'error', '❌ ' + (bootErr.message || '页面初始化失败，请刷新重试'));
  }
})();

// ---------- 草稿 UI 绑定 ----------
function bindDraftUI() {
  $('draft-restore').addEventListener('click', () => {
    if (!loadedDraft) return;
    restoreDraft(loadedDraft);
    $('draft-banner').style.display = 'none';
    showAlert(alertEl, 'info', '✅ 草稿已恢复，您可以继续编辑后提交。');
  });
  $('draft-discard').addEventListener('click', () => {
    if (!confirm('确定要舍弃这份未提交的草稿吗？操作无法撤销。')) return;
    if (CURRENT_USER) clearDraft(CURRENT_USER.id);
    loadedDraft = null;
    $('draft-banner').style.display = 'none';
  });
}

// ---------- 切换邮箱：退出后跳登录页 ----------
logoutLink?.addEventListener('click', async (e) => {
  e.preventDefault();
  stopDraftAutoSave();
  try { await supabase.auth.signOut(); } catch (_) {}
  location.href = 'login.html?redirect=' + encodeURIComponent('register.html');
});

// ========================================================
// 草稿存储 & 读取（localStorage，key = draft_<uid>）
// ========================================================
function DRAFT_KEY(uid) { return `draft_${uid}`; }

function collectDraftValues() {
  const obj = {};
  for (const f of DRAFT_FIELDS) {
    const el = document.getElementById(f);
    if (el) obj[f] = el.value || '';
  }
  obj.__savedAt = Date.now();
  return obj;
}

function saveDraft() {
  if (!CURRENT_USER) return;
  try {
    const d = collectDraftValues();
    // 如果所有字段都为空 → 不保存
    const nonEmpty = Object.entries(d).some(([k,v]) => !k.startsWith('__') && v);
    if (!nonEmpty) return;
    localStorage.setItem(DRAFT_KEY(CURRENT_USER.id), JSON.stringify(d));
    flashSaveHint();
  } catch (e) { console.warn('saveDraft 失败', e); }
}

function loadDraft(uid) {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(uid));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function clearDraft(uid) {
  try { localStorage.removeItem(DRAFT_KEY(uid)); } catch {}
}

function restoreDraft(d) {
  if (!d) return;
  for (const f of DRAFT_FIELDS) {
    if (d[f] != null && d[f] !== '') {
      const el = document.getElementById(f);
      if (el) el.value = String(d[f]);
    }
  }
}

function flashSaveHint() {
  const el = $('draft-save-hint');
  if (!el) return;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1500);
}

// 防抖：任何 input 事件 1.5s 后保存
// 定时：每 10s 强制保存一次（防止用户一直打字）
function startDraftAutoSave() {
  // input 防抖保存
  form?.addEventListener('input', () => {
    clearTimeout(draftDirtyTimer);
    draftDirtyTimer = setTimeout(saveDraft, 1500);
  });
  // 离开页面前再保存一次
  window.addEventListener('beforeunload', saveDraft);
  // 10s 定时保存
  draftIntervalTimer = setInterval(saveDraft, 10000);
}
function stopDraftAutoSave() {
  clearTimeout(draftDirtyTimer);
  clearInterval(draftIntervalTimer);
  window.removeEventListener('beforeunload', saveDraft);
}

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

    setLoading(submitBtn, true, '正在提交报名...');

    // ④ 更新 profiles（学生档案，便于以后登录可以随时修改个人资料）
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

    // ⑤ 最后插入当次报名申请（registrations = 一次招新一次记录，审批状态挂这）
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
      if ((regErr.message || '').includes('duplicate')
          || (regErr.message || '').toLowerCase().includes('unique')) {
        throw new Error('您使用当前邮箱已经提交过一次报名，无需重复提交。可登录后查看审批状态。');
      }
      throw regErr;
    }

    // ⑥ 提交成功 → 清空草稿 + 停掉自动保存
    stopDraftAutoSave();
    clearDraft(user.id);
    loadedDraft = null;

    showAlert(alertEl, 'success',
      '🎉 报名提交成功！<br/>' +
      '我们会在 48 小时内完成审核，结果将通过邮箱（' + data.email + '）通知您。<br/>' +
      '🔐 如需设置/修改登录密码，请到 <a href="change-password.html" style="color:var(--accent-cyan);text-decoration:underline;">密码管理页</a> 操作，下次登录更方便。' +
      '<br/><span style="font-size:0.85rem;color:var(--text-muted);">即将跳转到首页，您可随时从登录页查询审批进度。</span>'
    );
    submitBtn.disabled = true;
    submitBtn.innerHTML = '✅ 报名已提交';

    setTimeout(() => { location.href = 'index.html'; }, 2400);
  } catch (err) {
    console.error('register submit err', err);
    const raw = (err && err.message) ? err.message : String(err || '提交失败，请稍后重试');
    // ─────────────────── 已知类型错误 → 友好指引 ───────────────────
    if (String(err && err.code) === '42501' ||
        /row-level security|violates row-level|permission denied|insufficient privilege|RLS|policy.*violation/i.test(raw)) {
      const fix = confirm(
        `🚨 报名被 RLS（行级安全策略）拦截 → 缺少 profiles/registrations 表 INSERT 策略。\n\n` +
        `【修复步骤 · 只需 1 次，2 分钟】\n\n` +
        `1. 打开 Supabase SQL Editor：\n` +
        `   https://supabase.com/dashboard/project/xiyaelfbkjnukfeipcwv/sql/new\n\n` +
        `2. 打开项目文件：supabase\\02-fix-rls-profiles.sql\n` +
        `   全选 → 复制 → 粘贴到 SQL Editor\n\n` +
        `3. 点右下角绿色 ▶ Run（看到 Success. No rows returned 即成功）\n\n` +
        `4. 回到本页，再次点击「提交报名申请」。\n\n` +
        `👉 点击【确定】：复制 SQL 文件路径到剪贴板 + 新标签页打开 SQL Editor\n` +
        `👉 点击【取消】：返回继续操作`
      );
      if (fix) {
        try {
          await navigator.clipboard.writeText('c:\\Users\\ASUS\\Desktop\\大创比赛\\招新网站\\supabase\\02-fix-rls-profiles.sql');
          window.open('https://supabase.com/dashboard/project/xiyaelfbkjnukfeipcwv/sql/new', '_blank');
          showAlert(alertEl, 'info',
            '📋 已复制 SQL 路径到剪贴板，SQL Editor 已在新标签页打开。<br/>' +
            '粘贴 02-fix-rls-profiles.sql 内容运行后，回到本页再次提交即可。');
        } catch (_) {
          showAlert(alertEl, 'info',
            '请手动打开：<code>c:\\Users\\ASUS\\Desktop\\大创比赛\\招新网站\\supabase\\02-fix-rls-profiles.sql</code><br/>' +
            '复制内容 → 粘贴到 Supabase SQL Editor 运行后重试。');
          window.open('https://supabase.com/dashboard/project/xiyaelfbkjnukfeipcwv/sql/new', '_blank');
        }
      }
      setLoading(submitBtn, false);
      return;
    }
    showAlert(alertEl, 'error', '❌ ' + raw);
    setLoading(submitBtn, false);
  }
});
