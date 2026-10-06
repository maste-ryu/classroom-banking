const config = window.APP_CONFIG || {};
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const state = { supabase: null, user: null, profile: null, classroomId: null, students: [], transactions: [], products: [], balances: new Map(), photoUrls: new Map() };
const pageTitles = { overview: ['ACCOUNT OVERVIEW', '帳戶總覽'], transactions: ['ACCOUNT LEDGER', '交易流水'], students: ['STUDENT ACCOUNTS', '學生帳戶'], store: ['CLASSROOM STORE', '班級商店'] };
const transactionLabels = { reward: '薪資入帳', penalty: '扣薪', purchase: '商品兌換', adjustment: '帳務更正' };
const fmt = n => new Intl.NumberFormat('zh-TW').format(Number(n || 0));
const money = n => `$${fmt(n)}`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const show = id => { document.getElementById(id).classList.remove('hidden'); };
const hide = id => { document.getElementById(id).classList.add('hidden'); };

function showError(target, message) { target.textContent = message; }
function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
}
function errorMessage(error) {
  const message = error?.message || '操作失敗，請稍後再試。';
  if (/insufficient|餘額不足/i.test(message)) return '帳戶餘額不足，無法兌換。';
  if (/account_in_debt/i.test(message)) return '帳戶目前為負餘額，暫停兌換。';
  if (/not available|not_available|庫存/i.test(message)) return '商品或學生目前無法兌換，或商品庫存不足。';
  return message;
}
function setPage(page) {
  $$('.page').forEach(node => node.classList.toggle('active-page', node.id === `page-${page}`));
  $$('.nav-item').forEach(node => node.classList.toggle('active', node.dataset.page === page));
  const [eyebrow, title] = pageTitles[page] || pageTitles.overview;
  $('#page-eyebrow').textContent = eyebrow;
  $('#page-title').textContent = title;
  history.replaceState(null, '', `#${page}`);
}
function avatarText(name) { return String(name || '學').trim().slice(0, 1); }
function currentBalance(studentId) { return state.balances.get(studentId) || 0; }
function getStudent(id) { return state.students.find(student => student.id === id); }
function stackCoins(balance) {
  const count = balance <= 0 ? 0 : Math.min(6, Math.max(1, Math.ceil(Math.log10(Number(balance) + 1) * 1.45)));
  return Array.from({ length: 6 }, (_, index) => `<i class="coin ${index >= count ? 'empty' : ''}"></i>`).join('');
}
function studentCard(student, editable = false, portrait = false) {
  const balance = currentBalance(student.id);
  const negative = balance < 0;
  const photoUrl = state.photoUrls.get(student.id);
  const avatar = photoUrl ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(student.name)}照片">` : escapeHtml(avatarText(student.name));
  const editButton = editable ? `<button type="button" class="button secondary student-edit-button" data-edit-student="${escapeHtml(student.id)}">編輯資料</button>` : '';
  const coinStack = portrait ? `<div class="student-coin-area"><div class="coin-stack student-coin-stack" aria-hidden="true">${stackCoins(balance)}</div><small class="student-coin-caption">金幣堆疊</small></div>` : '';
  return `<article class="student-card${portrait ? ' student-card-portrait' : ''}"><div class="student-avatar">${avatar}</div><div class="student-info"><h3>${escapeHtml(student.name)}</h3><small>${student.seat_number ? `座號 ${escapeHtml(student.seat_number)}` : '學生帳戶'}</small></div>${coinStack}<div class="student-money"><b class="${negative ? 'amount-cell negative' : ''}">${money(balance)}</b><small>${negative ? '負債狀態' : '帳戶總餘額'}</small></div>${editButton}</article>`;
}
function transactionRow(transaction) {
  const student = transaction.students || getStudent(transaction.student_id) || { name: '學生' };
  const amount = Number(transaction.amount);
  const timestamp = new Date(transaction.created_at).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const actor = transaction.created_by ? `操作人 ${escapeHtml(transaction.created_by.slice(0, 8))}` : '操作人';
  return `<div class="ledger-row"><div class="ledger-name"><span class="mini-avatar">${escapeHtml(avatarText(student.name))}</span><strong>${escapeHtml(student.name)}<small class="row-date">${timestamp}</small></strong></div><span class="type-pill ${escapeHtml(transaction.transaction_type)}">${transactionLabels[transaction.transaction_type] || '交易'}</span><span class="memo-cell" title="${escapeHtml(transaction.memo)}">${escapeHtml(transaction.memo)}<small class="row-actor">${actor}</small></span><span class="amount-cell ${amount < 0 ? 'negative' : 'positive'}">${amount > 0 ? '+' : ''}${money(amount)}</span></div>`;
}
function renderLedger(target, transactions) {
  if (!transactions.length) {
    target.innerHTML = '<div class="empty-state">目前沒有交易紀錄</div>';
    return;
  }
  target.innerHTML = `<div class="ledger-head"><span>學生 / 日期</span><span>交易類型</span><span>交易備註 / 操作人</span><span class="align-right">金額</span></div>${transactions.map(transactionRow).join('')}`;
}
function render() {
  if (!state.balances.size) state.balances = new Map(state.students.map(student => [student.id, 0]));
  $('#overview-students').innerHTML = state.students.slice(0, 2).map(student => studentCard(student, false, true)).join('') || '<div class="empty-state panel">新增學生後，帳戶會顯示在這裡。</div>';
  $('#all-students').innerHTML = state.students.map(student => studentCard(student, true)).join('') || '<div class="empty-state panel">尚未建立學生帳戶。</div>';
  renderLedger($('#recent-transactions'), state.transactions.slice(0, 6));
  renderFilteredTransactions();
  renderProducts();
  fillStudentSelects();
}
function renderFilteredTransactions() {
  const query = ($('#transaction-search')?.value || '').trim().toLocaleLowerCase();
  const type = $('#type-filter')?.value || 'all';
  const filtered = state.transactions.filter(transaction => {
    const student = transaction.students || getStudent(transaction.student_id) || {};
    const matchesType = type === 'all' || transaction.transaction_type === type;
    const searchable = `${student.name || ''} ${transaction.memo || ''} ${transactionLabels[transaction.transaction_type] || ''}`.toLocaleLowerCase();
    return matchesType && searchable.includes(query);
  });
  renderLedger($('#all-transactions'), filtered);
}
function fillStudentSelects() {
  const options = state.students.map(student => `<option value="${escapeHtml(student.id)}">${escapeHtml(student.name)}${student.seat_number ? `（${escapeHtml(student.seat_number)}）` : ''}</option>`).join('');
  $$('select[name="student_id"]').forEach(select => { select.innerHTML = options || '<option value="">請先新增學生</option>'; });
  const products = state.products.filter(product => product.is_active).map(product => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}　${money(product.price)}</option>`).join('');
  const productSelect = $('#redemption-form select[name="product_id"]');
  productSelect.innerHTML = products || '<option value="">目前沒有可兌換商品</option>';
}
function renderProducts() {
  const target = $('#products-grid');
  if (!state.products.length) {
    target.innerHTML = '<div class="empty-state panel">商店目前沒有商品，教師可以新增第一項獎勵。</div>';
    return;
  }
  target.innerHTML = state.products.filter(product => product.is_active).map((product, index) => `<article class="product-card"><div class="product-art">${['✦', '◈', '✿'][index % 3]}</div><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description || '班級商店獎勵')}</p><div class="product-bottom"><span class="product-price">${money(product.price)}</span><span class="product-stock">${product.stock_quantity == null ? '不限量' : `庫存 ${fmt(product.stock_quantity)}`}</span></div><button class="button secondary" data-redeem="${escapeHtml(product.id)}" ${product.stock_quantity === 0 ? 'disabled' : ''}>為學生操作兌換</button></article>`).join('') || '<div class="empty-state panel">目前沒有啟用中的商品。</div>';
}
function openDialog(id) {
  const dialog = document.getElementById(id);
  if (!state.students.length && ['transaction-dialog', 'redemption-dialog'].includes(id)) {
    toast('請先建立學生帳戶。');
    if (id === 'redemption-dialog') setPage('students');
    else $('#student-dialog').showModal();
    return;
  }
  dialog.querySelector('.dialog-error')?.replaceChildren();
  dialog.showModal();
}
function openStudentEditor(studentId) {
  const student = getStudent(studentId);
  if (!student) return;
  const form = $('#student-edit-form');
  form.elements.student_id.value = student.id;
  form.elements.display_name.value = student.name;
  form.elements.seat_number.value = student.seat_number ?? '';
  form.elements.photo.value = '';
  $('.dialog-error', form).textContent = '';
  const preview = $('#student-photo-preview');
  const photoUrl = state.photoUrls.get(student.id);
  if (photoUrl) { preview.src = photoUrl; preview.classList.remove('hidden'); }
  else { preview.removeAttribute('src'); preview.classList.add('hidden'); }
  $('#student-dialog').close();
  $('#student-edit-dialog').showModal();
}
async function submitStudentEdit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const student = getStudent(String(values.get('student_id')));
  const file = values.get('photo');
  const error = $('.dialog-error', form);
  const submitButton = $('button[type="submit"]', form);
  const originalLabel = submitButton.textContent;
  if (!student) { showError(error, '找不到這位學生，請重新整理後再試。'); return; }
  if (file?.size && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { showError(error, '照片請使用 JPG、PNG 或 WebP 格式。'); return; }
  if (file?.size > 5 * 1024 * 1024) { showError(error, '照片大小不可超過 5 MB。'); return; }
  const seat = String(values.get('seat_number') || '').trim();
  let uploadedPath = null;
  error.textContent = '';
  submitButton.disabled = true;
  submitButton.textContent = '儲存中…';
  try {
    const changes = { name: String(values.get('display_name')).trim(), seat_number: seat ? Number(seat) : null };
    if (file?.size) {
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
      const uniqueName = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      uploadedPath = `${state.classroomId}/${student.id}/${uniqueName}.${extension}`;
      const upload = await state.supabase.storage.from('student-photos').upload(uploadedPath, file, { contentType: file.type, upsert: false });
      if (upload.error) { showError(error, errorMessage(upload.error)); return; }
      changes.photo_path = uploadedPath;
    }
    const result = await state.supabase.from('students').update(changes).eq('id', student.id).eq('classroom_id', state.classroomId).select('id').single();
    if (result.error) {
      if (uploadedPath) await state.supabase.storage.from('student-photos').remove([uploadedPath]);
      showError(error, errorMessage(result.error));
      return;
    }
    form.closest('dialog').close();
    form.reset();
    if (uploadedPath && student.photo_path) await state.supabase.storage.from('student-photos').remove([student.photo_path]);
    await refreshAfterMutation('學生資料已更新');
  } catch (requestError) {
    if (uploadedPath) await state.supabase.storage.from('student-photos').remove([uploadedPath]);
    showError(error, errorMessage(requestError));
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
}
function setupDialogs() {
  $$('[data-open]').forEach(button => button.addEventListener('click', () => openDialog(button.dataset.open)));
  $$('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  $$('[data-page]').forEach(button => button.addEventListener('click', () => setPage(button.dataset.page)));
  $$('.nav-item').forEach(button => button.addEventListener('click', () => setPage(button.dataset.page)));
  document.addEventListener('click', event => {
    const editStudent = event.target.closest('[data-edit-student]');
    if (editStudent) { openStudentEditor(editStudent.dataset.editStudent); return; }
    const redeem = event.target.closest('[data-redeem]');
    if (redeem) {
      openDialog('redemption-dialog');
      $('#redemption-form [name="product_id"]').value = redeem.dataset.redeem;
      updateRedemptionPreview();
    }
  });
  $('#transaction-search').addEventListener('input', renderFilteredTransactions);
  $('#type-filter').addEventListener('change', renderFilteredTransactions);
  $('#redemption-form [name="student_id"]').addEventListener('change', updateRedemptionPreview);
  $('#redemption-form [name="product_id"]').addEventListener('change', updateRedemptionPreview);
  $('#signout-button').addEventListener('click', () => state.supabase.auth.signOut());
  $('#transaction-form').addEventListener('submit', submitTransaction);
  $('#redemption-form').addEventListener('submit', submitRedemption);
  $('#student-form').addEventListener('submit', submitStudent);
  $('#student-edit-form').addEventListener('submit', submitStudentEdit);
  $('#product-form').addEventListener('submit', submitProduct);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') $$('dialog[open]').forEach(dialog => dialog.close()); });
}
function updateRedemptionPreview() {
  const student = getStudent($('#redemption-form [name="student_id"]').value);
  const product = state.products.find(item => item.id === $('#redemption-form [name="product_id"]').value);
  const preview = $('#redemption-preview');
  if (!student || !product) { preview.textContent = '選擇學生與商品後顯示扣款預覽'; return; }
  const balance = currentBalance(student.id);
  const after = balance - Number(product.price);
  preview.innerHTML = `目前餘額 <strong>${money(balance)}</strong><br>兌換「${escapeHtml(product.name)}」扣款 <strong>−${money(product.price)}</strong><br>兌換後餘額 <strong>${money(after)}</strong>`;
}
async function loadState() {
  const [studentsResult, balancesResult, transactionsResult, productsResult] = await Promise.all([
    state.supabase.from('students').select('id,name,seat_number,photo_path,created_at').eq('classroom_id', state.classroomId).eq('is_active', true).order('seat_number', { ascending: true, nullsFirst: false }).order('name'),
    state.supabase.from('account_balances').select('student_id,balance').eq('classroom_id', state.classroomId),
    state.supabase.from('transactions').select('id,student_id,transaction_type,amount,memo,created_at,created_by').eq('classroom_id', state.classroomId).order('created_at', { ascending: false }).limit(500),
    state.supabase.from('store_products').select('id,name,product_type,description,price,stock_quantity,is_active').eq('classroom_id', state.classroomId).eq('is_active', true).order('created_at', { ascending: false })
  ]);
  for (const result of [studentsResult, balancesResult, transactionsResult, productsResult]) if (result.error) throw result.error;
  state.students = studentsResult.data || [];
  state.photoUrls.clear();
  await Promise.all(state.students.filter(student => student.photo_path).map(async student => {
    try {
      const { data, error } = await state.supabase.storage.from('student-photos').createSignedUrl(student.photo_path, 3600);
      if (!error && data?.signedUrl) state.photoUrls.set(student.id, data.signedUrl);
    } catch { /* Keep the initials avatar if a stored photo cannot be signed. */ }
  }));
  state.balances = new Map((balancesResult.data || []).map(account => [account.student_id, Number(account.balance)]));
  state.transactions = transactionsResult.data || [];
  state.products = productsResult.data || [];
  render();
}
async function submitTransaction(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const type = values.get('transaction_type');
  let amount = Number(values.get('amount'));
  if (type === 'reward') amount = Math.abs(amount);
  if (type === 'penalty') amount = -Math.abs(amount);
  const error = $('.dialog-error', form);
  if (!Number.isSafeInteger(amount) || amount === 0) { showError(error, '請輸入有效的整數金額。'); return; }
  const result = await state.supabase.from('transactions').insert({ classroom_id: state.classroomId, student_id: values.get('student_id'), transaction_type: type, amount, memo: String(values.get('memo')).trim() }).select('id').single();
  if (result.error) { showError(error, errorMessage(result.error)); return; }
  form.closest('dialog').close(); form.reset();
  await refreshAfterMutation('交易已入帳');
}
async function submitRedemption(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const error = $('.dialog-error', form);
  const result = await state.supabase.rpc('redeem_product', { p_classroom_id: state.classroomId, p_student_id: values.get('student_id'), p_product_id: values.get('product_id'), p_memo: String(values.get('memo') || '').trim() || null });
  if (result.error) { showError(error, errorMessage(result.error)); return; }
  form.closest('dialog').close(); form.reset();
  await refreshAfterMutation('兌換完成，扣款與品項已記錄');
}
async function submitStudent(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const seat = String(values.get('seat_number') || '').trim();
  const error = $('.dialog-error', form);
  const submitButton = $('button[type="submit"]', form);
  const originalLabel = submitButton.textContent;
  error.textContent = '';
  submitButton.disabled = true;
  submitButton.textContent = '建立中…';
  try {
    const result = await state.supabase.from('students').insert({ classroom_id: state.classroomId, name: String(values.get('display_name')).trim(), seat_number: seat ? Number(seat) : null }).select('id').single();
    if (result.error) { showError(error, errorMessage(result.error)); return; }
    form.closest('dialog').close(); form.reset();
    await refreshAfterMutation('學生帳戶已建立');
  } catch (requestError) {
    showError(error, errorMessage(requestError));
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
}
async function submitProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const stock = String(values.get('stock') || '').trim();
  const result = await state.supabase.from('store_products').insert({ classroom_id: state.classroomId, name: String(values.get('name')).trim(), product_type: values.get('product_type'), price: Number(values.get('price')), description: String(values.get('description') || '').trim() || null, stock_quantity: stock ? Number(stock) : null, is_active: true }).select('id').single();
  if (result.error) { showError($('.dialog-error', form), errorMessage(result.error)); return; }
  form.closest('dialog').close(); form.reset();
  await refreshAfterMutation('商店商品已新增');
}
async function refreshAfterMutation(message) {
  try { await loadState(); toast(message); }
  catch (error) { toast(`資料已送出，但畫面更新失敗：${errorMessage(error)}`); }
}
async function enterApp(user) {
  state.user = user;
  const { data: profile, error: profileError } = await state.supabase.from('profiles').select('display_name,role').eq('id', user.id).single();
  if (profileError || !profile || profile.role !== 'teacher') {
    await state.supabase.auth.signOut();
    show('login-screen');
    showError($('#login-error'), '此登入帳戶尚未設定為教師，請聯絡專案管理者。');
    return;
  }
  state.profile = profile;
  const { data: memberships, error } = await state.supabase.from('classroom_members').select('classroom_id,classrooms(name)').eq('user_id', user.id).eq('role', 'teacher').limit(1);
  if (error || !memberships?.length) {
    await state.supabase.auth.signOut();
    show('login-screen');
    showError($('#login-error'), '帳戶尚未加入班級，請先執行 Supabase 初始設定。');
    return;
  }
  state.classroomId = memberships[0].classroom_id;
  $('#teacher-avatar').textContent = avatarText(profile.display_name || user.email);
  const classroom = memberships[0].classrooms?.name;
  if (classroom) $('.welcome-row h2').textContent = `${classroom}，帳務一目了然。`;
  hide('login-screen'); hide('setup-screen'); show('app');
  try { await loadState(); }
  catch (loadError) { toast(`讀取帳戶資料失敗：${errorMessage(loadError)}`); }
}
async function initialize() {
  $('#today-label').textContent = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());
  setupDialogs();
  if (!config.supabaseUrl || !config.supabasePublishableKey || !window.supabase?.createClient) { show('setup-screen'); return; }
  state.supabase = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const { data, error } = await state.supabase.auth.signInWithPassword({ email: values.get('email'), password: values.get('password') });
    if (error) { showError($('#login-error'), errorMessage(error)); return; }
    await enterApp(data.user);
  });
  const { data: { session } } = await state.supabase.auth.getSession();
  if (session?.user) await enterApp(session.user); else show('login-screen');
  state.supabase.auth.onAuthStateChange((event, sessionState) => {
    if (event === 'SIGNED_OUT' || !sessionState) { hide('app'); show('login-screen'); state.user = null; state.classroomId = null; }
  });
  setPage(location.hash.slice(1) in pageTitles ? location.hash.slice(1) : 'overview');
}

initialize();
