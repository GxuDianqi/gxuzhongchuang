/* ========================================================
 * admin.js — 管理员审批后台
 *
 * 功能：
 *   1. 权限校验：仅 is_admin=true 的账号可进入
 *   2. 列表展示：全部报名，支持状态 / 方向 / 搜索筛选
 *   3. 详情查看：模态框展示完整报名信息
 *   4. 审批操作：通过 / 拒绝（带备注，邮件通知）
 *   5. 数据统计 & CSV 导出
 * ======================================================== */
import {
  supabase, STATUS_LABEL, showAlert, hideAlert, setLoading, isCurrentUserAdmin,
} from './supabase-init.js';

// ======== 元素 ========
const $ = (id) => document.getElementById(id);
const loginRequired = $('login-required');
const permDenied   = $('permission-denied');
const adminPanel   = $('admin-panel');
const userEmailEl  = $('user-email');
const navUser      = $('nav-user');
const tbody        = $('registrations-body');

const filterStatus = $('filter-status');
const filterDept   = $('filter-dept');
const filterSearch = $('filter-search');

const statTotal    = $('stat-total');
const statPending  = $('stat-pending');
const statApproved = $('stat-approved');
const statRejected = $('stat-rejected');

const modalMask  = $('detail-modal');
const modalBody  = $('detail-body');
const modalClose = $('modal-close');

// 缓存
let allRows = [];

// ======== 1. 权限校验 ========
async function bootstrap() {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    loginRequired.style.display = 'block';
    return;
  }

  // 渲染右上角
  navUser.style.display = 'flex';
  userEmailEl.textContent = user.email;
  $('btn-logout').addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.href = 'login.html';
  });
  $('btn-as-user').addEventListener('click', () => location.href = 'index.html');

  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) {
    permDenied.style.display = 'block';
    return;
  }

  adminPanel.style.display = 'block';
  bindEvents();
  loadData();
}

// ======== 2. 事件绑定 ========
function bindEvents() {
  filterStatus.addEventListener('change', renderRows);
  filterDept.addEventListener('change', renderRows);
  filterSearch.addEventListener('input', debounce(renderRows, 250));
  $('btn-refresh').addEventListener('click', loadData);
  $('btn-export').addEventListener('click', exportCSV);
  modalClose.addEventListener('click', () => modalMask.classList.remove('show'));
  modalMask.addEventListener('click', (e) => {
    if (e.target === modalMask) modalMask.classList.remove('show');
  });
}

// ======== 3. 加载数据 ========
async function loadData() {
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
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="10" class="empty" style="color:var(--danger);">
      加载失败：${err.message || err}<br/>
      <span style="color:var(--text-muted);font-size:0.85rem;">
      如出现 403/权限错误，请确认已在 Supabase SQL Editor 中运行 schema.sql，并确认当前账号 is_admin=true。
      </span></td></tr>`;
  }
}

function updateStats() {
  statTotal.textContent    = allRows.length;
  statPending.textContent  = allRows.filter(r => r.status === 'pending').length;
  statApproved.textContent = allRows.filter(r => r.status === 'approved').length;
  statRejected.textContent = allRows.filter(r => r.status === 'rejected').length;
}

// ======== 4. 筛选 + 渲染 ========
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
        <td><span class="status-badge ${st.cls}">${st.text}</span></td>
        <td style="font-size:0.8rem;color:var(--text-muted);white-space:nowrap;">${created}</td>
        <td class="actions">
          <button class="btn btn-outline" onclick="window.__ADMIN__.showDetail('${r.id}')">详情</button>
          ${r.status === 'pending' ? `
            <button class="btn btn-success" onclick="window.__ADMIN__.approve('${r.id}')">通过</button>
            <button class="btn btn-danger"  onclick="window.__ADMIN__.reject('${r.id}')">拒绝</button>
          ` : `
            <button class="btn btn-outline" onclick="window.__ADMIN__.reset('${r.id}')">重置</button>
          `}
        </td>
      </tr>
    `;
  }).join('');
}

// ======== 5. 详情 & 审批操作 ========
function findRow(id) { return allRows.find(r => r.id === id); }

function showDetail(id) {
  const r = findRow(id);
  if (!r) return;
  const st = STATUS_LABEL[r.status] || STATUS_LABEL.pending;
  modalBody.innerHTML = `
    <div class="detail-grid">
      <div class="dt">审批状态</div><div class="dd ${st.cls}"><strong>${st.text}</strong></div>
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
  const note = prompt(`✅ 通过【${r.name}】(${r.student_id}) 的申请？\n可选：填写备注（面试安排 / QQ群号 等，将保存在记录中）：`, '恭喜通过！后续将通过邮箱+短信通知面试安排，请留意。');
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
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('registrations')
      .update({
        status,
        review_note: review_note || null,
        reviewed_at: status === 'pending' ? null : new Date().toISOString(),
        reviewer_id: status === 'pending' ? null : user?.id,
      })
      .eq('id', id);
    if (error) throw error;
    // 局部刷新（不重新拉全表，直接更新缓存）
    const idx = allRows.findIndex(r => r.id === id);
    if (idx >= 0) {
      allRows[idx] = {
        ...allRows[idx],
        status,
        review_note: review_note || null,
        reviewed_at: status === 'pending' ? null : new Date().toISOString(),
        reviewer_id: status === 'pending' ? null : user?.id,
      };
    }
    updateStats(); renderRows();
  } catch (err) {
    alert('操作失败：' + (err.message || err));
  }
}

// ======== 6. CSV 导出 ========
function exportCSV() {
  if (allRows.length === 0) { alert('暂无数据可导出'); return; }
  const headers = [
    '状态','报名时间','审批时间','姓名','性别','学号','邮箱','手机','学院','专业','年级',
    '第一志愿','第二志愿','已有技能','自我介绍','期望/问题','审批备注',
  ];
  const lines = [headers.map(csvEscape).join(',')];
  allRows.forEach(r => {
    lines.push([
      (STATUS_LABEL[r.status]?.text || r.status),
      fmt(r.created_at),
      r.reviewed_at ? fmt(r.reviewed_at) : '',
      r.name, r.gender||'', r.student_id, r.email, r.phone||'',
      r.college, r.major, r.grade||'',
      r.first_department||'', r.second_department||'',
      r.skills||'', r.motivation||'', r.expectation||'',
      r.review_note||'',
    ].map(csvEscape).join(','));
  });
  const bom = '\ufeff'; // Excel 中文兼容
  const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `招新报名数据_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ======== 工具 ========
function debounce(fn, wait) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
}
function fmt(iso) {
  try { return new Date(iso).toLocaleString('zh-CN'); } catch { return iso||''; }
}
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function csvEscape(s) {
  if (s == null) return '""';
  const v = String(s).replace(/"/g,'""');
  return `"${v}"`;
}

// 全局暴露给 onclick 使用
window.__ADMIN__ = { showDetail, approve, reject, reset };

// 启动
bootstrap();
