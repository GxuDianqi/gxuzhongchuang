/* ========================================================
 * admin.js — 管理员审批后台（RBAC 二级分级版）
 *
 * 【角色权限】：
 *   ┌──────────────────┬──────────────┬──────────────┬──────────────┐
 *   │ 功能模块          │ 访客          │ 普通管理员    │ 超级管理员    │
 *   ├──────────────────┼──────────────┼──────────────┼──────────────┤
 *   │ 进入 admin.html  │ 跳登录页 ❌   │ ✅           │ ✅           │
 *   │ 📋 报名审核       │ 不可见 ❌     │ ✅ 全部操作   │ ✅ 全部操作   │
 *   │ 📢 通知公告       │ 不可见 ❌     │ ✅ 可见      │ ✅ 可见      │
 *   │ 📥 报名表导出     │ 不可见 ❌     │ ✅           │ ✅           │
 *   │ 👥 用户与权限管理 │ 不可见 ❌     │ ❌ DOM 删除  │ ✅           │
 *   │ 📥 用户清单导出   │ 不可见 ❌     │ ❌ DOM 删除  │ ✅           │
 *   │ 切换 is_admin     │ 不可用 ❌     │ ❌ 二次拦截  │ ✅           │
 *   └──────────────────┴──────────────┴──────────────┴──────────────┘
 *
 *  🔒 后端最后一道闸：public.set_admin() 函数内部也校验调用者邮箱，
 *     即使用户在浏览器控制台直接调 RPC 也无法绕过。
 * ======================================================== */
import {
  supabase, STATUS_LABEL, showAlert, hideAlert, setLoading, isCurrentUserAdmin,
} from './supabase-init.js';

// ---------- 工具 ----------
const $ = (id) => document.getElementById(id);
const SUPER_ADMIN_EMAIL = 'admin@gxu-ai.club'; // 🔒 最高管理员邮箱
let CURRENT_USER_IS_SUPER = false;             // 运行时缓存

// ---------- 通用 DOM ----------
const loginRequired = $('login-required');
const permDenied   = $('permission-denied');
const adminPanel   = $('admin-panel');
const userEmailEl  = $('user-email');
const navUser      = $('nav-user');
let CURRENT_USER_ID = null;
let CURRENT_USER_EMAIL = null;

// ---------- Tab ----------
const tabButtons  = document.querySelectorAll('.admin-tab');
const tabPanels   = document.querySelectorAll('.admin-tab-panel');

// ---------- 报名审核 ----------
const tbody        = $('registrations-body');
const filterStatus = $('filter-status');
const filterDept   = $('filter-dept');
const filterSearch = $('filter-search');
const statTotal    = $('stat-total');
const statPending  = $('stat-pending');
const statApproved = $('stat-approved');
const statRejected = $('stat-rejected');
const tabCountAudit = $('tab-count-audit');
const modalMask  = $('detail-modal');
const modalBody  = $('detail-body');
const modalClose = $('modal-close');
let allRows = [];

// ---------- 用户与权限 ----------
const usersBody   = $('users-body');
const userSearch  = $('user-search');
const tabCountUsers = $('tab-count-users');
let allUsers = [];

/* ========================================================
 * RBAC 0：是否当前账号是 SUPER_ADMIN（邮箱匹配）
 * ======================================================== */
async function isCurrentUserSuperAdmin() {
  if (CURRENT_USER_EMAIL) {
    return CURRENT_USER_EMAIL.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
  }
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !user.email) return false;
    return user.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
  } catch {
    return false;
  }
}

/* ========================================================
 * RBAC 1：启动 · 三层硬校验（访客 / 学生 / 管理员 / 超管）
 * ======================================================== */
async function bootstrap() {
  const { data: { user } } = await supabase.auth.getUser();

  // ① 未登录 → 强制跳登录
  if (!user) {
    loginRequired.style.display = 'block';
    setTimeout(() => {
      location.href = 'login.html?redirect=' + encodeURIComponent('admin.html');
    }, 1200);
    return;
  }

  CURRENT_USER_ID    = user.id;
  CURRENT_USER_EMAIL = user.email || '';
  CURRENT_USER_IS_SUPER = CURRENT_USER_EMAIL.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();

  // 右上
  navUser.style.display = 'flex';
  userEmailEl.textContent = `${user.email}${CURRENT_USER_IS_SUPER ? '  👑 (超级管理员)' : '  🛡 (普通管理员)'}`;
  $('btn-logout').addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.href = 'login.html';
  });
  $('btn-as-user').addEventListener('click', () => location.href = 'index.html');

  // ② 非管理员 → 3 秒跳首页
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) {
    permDenied.style.display = 'block';
    setTimeout(() => { location.href = 'index.html'; }, 3000);
    return;
  }

  // ③ 管理员通过 → 展开面板
  adminPanel.style.display = 'block';

  // ④ 【二级分级】普通管理员：移除所有 data-role="super" 的 DOM（删除不是隐藏，防控制台恢复）
  if (!CURRENT_USER_IS_SUPER) {
    const restricted = document.querySelectorAll('[data-role="super"]');
    restricted.forEach(el => el.remove());
    // 再加一个顶部 Banner 提示当前角色
    injectRoleBanner(false);
  } else {
    injectRoleBanner(true);
  }

  // ⑤ 事件绑定
  bindTabEvents();
  bindAuditEvents();
  // 用户管理相关事件：仅超级管理员绑定
  if (CURRENT_USER_IS_SUPER) bindUserEvents();
  bindExportEvents();

  // ⑥ 数据加载：报名审核无论普通/超管都加载；用户管理仅超管加载
  const tasks = [loadRegistrations()];
  if (CURRENT_USER_IS_SUPER) tasks.push(loadUsers());
  await Promise.all(tasks.map(p => p.catch(e => console.error('load err', e))));
}

/* ---------- 插入角色 Banner（在 Tab 容器前） ---------- */
function injectRoleBanner(isSuper) {
  const tabs = document.querySelector('.admin-tabs');
  if (!tabs) return;
  const banner = document.createElement('div');
  banner.style.cssText = `
    display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap;
    margin-bottom:16px; padding:12px 18px; border-radius:10px;
    background:${isSuper
      ? 'linear-gradient(90deg, rgba(168,85,247,0.16), rgba(168,85,247,0.04))'
      : 'linear-gradient(90deg, rgba(3,252,254,0.12), rgba(3,252,254,0.03))'};
    border:1px solid ${isSuper ? 'rgba(168,85,247,0.45)' : 'rgba(3,252,254,0.3)'};
    font-size:0.92rem; line-height:1.6;
    color:${isSuper ? '#e9d5ff' : '#bae6fd'};
  `;
  banner.innerHTML = isSuper
    ? `<div>👑 <b>当前账号身份：超级管理员</b>（${SUPER_ADMIN_EMAIL}）
         · 拥有全部权限：报名审批 / 用户与权限管理 / 通知公告 / 导出。</div>
       <div style="font-size:0.85rem;opacity:0.9;">🔒 本账号受系统保护：管理员身份不可被移除。</div>`
    : `<div>🛡 <b>当前账号身份：普通管理员</b>（${CURRENT_USER_EMAIL || ''}）
         · 可用：报名审批 / 通知公告 / 报名表导出。</div>
       <div style="font-size:0.85rem;opacity:0.9;">
          🔒 「用户与权限管理」及「用户清单导出」仅
          <span style="color:#e9d5ff;font-weight:700;">超级管理员 ${SUPER_ADMIN_EMAIL}</span> 可用，已自动隐藏。
       </div>`;
  tabs.parentElement.insertBefore(banner, tabs);
}

// ========================================================
// 2. Tab 切换
// ========================================================
function bindTabEvents() {
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // 二次保险：若被点击的 Tab 属于 super 但当前账号不是 super → 拦截
      if (btn.dataset.role === 'super' && !CURRENT_USER_IS_SUPER) {
        alert('🔒 「用户与权限管理」模块仅超级管理员可访问。');
        return;
      }
      const tab = btn.dataset.tab;
      tabButtons.forEach(b => b.classList.toggle('active', b === btn));
      tabPanels.forEach(p => p.classList.toggle('active', p.id === `tab-panel-${tab}`));
    });
  });
}

// ========================================================
// 3. 报名审核模块（普通管理员 + 超级管理员 均可用）
// ========================================================
function bindAuditEvents() {
  filterStatus.addEventListener('change', renderRows);
  filterDept.addEventListener('change', renderRows);
  filterSearch.addEventListener('input', debounce(renderRows, 250));
  $('btn-refresh').addEventListener('click', () => {
    loadRegistrations();
    if (CURRENT_USER_IS_SUPER) loadUsers();
  });
  modalClose.addEventListener('click', () => modalMask.classList.remove('show'));
  modalMask.addEventListener('click', (e) => {
    if (e.target === modalMask) modalMask.classList.remove('show');
  });
}

async function loadRegistrations() {
  tbody.innerHTML = '<tr><td colspan="10" class="empty">加载中...</td></tr>';
  try {
    const { data, error } = await supabase
      .from('registrations')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    allRows = data || [];
    updateStats();
    renderRows();
  } catch (err) { renderError(tbody, 10, err); }
}

function updateStats() {
  statTotal.textContent    = allRows.length;
  statPending.textContent  = allRows.filter(r => r.status === 'pending').length;
  statApproved.textContent = allRows.filter(r => r.status === 'approved').length;
  statRejected.textContent = allRows.filter(r => r.status === 'rejected').length;
  if (tabCountAudit) tabCountAudit.textContent = allRows.length;
  if (tabCountUsers && CURRENT_USER_IS_SUPER) tabCountUsers.textContent = allUsers.length;
}

function renderRows() {
  const s = filterStatus.value;
  const d = filterDept.value;
  const q = filterSearch.value.trim().toLowerCase();

  const rows = allRows.filter(r => {
    if (s && r.status !== s) return false;
    if (d && r.first_department !== d) return false;
    if (q) {
      const hay = `${r.name} ${r.student_id} ${r.email} ${r.phone} ${r.college} ${r.major}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty">暂无匹配的报名记录</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const st = STATUS_LABEL[r.status] || STATUS_LABEL.pending;
    const created = new Date(r.created_at).toLocaleString('zh-CN');
    return `
      <tr>
        <td><strong>${escapeHtml(r.name)}</strong></td>
        <td>${escapeHtml(r.student_id)}</td>
        <td>${escapeHtml(r.college)}<br/><span style="color:var(--text-muted);font-size:0.85rem;">${escapeHtml(r.major)}</span></td>
        <td>${escapeHtml(r.grade || '-')}</td>
        <td>${escapeHtml(r.first_department || '-')}</td>
        <td>${escapeHtml(r.phone || '-')}</td>
        <td style="color:var(--accent-cyan);font-size:0.85rem;">${escapeHtml(r.email)}</td>
        <td><span class="status-badge badge-${st.cls.split('-')[1] || 'pending'}">${st.text}</span></td>
        <td style="font-size:0.8rem;color:var(--text-muted);white-space:nowrap;">${created}</td>
        <td>
          <div class="actions">
            <button class="btn btn-outline" style="padding:4px 10px;font-size:0.8rem;" onclick="window.__ADMIN__.showDetail('${r.id}')">详情</button>
            ${r.status === 'pending' ? `
              <button class="btn btn-success" style="padding:4px 10px;font-size:0.8rem;" onclick="window.__ADMIN__.approve('${r.id}')">通过</button>
              <button class="btn btn-danger"  style="padding:4px 10px;font-size:0.8rem;" onclick="window.__ADMIN__.reject('${r.id}')">拒绝</button>
            ` : `
              <button class="btn btn-outline" style="padding:4px 10px;font-size:0.8rem;" onclick="window.__ADMIN__.reset('${r.id}')">重置</button>
            `}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function findRow(id) { return allRows.find(r => r.id === id); }
function showDetail(id) {
  const r = findRow(id); if (!r) return;
  const st = STATUS_LABEL[r.status] || STATUS_LABEL.pending;
  modalBody.innerHTML = `
    <div class="detail-grid">
      <div class="dt">审批状态</div><div class="dd badge-${st.cls.split('-')[1] || 'pending'}" style="display:inline-block;padding:3px 10px;border-radius:999px;"><strong>${st.text}</strong></div>
      <div class="dt">报名时间</div><div class="dd">${fmt(r.created_at)}</div>
      ${r.reviewed_at ? `<div class="dt">审批时间</div><div class="dd">${fmt(r.reviewed_at)}${r.reviewer_id ? `<br/><span style="color:var(--text-muted);font-size:0.8rem;">ID: ${r.reviewer_id}</span>` : ''}</div>` : ''}
      ${r.review_note ? `<div class="dt">审批备注</div><div class="dd" style="color:${r.status==='approved'?'var(--success)':'var(--danger)'};">${escapeHtml(r.review_note)}</div>` : ''}

      <div class="dt" style="margin-top:10px;border-top:1px solid var(--border-light);padding-top:10px;">姓　　名</div><div class="dd" style="margin-top:10px;border-top:1px solid var(--border-light);padding-top:10px;">${escapeHtml(r.name)}（${escapeHtml(r.gender||'-')}）</div>
      <div class="dt">学　　号</div><div class="dd">${escapeHtml(r.student_id)}</div>
      <div class="dt">学　　院</div><div class="dd">${escapeHtml(r.college)}</div>
      <div class="dt">专　　业</div><div class="dd">${escapeHtml(r.major)}</div>
      <div class="dt">年　　级</div><div class="dd">${escapeHtml(r.grade||'-')}</div>
      <div class="dt">联系手机</div><div class="dd">${escapeHtml(r.phone||'-')}</div>
      <div class="dt">联系邮箱</div><div class="dd">${escapeHtml(r.email)}</div>

      <div class="dt" style="margin-top:10px;border-top:1px solid var(--border-light);padding-top:10px;">第一志愿</div><div class="dd" style="margin-top:10px;border-top:1px solid var(--border-light);padding-top:10px;">${escapeHtml(r.first_department||'-')}</div>
      <div class="dt">第二志愿</div><div class="dd">${escapeHtml(r.second_department||'无 / 服从调剂')}</div>
      <div class="dt">已有技能</div><div class="dd">${escapeHtml(r.skills||'（未填写）')}</div>
      <div class="dt">自我介绍</div><div class="dd">${escapeHtml(r.motivation||'-').replace(/\n/g,'<br/>')}</div>
      <div class="dt">期望 / 问题</div><div class="dd">${escapeHtml(r.expectation||'（未填写）').replace(/\n/g,'<br/>')}</div>
    </div>
  `;
  modalMask.classList.add('show');
}

async function approve(id) {
  const r = findRow(id); if (!r) return;
  const note = prompt(`✅ 通过【${r.name}】(${r.student_id}) 的申请？\n可选：填写备注（面试安排 / QQ群号 等）：`, '恭喜通过！后续将通过邮箱+短信通知面试安排，请留意。');
  if (note === null) return;
  await setStatus(id, 'approved', note);
}
async function reject(id) {
  const r = findRow(id); if (!r) return;
  const note = prompt(`❌ 拒绝【${r.name}】(${r.student_id}) 的申请？\n必填：请简要说明原因：`);
  if (note === null) return;
  if (!note.trim()) { alert('必须填写拒绝原因'); return; }
  await setStatus(id, 'rejected', note.trim());
}
async function reset(id) {
  if (!confirm('确定重置该条记录为 "待审批" 状态吗？')) return;
  await setStatus(id, 'pending', '');
}
async function setStatus(id, status, review_note) {
  try {
    const { error } = await supabase
      .from('registrations')
      .update({
        status, review_note: review_note || null,
        reviewed_at: status === 'pending' ? null : new Date().toISOString(),
        reviewer_id: status === 'pending' ? null : CURRENT_USER_ID,
      })
      .eq('id', id);
    if (error) throw error;
    const idx = allRows.findIndex(r => r.id === id);
    if (idx >= 0) allRows[idx] = { ...allRows[idx], status, review_note: review_note||null,
      reviewed_at: status==='pending'?null:new Date().toISOString(), reviewer_id: status==='pending'?null:CURRENT_USER_ID };
    updateStats(); renderRows();
    alert('操作成功');
  } catch (err) { alert('操作失败：' + (err.message || err)); }
}

// ========================================================
// 4. 用户与权限模块【仅超管可用 · 二级分级】
//    🔒 三重收口：① 事件不绑定  ② DOM 已 remove  ③ 函数级硬拦截
// ========================================================
function bindUserEvents() {
  // 仅 super 绑定（在 bootstrap 里被调用）
  userSearch?.addEventListener('input', debounce(renderUsers, 250));
}

/** 🔒 函数级硬拦截 1：加载用户列表 */
async function loadUsers() {
  if (!CURRENT_USER_IS_SUPER) {
    // 理论上 DOM 已经被 remove，这个函数不会被触发；作为双保险
    if (usersBody) usersBody.innerHTML = '<tr><td colspan="10" class="empty" style="color:var(--danger)">🔒 仅超级管理员可查看用户清单</td></tr>';
    return;
  }
  usersBody.innerHTML = '<tr><td colspan="10" class="empty">加载中...</td></tr>';
  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, email, name, student_id, phone, college, major, is_admin, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    allUsers = profiles || [];
    if (tabCountUsers) tabCountUsers.textContent = allUsers.length;
    renderUsers();
  } catch (err) { renderError(usersBody, 10, err); }
}

function renderUsers() {
  const q = (userSearch?.value || '').trim().toLowerCase();
  const list = allUsers.filter(u => {
    if (!q) return true;
    const hay = `${u.email||''} ${u.name||''} ${u.student_id||''} ${u.phone||''}`.toLowerCase();
    return hay.includes(q);
  });

  if (list.length === 0) {
    usersBody.innerHTML = '<tr><td colspan="10" class="empty">暂无匹配用户</td></tr>';
    return;
  }

  const registeredEmails = new Set(allRows.map(r => r.email));

  usersBody.innerHTML = list.map(u => {
    const isSuper = (u.email || '').toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
    const hasReg = registeredEmails.has(u.email);
    const isAdminVal = !!u.is_admin;
    return `
      <tr>
        <td>${hasReg
            ? '<span class="status-badge badge-verified">🎓 已报名</span>'
            : '<span class="status-badge badge-unverified">👤 仅注册</span>'}</td>
        <td><strong>${escapeHtml(u.name || '-')}</strong></td>
        <td>${escapeHtml(u.student_id || '-')}</td>
        <td>
          <span style="font-family:'JetBrains Mono',monospace;color:var(--accent-cyan);font-size:0.85rem;">${escapeHtml(u.email||'-')}</span>
          ${isSuper ? '<span class="super-admin-badge">🔒 超管</span>' : ''}
        </td>
        <td>${escapeHtml(u.phone || '-')}</td>
        <td>${escapeHtml(u.college || '-')}${u.major?`<br/><span style="color:var(--text-muted);font-size:0.8rem;">${escapeHtml(u.major)}</span>`:''}</td>
        <td>${hasReg
            ? '<span class="status-badge badge-verified">已验证</span>'
            : '<span class="status-badge badge-unverified">待使用</span>'}</td>
        <td>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:nowrap;">
            <span class="status-badge ${isAdminVal ? 'badge-admin' : 'badge-user'}">
              ${isAdminVal ? '🛡 管理员' : '👤 学生'}
            </span>
            <span class="admin-toggle ${isAdminVal ? 'on' : ''} ${isSuper ? 'disabled' : ''}"
                  title="${isSuper ? '超级管理员受系统保护，不可修改' : (isAdminVal ? '点击降为学生' : '点击升为管理员')}"
                  onclick="window.__ADMIN__.toggleAdmin('${u.id}', '${escapeAttr(u.email)}')">
            </span>
          </div>
        </td>
        <td style="font-size:0.8rem;color:var(--text-muted);white-space:nowrap;">${fmt(u.created_at)}</td>
        <td>
          <div class="actions">
            <button class="btn btn-outline" style="padding:4px 10px;font-size:0.8rem;" onclick="window.__ADMIN__.userDetail('${u.id}')">查看</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * 🔒 函数级硬拦截 2：切换管理员权限
 *   1) 前端：仅 CURRENT_USER_IS_SUPER === true 才允许执行
 *   2) 目标保护：SUPER_ADMIN_EMAIL 永远不可被降级
 *   3) 后端最后一道：public.set_admin() 函数内部也判断调用者邮箱（见 SQL 脚本）
 */
async function toggleAdmin(userId, email) {
  // 【二级拦截】非超管 → 绝对禁止（即使有人通过 console 调 window.__ADMIN__.toggleAdmin 也无效）
  if (!CURRENT_USER_IS_SUPER) {
    alert('🔒 权限不足！\n\n只有超级管理员（' + SUPER_ADMIN_EMAIL + '）才能分配管理员权限。');
    return;
  }
  const u = allUsers.find(x => x.id === userId);
  if (!u) return;

  // 【保护】目标账号是最高管理员本人 → 永久禁止降级
  const isTargetSuper = (email || '').toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
  if (isTargetSuper) {
    alert(`🔒 【保护机制】\n\n最高管理员账号 ${SUPER_ADMIN_EMAIL} 禁止被移除管理员权限。\n如需变更，请直接在 Supabase Dashboard → Authentication 中手动操作。`);
    return;
  }

  const next = !u.is_admin;
  const verb = next ? '提升为管理员' : '降级为普通学生';
  if (!confirm(`【👑 超级管理员操作】\n\n确认要将【${u.name || email}】 (${email})\n\n从 ${u.is_admin ? '🛡 管理员' : '👤 学生'} ${verb} 吗？\n\n（操作会同步到 auth.users.app_metadata + profiles.is_admin）`)) {
    return;
  }

  try {
    const { error } = await supabase.rpc('set_admin', { user_id: userId, admin_flag: next });
    if (error) throw error;
    const idx = allUsers.findIndex(x => x.id === userId);
    if (idx >= 0) allUsers[idx] = { ...allUsers[idx], is_admin: next };
    renderUsers();
    alert(`✅ 权限变更成功：【${u.name || email}】已${verb}。\n\n⚠️ 若目标用户当前已登录，请让他退出再登录，以便刷新 JWT 中的 is_admin 声明。`);
  } catch (err) {
    console.error('toggleAdmin err', err);
    if (/function.*set_admin.*does not exist|不存在|不存在.*函数/i.test(err.message || '')) {
      if (!confirm(`⚠️ 数据库尚未定义 public.set_admin() 函数。\n\n是否使用降级方案（仅更新 profiles.is_admin，需目标用户重新登录才生效）？`)) return;
      try {
        const { error: err2 } = await supabase.from('profiles').update({ is_admin: next }).eq('id', userId);
        if (err2) throw err2;
        const idx = allUsers.findIndex(x => x.id === userId);
        if (idx >= 0) allUsers[idx] = { ...allUsers[idx], is_admin: next };
        renderUsers();
        alert('✅ profiles 字段已更新（降级方案）。\n目标用户退出再登录后权限生效。\n【强烈建议】在 Supabase SQL Editor 执行文末的 CREATE OR REPLACE FUNCTION set_admin 加固脚本。');
      } catch (e2) { alert('降级方案也失败：' + (e2.message || e2)); }
      return;
    }
    // 后端硬拦截命中：set_admin 函数内部报权限错
    if (/仅最高管理员|permission|denied|super.admin|must be|raise exception/i.test(err.message || '')) {
      alert('🔒 后端拒绝此操作：\n\n' + (err.message || err) + '\n\n请确认当前账号邮箱为 ' + SUPER_ADMIN_EMAIL);
      return;
    }
    alert('权限变更失败：' + (err.message || err));
  }
}

function userDetail(userId) {
  // 此函数普通管理员理论上也进不来（DOM被删），但加个小提示
  if (!CURRENT_USER_IS_SUPER) {
    alert('🔒 仅超级管理员可查看用户详细信息。');
    return;
  }
  const u = allUsers.find(x => x.id === userId);
  if (!u) return;
  const myRegs = allRows.filter(r => r.user_id === userId);
  const info = [
    `账号信息：`,
    `  · 姓名：${u.name || '（未填写）'}`,
    `  · 学号：${u.student_id || '（未填写）'}`,
    `  · 邮箱：${u.email || '-'}`,
    `  · 手机：${u.phone || '（未填写）'}`,
    `  · 学院：${u.college || '-'}${u.major ? ' / ' + u.major : ''}`,
    `  · 管理员：${u.is_admin ? '✅ 是' : '❌ 否'}`,
    `  · 注册时间：${fmt(u.created_at)}`,
    ``,
    `历史报名记录：共 ${myRegs.length} 条`,
    ...myRegs.map((r,i) => `  [${i+1}] ${(STATUS_LABEL[r.status]||{}).text || r.status} · ${r.first_department || '-'} · ${fmt(r.created_at)}`)
  ].join('\n');
  alert(info);
}

// ========================================================
// 5. 导出模块：报名表 CSV 全部管理员可导出
//          用户清单 CSV 仅超管（DOM 级 remove + 函数级双保险）
// ========================================================
function bindExportEvents() {
  $('btn-export').addEventListener('click', exportRegistrations);
  $('btn-export-users')?.addEventListener('click', exportUsersCSV);
}

function exportRegistrations() {
  if (allRows.length === 0) { alert('暂无数据可导出'); return; }
  const headers = ['状态','报名时间','审批时间','姓名','性别','学号','邮箱','手机','学院','专业','年级','第一志愿','第二志愿','已有技能','自我介绍','期望/问题','审批备注'];
  const lines = [headers.map(csvEscape).join(',')];
  allRows.forEach(r => {
    lines.push([
      (STATUS_LABEL[r.status]?.text || r.status),
      fmt(r.created_at), r.reviewed_at ? fmt(r.reviewed_at) : '',
      r.name, r.gender||'', r.student_id, r.email, r.phone||'',
      r.college, r.major, r.grade||'',
      r.first_department||'', r.second_department||'',
      r.skills||'', r.motivation||'', r.expectation||'',
      r.review_note||'',
    ].map(csvEscape).join(','));
  });
  downloadCSV(`招新报名数据_${todayStr()}.csv`, lines);
}

/** 🔒 函数级硬拦截 3：导出用户清单（含管理员权限信息，敏感） */
function exportUsersCSV() {
  if (!CURRENT_USER_IS_SUPER) {
    alert('🔒 仅超级管理员可导出用户账号清单（包含管理员权限状态字段）。');
    return;
  }
  if (allUsers.length === 0) { alert('暂无用户数据'); return; }
  const headers = ['邮箱','姓名','学号','手机','学院','专业','管理员权限','账号创建时间','报名状态'];
  const registeredEmails = new Set(allRows.map(r => r.email));
  const lines = [headers.map(csvEscape).join(',')];
  allUsers.forEach(u => {
    lines.push([
      u.email||'', u.name||'', u.student_id||'', u.phone||'',
      u.college||'', u.major||'',
      u.is_admin ? '是' : '否',
      fmt(u.created_at),
      registeredEmails.has(u.email) ? '已提交报名' : '未提交',
    ].map(csvEscape).join(','));
  });
  downloadCSV(`用户账号清单_${todayStr()}.csv`, lines);
}

// ========================================================
// 通用工具
// ========================================================
function renderError(hostEl, colspan, err) {
  console.error('加载失败详细：', err);
  const msg     = err?.message || String(err);
  const code    = err?.code    || '';
  const detail  = err?.details || '';
  let tip = '如持续出现，请截取 Console 中完整错误信息截图。';
  if (String(code).includes('42501') || /permission|policy|violation/i.test(msg + detail)) {
    tip = '<b>权限被拒 (RLS)</b>：请退出登录重新登录以刷新 JWT is_admin 声明；或确认 schema.sql 中 RLS 策略已更新为 auth.jwt() 版本。';
  } else if (/infinite recursion/i.test(msg + detail)) {
    tip = '<b>策略递归</b>：请重新运行"无递归 RLS 策略"的 SQL（替换 profiles/registrations 全部策略为 auth.jwt() 版本）。';
  }
  hostEl.innerHTML = `<tr><td colspan="${colspan}" class="empty" style="color:var(--danger);text-align:left;padding:24px;">
    <div><b>加载失败：</b>${msg}</div>
    ${code   ? `<div style="margin-top:4px;"><b>错误码：</b><code>${code}</code></div>` : ''}
    ${detail ? `<div style="margin-top:4px;"><b>原因：</b>${detail}</div>` : ''}
    <div style="margin-top:10px;padding:8px 10px;background:#1f2937;border-radius:6px;font-size:0.85rem;">${tip}</div>
  </td></tr>`;
}

function debounce(fn, wait) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); }; }
function fmt(iso) { try { return iso ? new Date(iso).toLocaleString('zh-CN') : ''; } catch { return iso||''; } }
function todayStr() { return new Date().toISOString().slice(0,10); }
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) {
  if (s == null) return '';
  return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
function csvEscape(s) {
  if (s == null) return '""';
  const v = String(s).replace(/"/g,'""');
  return `"${v}"`;
}
function downloadCSV(filename, lines) {
  const bom = '\ufeff';
  const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// 全局暴露给 onclick 使用（🔒 toggleAdmin 内部自身会二次校验权限）
window.__ADMIN__ = { showDetail, approve, reject, reset, toggleAdmin, userDetail };

bootstrap();
