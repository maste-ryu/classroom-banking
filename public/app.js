const config = window.APP_CONFIG || {};
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const state = { supabase: null, user: null, profile: null, classroomId: null, students: [], transactions: [], products: [], balances: new Map(), photoUrls: new Map(), productPhotoUrls: new Map(), publicStore: [], settings: { systemName: '班級薪資銀行', classroomName: '', showStudentAvatars: false, showSeatNumbers: true, transactionMemoOptions: ['完成作業', '協助班級工作'] } };
const pageTitles = { overview: ['ACCOUNT OVERVIEW', '帳戶總覽'], transactions: ['ACCOUNT LEDGER', '交易流水'], students: ['STUDENT ACCOUNTS', '學生帳戶'], store: ['CLASSROOM STORE', '班級商店'], settings: ['CLASSROOM SETTINGS', '基本設定'] };
const transactionLabels = { reward: '薪資入帳', penalty: '扣薪', purchase: '商品兌換', adjustment: '帳務更正' };
const fmt = n => new Intl.NumberFormat('zh-TW').format(Number(n || 0));
const money = n => `$${fmt(n)}`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const show = id => { document.getElementById(id).classList.remove('hidden'); };
const hide = id => { document.getElementById(id).classList.add('hidden'); };
function applyBranding(systemName, classroomName = '') {
  const name = systemName || '班級薪資銀行';
  document.title = name;
  $$('.brand b').forEach(node => { node.textContent = name; });
  $$('.brand').forEach(node => { node.setAttribute('aria-label', `${name}首頁`); });
  const appClassroom = $('.welcome-row h2');
  if (appClassroom && classroomName) appClassroom.textContent = `${classroomName}，帳務一目了然。`;
}

function showError(target, message) { target.textContent = message; }
function clearObjectUrls(map) {
  map.forEach(url => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); });
  map.clear();
}
async function trimProductPhoto(source) {
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
    const whiteBackground = corners.every(([x, y]) => {
      const i = (y * width + x) * 4;
      return data[i] > 225 && data[i + 1] > 225 && data[i + 2] > 225 && data[i + 3] > 200;
    });
    let left = 0, top = 0, right = width - 1, bottom = height - 1;
    if (whiteBackground) {
      left = width; top = height; right = -1; bottom = -1;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] < 32 || Math.min(data[i], data[i + 1], data[i + 2]) > 238) continue;
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
      if (right < left || bottom < top) { left = 0; top = 0; right = width - 1; bottom = height - 1; }
      const cropWidth = right - left + 1, cropHeight = bottom - top + 1;
      if (cropWidth < width * 0.94 || cropHeight < height * 0.94) {
        const padX = Math.round(cropWidth * 0.08), padY = Math.round(cropHeight * 0.08);
        left = Math.max(0, left - padX); top = Math.max(0, top - padY);
        right = Math.min(width - 1, right + padX); bottom = Math.min(height - 1, bottom + padY);
      } else { left = 0; top = 0; right = width - 1; bottom = height - 1; }
    }
    const x = Math.floor(left / scale), y = Math.floor(top / scale);
    const cropWidth = Math.min(bitmap.width - x, Math.ceil((right - left + 1) / scale));
    const cropHeight = Math.min(bitmap.height - y, Math.ceil((bottom - top + 1) / scale));
    const outputScale = Math.min(1, 1000 / Math.max(cropWidth, cropHeight));
    const output = document.createElement('canvas');
    output.width = Math.max(1, Math.round(cropWidth * outputScale));
    output.height = Math.max(1, Math.round(cropHeight * outputScale));
    const outputContext = output.getContext('2d');
    outputContext.fillStyle = '#fff';
    outputContext.fillRect(0, 0, output.width, output.height);
    outputContext.drawImage(bitmap, x, y, cropWidth, cropHeight, 0, 0, output.width, output.height);
    return await new Promise((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error('thumbnail failed')), 'image/jpeg', 0.88));
  } finally { bitmap.close?.(); }
}
function showPublicHome() {
  hide('setup-screen'); hide('login-screen'); hide('app'); show('public-screen');
  setPublicView('balances');
  loadPublicBalances();
}
function showTeacherLogin() {
  hide('public-screen'); hide('setup-screen'); show('login-screen');
  $('#login-error').textContent = '';
}
async function loadPublicBalances() {
  const list = $('#public-students');
  if (!list || !state.supabase) return;
  $('#public-refresh').disabled = true;
  list.innerHTML = '<div class="empty-state panel">正在載入帳戶資料…</div>';
  try {
    const { data, error } = await state.supabase.rpc('public_classroom_balances');
    if (error) throw error;
    const students = data || [];
    if (students[0]?.system_name) applyBranding(students[0].system_name, students[0].classroom_name);
    if (!students.length) {
      $('#public-classroom-name').textContent = '學生餘額總覽';
      $('#public-updated-at').textContent = '';
      list.innerHTML = '<div class="empty-state panel">目前沒有可顯示的帳戶資料，請洽詢教師。</div>';
      return;
    }
    const studentsWithPhotos = await Promise.all(students.map(async student => {
      if (!student.student_photo_path) return { ...student, photo_url: null };
      try {
        const { data: signedPhoto, error: photoError } = await state.supabase.storage.from('student-photos').createSignedUrl(student.student_photo_path, 300);
        return { ...student, photo_url: photoError ? null : signedPhoto?.signedUrl || null };
      } catch { return { ...student, photo_url: null }; }
    }));
    const maximumBalance = Math.max(0, ...studentsWithPhotos.map(student => Number(student.balance || 0)));
    $('#public-classroom-name').textContent = students[0].classroom_name || '學生餘額總覽';
    $('#public-updated-at').textContent = `更新於 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
    list.innerHTML = studentsWithPhotos.map(student => {
      const balance = Number(student.balance || 0);
      const seat = student.seat_number ? `座號 ${escapeHtml(student.seat_number)}` : '學生帳戶';
      const coinCount = coinCountFor(balance, maximumBalance);
      const stackHeight = coinCount ? 18 + coinCount * 11 : 0;
      const avatar = student.photo_url ? `<img src="${escapeHtml(student.photo_url)}" alt="">` : '';
      const details = student.transaction_details || [];
      const detailRows = details.length
        ? details.map(transaction => {
          const date = new Date(transaction.created_at).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
          const amount = Number(transaction.amount || 0);
          const typeLabel = transaction.transaction_type === 'reward' ? '入帳' : transactionLabels[transaction.transaction_type] || '交易';
          const note = transaction.note ? ` · 備註：${escapeHtml(transaction.note)}` : '';
          return `<article class="public-ledger-row"><div><strong>${escapeHtml(transaction.memo || '未填寫項目')}</strong><small>${date} · ${typeLabel}${note}</small></div><b class="${amount < 0 ? 'negative' : 'positive'}">${amount > 0 ? '+' : ''}${money(amount)}</b></article>`;
        }).join('')
        : '<p class="public-ledger-empty">目前沒有交易明細。</p>';
      return `<div class="public-student-group"><article class="public-student-card"><div class="public-student-profile"><span class="public-student-avatar" aria-hidden="true">${escapeHtml(avatarText(student.student_name))}${avatar}</span><span class="public-student-name"><strong>${escapeHtml(student.student_name)}</strong><small>${seat}</small></span></div><div class="public-balance-panel"><div class="public-coin-stack" style="height:${stackHeight}px" role="img" aria-label="金幣堆疊 ${coinCount} 層，依餘額比例顯示">${stackCoins(balance, maximumBalance)}</div><strong class="public-student-balance${balance < 0 ? ' negative' : ''}">${money(balance)}</strong><small>帳戶總餘額</small></div></article><section class="public-student-ledger" aria-label="${escapeHtml(student.student_name)}個人明細"><h2>${escapeHtml(student.student_name)}個人明細</h2><div class="public-ledger-scroll">${detailRows}</div></section></div>`;
    }).join('');
  } catch (error) {
    $('#public-classroom-name').textContent = '學生餘額總覽';
    list.innerHTML = `<div class="empty-state panel">讀取失敗：${escapeHtml(errorMessage(error))}<br>請稍後重新整理。</div>`;
  } finally {
    $('#public-refresh').disabled = false;
  }
}
function setPublicView(view) {
  const storeSelected = view === 'store';
  $('#public-balances-view')?.classList.toggle('hidden', storeSelected);
  $('#public-store-view')?.classList.toggle('hidden', !storeSelected);
  $$('.public-view-tab').forEach(button => {
    const active = button.dataset.publicView === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (storeSelected) loadPublicStore();
}
async function loadPublicStore() {
  const list = $('#public-store-products');
  const button = $('#public-store-refresh');
  if (!list || !state.supabase) return;
  button.disabled = true;
  list.innerHTML = '<div class="empty-state panel">正在載入班級商店…</div>';
  try {
    const { data, error } = await state.supabase.rpc('public_classroom_store');
    if (error) throw error;
    const products = data || [];
    state.publicStore = products;
    if (products[0]?.system_name) applyBranding(products[0].system_name, products[0].classroom_name);
    $('#public-store-classroom-name').textContent = products[0]?.classroom_name || '班級商店';
    if (!products.length) {
      list.innerHTML = '<div class="empty-state panel">目前沒有公開的商店商品，請洽詢教師。</div>';
      return;
    }
    const productsWithPhotos = await Promise.all(products.map(async product => {
      if (!product.product_photo_path) return { ...product, photo_url: null };
      try {
        const { data: signedPhoto, error: photoError } = await state.supabase.storage.from('product-photos').createSignedUrl(product.product_photo_path, 300);
        if (photoError || !signedPhoto?.signedUrl) return { ...product, photo_url: null };
        return { ...product, photo_url: signedPhoto.signedUrl };
      } catch { return { ...product, photo_url: null }; }
    }));
    list.innerHTML = productsWithPhotos.map((product, index) => {
      const stock = product.stock_quantity == null ? '不限量' : Number(product.stock_quantity) === 0 ? '暫時缺貨' : `剩餘 ${fmt(product.stock_quantity)} 件`;
      const type = product.product_type === 'experience' ? '體驗獎勵' : '實體商品';
      const art = product.photo_url ? `<img src="${escapeHtml(product.photo_url)}" alt="${escapeHtml(product.product_name)}">` : ['✦', '◈', '✿'][index % 3];
      return `<article class="public-product-card"><div class="public-product-art${product.photo_url ? ' has-photo' : ''}"${product.photo_url ? '' : ' aria-hidden="true"'}>${art}</div><div class="public-product-info"><span class="product-type-label">${type}</span><h2>${escapeHtml(product.product_name)}</h2><p>${escapeHtml(product.description || '班級商店獎勵')}</p><div class="public-product-bottom"><strong>${money(product.price)}</strong><small>${stock}</small></div></div></article>`;
    }).join('');
  } catch (error) {
    list.innerHTML = `<div class="empty-state panel">讀取班級商店失敗：${escapeHtml(errorMessage(error))}<br>請稍後重新整理。</div>`;
  } finally {
    button.disabled = false;
  }
}
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
function coinCountFor(balance, maximumBalance) {
  if (balance <= 0) return 0;
  return Math.max(1, Math.min(12, Math.ceil((Number(balance) / Math.max(Number(maximumBalance) || 0, 1)) * 12)));
}
function stackCoins(balance, maximumBalance) {
  const count = coinCountFor(balance, maximumBalance);
  return Array.from({ length: count }, (_, index) => `<i class="coin" style="bottom:${6 + index * 11}px"></i>`).join('');
}
function studentCard(student, editable = false, portrait = false, maximumBalance = 0) {
  const balance = currentBalance(student.id);
  const negative = balance < 0;
  const photoUrl = state.photoUrls.get(student.id);
  const avatar = photoUrl ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(student.name)}照片">` : escapeHtml(avatarText(student.name));
  const editButton = editable ? `<button type="button" class="button secondary student-edit-button" data-edit-student="${escapeHtml(student.id)}">編輯資料</button>` : '';
  const coinCount = coinCountFor(balance, maximumBalance);
  const stackHeight = Math.max(24, 18 + coinCount * 11);
  const coinStack = portrait ? `<div class="student-coin-area"><div class="coin-stack student-coin-stack" style="height:${stackHeight}px" aria-label="金幣堆疊，高度依帳戶餘額比例顯示">${stackCoins(balance, maximumBalance)}</div><small class="student-coin-caption">金幣堆疊</small></div>` : '';
  const profile = `<div class="student-avatar">${avatar}</div><div class="student-info"><h3>${escapeHtml(student.name)}</h3><small>${student.seat_number ? `座號 ${escapeHtml(student.seat_number)}` : '學生帳戶'}</small></div>`;
  const moneyInfo = `<div class="student-money"><b class="${negative ? 'amount-cell negative' : ''}">${money(balance)}</b><small>${negative ? '負債狀態' : '帳戶總餘額'}</small></div>`;
  const cardContent = portrait
    ? `<div class="student-card-profile">${profile}</div><div class="student-card-balance-panel">${coinStack}${moneyInfo}</div>`
    : `${profile}${moneyInfo}`;
  return `<article class="student-card${portrait ? ' student-card-portrait' : ''}">${cardContent}${editButton}</article>`;
}
function transactionRow(transaction) {
  const student = transaction.students || getStudent(transaction.student_id) || { name: '學生' };
  const amount = Number(transaction.amount);
  const timestamp = new Date(transaction.created_at).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const actorName = transaction.actor?.display_name?.trim();
  const actor = actorName ? `操作人 ${escapeHtml(actorName)}` : '操作人';
  return `<div class="ledger-row" data-transaction-row="${escapeHtml(transaction.id)}"><div class="ledger-name"><strong>${escapeHtml(student.name)}<small class="row-date">${timestamp}</small></strong></div><span class="type-pill ${escapeHtml(transaction.transaction_type)}">${transactionLabels[transaction.transaction_type] || '交易'}</span><div class="memo-cell"><input class="transaction-edit-input" data-edit-memo aria-label="${escapeHtml(student.name)}交易項目" maxlength="240" value="${escapeHtml(transaction.memo)}"><input class="transaction-edit-input" data-edit-note aria-label="${escapeHtml(student.name)}交易備註" maxlength="240" placeholder="備註（選填）" value="${escapeHtml(transaction.note || '')}"><small class="row-actor">${actor}</small></div><label class="transaction-amount-editor"><span class="visually-hidden">交易金額</span><input data-edit-amount aria-label="${escapeHtml(student.name)}交易金額" type="number" step="1" value="${amount}"></label><div class="ledger-row-actions"><button class="button secondary" type="button" data-save-transaction="${escapeHtml(transaction.id)}">儲存</button><button class="button danger" type="button" data-delete-transaction="${escapeHtml(transaction.id)}">刪除</button></div></div>`;
}
function renderLedger(target, transactions) {
  if (!transactions.length) {
    target.innerHTML = '<div class="empty-state">目前沒有交易紀錄</div>';
    return;
  }
  target.innerHTML = `<div class="ledger-head"><span>學生 / 日期</span><span>交易類型</span><span>項目 / 備註 / 操作人</span><span class="align-right">金額</span><span class="align-right">操作</span></div>${transactions.map(transactionRow).join('')}`;
}
async function saveTransactionEdit(button) {
  const row = button.closest('[data-transaction-row]');
  const transaction = state.transactions.find(item => item.id === row?.dataset.transactionRow);
  if (!row || !transaction) return;
  const memo = $('[data-edit-memo]', row).value.trim();
  const note = $('[data-edit-note]', row).value.trim();
  const amount = Number($('[data-edit-amount]', row).value);
  if (!memo || memo.length > 240) { toast('交易項目不可空白，且最多 240 個字。'); return; }
  if (note.length > 240) { toast('備註最多 240 個字。'); return; }
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 2147483647) { toast('金額必須是有效的非零整數。'); return; }
  if ((transaction.transaction_type === 'reward' && amount < 0) || (['penalty', 'purchase'].includes(transaction.transaction_type) && amount > 0)) {
    toast('金額正負需符合交易類型。'); return;
  }
  const controls = $$('input,button', row);
  controls.forEach(control => { control.disabled = true; });
  try {
    const { error } = await state.supabase.from('transactions').update({ memo, note: note || null, amount }).eq('id', transaction.id).eq('classroom_id', state.classroomId).select('id').single();
    if (error) throw error;
    await refreshAfterMutation('交易資料已更新');
  } catch (error) {
    toast(`更新失敗：${errorMessage(error)}`);
    controls.forEach(control => { control.disabled = false; });
  }
}
async function deleteTransaction(button) {
  const transaction = state.transactions.find(item => item.id === button.dataset.deleteTransaction);
  if (!transaction) return;
  const inventoryNotice = transaction.transaction_type === 'purchase' ? '若是商品兌換，商品庫存也會加回。' : '';
  if (!window.confirm(`確定刪除此筆交易？學生餘額會依剩餘交易重新計算。${inventoryNotice}`)) return;
  button.disabled = true;
  try {
    const { error } = await state.supabase.rpc('delete_transaction', { p_transaction_id: transaction.id });
    if (error) throw error;
    await refreshAfterMutation('交易已刪除');
  } catch (error) {
    toast(`刪除失敗：${errorMessage(error)}`);
    button.disabled = false;
  }
}
function render() {
  if (!state.balances.size) state.balances = new Map(state.students.map(student => [student.id, 0]));
  const overviewStudents = state.students.slice(0, 2);
  const maximumBalance = Math.max(0, ...overviewStudents.map(student => currentBalance(student.id)));
  $('#overview-students').innerHTML = overviewStudents.map(student => studentCard(student, false, true, maximumBalance)).join('') || '<div class="empty-state panel">新增學生後，帳戶會顯示在這裡。</div>';
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
    const searchable = `${student.name || ''} ${transaction.memo || ''} ${transaction.note || ''} ${transactionLabels[transaction.transaction_type] || ''}`.toLocaleLowerCase();
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
  target.innerHTML = state.products.filter(product => product.is_active).map((product, index) => {
    const photoUrl = state.productPhotoUrls.get(product.id);
    const art = photoUrl ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(product.name)}">` : ['✦', '◈', '✿'][index % 3];
    return `<article class="product-card"><div class="product-art${photoUrl ? ' has-photo' : ''}">${art}</div><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description || '班級商店獎勵')}</p><div class="product-bottom"><span class="product-price">${money(product.price)}</span><span class="product-stock">${product.stock_quantity == null ? '不限量' : `庫存 ${fmt(product.stock_quantity)}`}</span></div><div class="product-card-actions"><button class="button secondary" data-edit-product="${escapeHtml(product.id)}">編輯商品</button><button class="button primary" data-redeem="${escapeHtml(product.id)}" ${product.stock_quantity === 0 ? 'disabled' : ''}>為學生操作兌換</button></div></article>`;
  }).join('') || '<div class="empty-state panel">目前沒有啟用中的商品。</div>';
}
function openDialog(id) {
  const dialog = document.getElementById(id);
  if (!state.students.length && ['transaction-dialog', 'redemption-dialog'].includes(id)) {
    toast('請先建立學生帳戶。');
    if (id === 'redemption-dialog') setPage('students');
    else $('#student-dialog').showModal();
    return;
  }
  if (id === 'product-dialog') {
    const form = $('#product-form');
    form.reset();
    form.elements.product_id.value = '';
    $('#product-dialog-eyebrow').textContent = 'NEW REWARD';
    $('#product-dialog-title').textContent = '新增商店商品';
    $('#product-submit-button').textContent = '新增商品';
    clearProductPhotoPreview();
  }
  dialog.querySelector('.dialog-error')?.replaceChildren();
  if (id === 'transaction-dialog') populateTransactionMemoOptions();
  dialog.showModal();
}
function openProductEditor(productId) {
  const product = state.products.find(item => item.id === productId);
  if (!product) return;
  const form = $('#product-form');
  form.reset();
  clearProductPhotoPreview();
  form.elements.product_id.value = product.id;
  form.elements.name.value = product.name;
  form.elements.product_type.value = product.product_type;
  form.elements.price.value = product.price;
  form.elements.description.value = product.description || '';
  form.elements.stock.value = product.stock_quantity ?? '';
  const preview = $('#product-photo-preview');
  const photoUrl = state.productPhotoUrls.get(product.id);
  if (photoUrl) { preview.src = photoUrl; preview.classList.remove('hidden'); }
  else { preview.removeAttribute('src'); preview.classList.add('hidden'); }
  $('.dialog-error', form).textContent = '';
  $('#product-dialog-eyebrow').textContent = 'EDIT REWARD';
  $('#product-dialog-title').textContent = '編輯商店商品';
  $('#product-submit-button').textContent = '儲存修改';
  $('#product-dialog').showModal();
}
function clearProductPhotoPreview() {
  const preview = $('#product-photo-preview');
  if (!preview) return;
  preview.dataset.requestId = String((Number(preview.dataset.requestId) || 0) + 1);
  if (preview.dataset.thumbnailUrl) URL.revokeObjectURL(preview.dataset.thumbnailUrl);
  delete preview.dataset.thumbnailUrl;
  preview.removeAttribute('src');
  preview.classList.add('hidden');
}
function previewProductPhoto(file) {
  const preview = $('#product-photo-preview');
  if (!file || !preview) return;
  const requestId = String((Number(preview.dataset.requestId) || 0) + 1);
  preview.dataset.requestId = requestId;
  if (preview.dataset.thumbnailUrl) URL.revokeObjectURL(preview.dataset.thumbnailUrl);
  trimProductPhoto(file).then(blob => {
    if (preview.dataset.requestId !== requestId) return;
    if (preview.dataset.thumbnailUrl) URL.revokeObjectURL(preview.dataset.thumbnailUrl);
    preview.dataset.thumbnailUrl = URL.createObjectURL(blob);
    preview.src = preview.dataset.thumbnailUrl;
    preview.classList.remove('hidden');
  }).catch(() => {
    if (preview.dataset.requestId !== requestId) return;
    preview.dataset.thumbnailUrl = URL.createObjectURL(file);
    preview.src = preview.dataset.thumbnailUrl;
    preview.classList.remove('hidden');
  });
}
function populateTransactionMemoOptions() {
  const picker = $('#transaction-memo-picker');
  if (!picker) return;
  const options = state.settings.transactionMemoOptions || [];
  const currentSelection = $('#transaction-form [name="memo"]:checked')?.value;
  picker.innerHTML = options.map((option, index) => `<label class="transaction-memo-choice"><input type="radio" name="memo" value="${escapeHtml(option)}" required${option === currentSelection || (!currentSelection && index === 0) ? ' checked' : ''}><span>${escapeHtml(option)}</span></label>`).join('');
  picker.closest('.transaction-memo-fieldset').hidden = options.length === 0;
}
function renderTransactionMemoOptions() {
  const list = $('#transaction-memo-options');
  if (!list) return;
  list.innerHTML = state.settings.transactionMemoOptions.map((option, index) => `<span class="memo-option-chip">${escapeHtml(option)}<button type="button" data-remove-memo-option="${index}" aria-label="移除 ${escapeHtml(option)}">×</button></span>`).join('');
  populateTransactionMemoOptions();
}
async function saveTransactionMemoOptions(options) {
  const errorNode = $('#memo-options-error');
  const statusNode = $('#memo-options-status');
  const input = $('#new-memo-option');
  const addButton = $('#add-memo-option');
  errorNode.textContent = '';
  statusNode.textContent = '';
  if (!options.length) { showError(errorNode, '至少保留一個項目。'); return; }
  if (options.length > 30) { showError(errorNode, '最多可設定 30 個項目。'); return; }
  if (options.some(option => !option || option.length > 80)) { showError(errorNode, '項目不可空白，且每個項目最多 80 字。'); return; }
  input.disabled = true;
  addButton.disabled = true;
  $$('.memo-option-chip button').forEach(button => { button.disabled = true; });
  try {
    const { error } = await state.supabase.from('classrooms').update({ transaction_memo_options: options }).eq('id', state.classroomId).select('id').single();
    if (error) throw error;
    state.settings.transactionMemoOptions = options;
    renderTransactionMemoOptions();
    statusNode.textContent = '交易項目已儲存。';
    toast('交易項目已更新');
  } catch (error) {
    showError(errorNode, errorMessage(error));
  } finally {
    input.disabled = false;
    addButton.disabled = false;
    $$('.memo-option-chip button').forEach(button => { button.disabled = false; });
  }
}
function addTransactionMemoOption() {
  const input = $('#new-memo-option');
  const option = input.value.trim();
  const errorNode = $('#memo-options-error');
  errorNode.textContent = '';
  if (!option) { showError(errorNode, '請先輸入要新增的項目。'); return; }
  if (state.settings.transactionMemoOptions.some(item => item.toLocaleLowerCase() === option.toLocaleLowerCase())) {
    showError(errorNode, '這個項目已經存在。');
    return;
  }
  if (option.length > 80) { showError(errorNode, '每個項目最多 80 字。'); return; }
  saveTransactionMemoOptions([...state.settings.transactionMemoOptions, option]).then(() => {
    if (!errorNode.textContent) input.value = '';
  });
}
function removeTransactionMemoOption(index) {
  saveTransactionMemoOptions(state.settings.transactionMemoOptions.filter((_, optionIndex) => optionIndex !== index));
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
    const saveTransaction = event.target.closest('[data-save-transaction]');
    if (saveTransaction) { saveTransactionEdit(saveTransaction); return; }
    const deleteTransactionButton = event.target.closest('[data-delete-transaction]');
    if (deleteTransactionButton) { deleteTransaction(deleteTransactionButton); return; }
    const editProduct = event.target.closest('[data-edit-product]');
    if (editProduct) { openProductEditor(editProduct.dataset.editProduct); return; }
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
  $('#add-memo-option').addEventListener('click', addTransactionMemoOption);
  $('#new-memo-option').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); addTransactionMemoOption(); }
  });
  $('#transaction-memo-options').addEventListener('click', event => {
    const button = event.target.closest('[data-remove-memo-option]');
    if (button) removeTransactionMemoOption(Number(button.dataset.removeMemoOption));
  });
  $('#redemption-form').addEventListener('submit', submitRedemption);
  $('#student-form').addEventListener('submit', submitStudent);
  $('#student-edit-form').addEventListener('submit', submitStudentEdit);
  $('#product-form').addEventListener('submit', submitProduct);
  $('#product-photo-input').addEventListener('change', event => previewProductPhoto(event.target.files?.[0]));
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
    state.supabase.from('transactions').select('id,student_id,transaction_type,amount,memo,note,created_at,created_by,actor:profiles!transactions_created_by_fkey(display_name)').eq('classroom_id', state.classroomId).order('created_at', { ascending: false }).limit(500),
    state.supabase.from('store_products').select('id,name,product_type,description,price,stock_quantity,is_active,photo_path').eq('classroom_id', state.classroomId).eq('is_active', true).order('created_at', { ascending: false })
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
  clearObjectUrls(state.productPhotoUrls);
  await Promise.all(state.products.filter(product => product.photo_path).map(async product => {
    try {
      const { data, error } = await state.supabase.storage.from('product-photos').createSignedUrl(product.photo_path, 3600);
      if (!error && data?.signedUrl) state.productPhotoUrls.set(product.id, data.signedUrl);
    } catch { /* Keep the decorative artwork if a stored photo cannot be signed. */ }
  }));
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
  const note = String(values.get('note') || '').trim();
  const result = await state.supabase.from('transactions').insert({ classroom_id: state.classroomId, student_id: values.get('student_id'), transaction_type: type, amount, memo: String(values.get('memo')).trim(), note: note || null }).select('id').single();
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
  const productId = String(values.get('product_id') || '').trim();
  const file = values.get('photo');
  const error = $('.dialog-error', form);
  const submitButton = $('#product-submit-button');
  const originalLabel = submitButton.textContent;
  if (file?.size && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { showError(error, '照片請使用 JPG、PNG 或 WebP 格式。'); return; }
  if (file?.size > 5 * 1024 * 1024) { showError(error, '照片大小不可超過 5 MB。'); return; }
  const changes = { name: String(values.get('name')).trim(), product_type: values.get('product_type'), price: Number(values.get('price')), description: String(values.get('description') || '').trim() || null, stock_quantity: stock ? Number(stock) : null };
  const existingProduct = state.products.find(product => product.id === productId);
  let uploadedPath = null;
  error.textContent = '';
  submitButton.disabled = true;
  submitButton.textContent = '儲存中…';
  try {
    if (file?.size) {
      let extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
      let contentType = file.type;
      const uniqueName = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let photoToUpload = file;
      try {
        photoToUpload = await trimProductPhoto(file);
        extension = 'jpg';
        contentType = 'image/jpeg';
      } catch { /* Keep the original if thumbnail processing is unavailable. */ }
      uploadedPath = `${state.classroomId}/${uniqueName}.${extension}`;
      const upload = await state.supabase.storage.from('product-photos').upload(uploadedPath, photoToUpload, { contentType, upsert: false });
      if (upload.error) { showError(error, errorMessage(upload.error)); return; }
      changes.photo_path = uploadedPath;
    }
    const result = productId
      ? await state.supabase.from('store_products').update(changes).eq('id', productId).eq('classroom_id', state.classroomId).select('id').single()
      : await state.supabase.from('store_products').insert({ classroom_id: state.classroomId, ...changes, is_active: true }).select('id').single();
    if (result.error) {
      if (uploadedPath) await state.supabase.storage.from('product-photos').remove([uploadedPath]);
      showError(error, errorMessage(result.error));
      return;
    }
    form.closest('dialog').close(); form.reset();
    if (uploadedPath && existingProduct?.photo_path) await state.supabase.storage.from('product-photos').remove([existingProduct.photo_path]);
    await refreshAfterMutation(productId ? '商店商品已更新' : '商店商品已新增');
  } catch (requestError) {
    if (uploadedPath) await state.supabase.storage.from('product-photos').remove([uploadedPath]);
    showError(error, errorMessage(requestError));
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
}
async function refreshAfterMutation(message) {
  try { await loadState(); toast(message); }
  catch (error) { toast(`資料已送出，但畫面更新失敗：${errorMessage(error)}`); }
}
async function submitSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('button[type="submit"]', form);
  const inputs = $$('.setting-switch input', form);
  const errorNode = $('#settings-error');
  const statusNode = $('#settings-status');
  errorNode.textContent = '';
  statusNode.textContent = '';
  if (button) button.disabled = true;
  inputs.forEach(input => { input.disabled = true; });
  try {
    const settings = {
      public_show_student_avatars: $('#setting-show-avatars').checked,
      public_show_seat_numbers: $('#setting-show-seat-numbers').checked
    };
    const { error } = await state.supabase.from('classrooms').update(settings).eq('id', state.classroomId).select('id').single();
    if (error) throw error;
    state.settings = { showStudentAvatars: settings.public_show_student_avatars, showSeatNumbers: settings.public_show_seat_numbers };
    statusNode.textContent = '設定已自動儲存；公開首頁重新整理後會套用。';
    toast('基本設定已儲存');
  } catch (error) {
    $('#setting-show-avatars').checked = state.settings.showStudentAvatars;
    $('#setting-show-seat-numbers').checked = state.settings.showSeatNumbers;
    inputs.forEach(input => {
      $('.switch-state', input.parentElement).textContent = input.checked ? '開啟' : '關閉';
    });
    showError(errorNode, errorMessage(error));
  } finally {
    if (button) button.disabled = false;
    inputs.forEach(input => { input.disabled = false; });
  }
}
async function submitBasicInfo(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('button[type="submit"]', form);
  const errorNode = $('#basic-info-error');
  const statusNode = $('#basic-info-status');
  errorNode.textContent = '';
  statusNode.textContent = '';
  const systemName = $('#setting-system-name').value.trim();
  const classroomName = $('#setting-classroom-name').value.trim();
  if (!systemName || !classroomName) {
    showError(errorNode, '系統名稱和班級名稱都不能空白。');
    return;
  }
  button.disabled = true;
  try {
    const { error } = await state.supabase.from('classrooms').update({ system_name: systemName, name: classroomName }).eq('id', state.classroomId).select('id').single();
    if (error) throw error;
    state.settings.systemName = systemName;
    state.settings.classroomName = classroomName;
    applyBranding(systemName, classroomName);
    statusNode.textContent = '基本資訊已儲存。';
    toast('系統基本資訊已儲存');
  } catch (error) {
    showError(errorNode, errorMessage(error));
  } finally {
    button.disabled = false;
  }
}
async function enterApp(user) {
  hide('public-screen');
  state.user = user;
  const { data: profile, error: profileError } = await state.supabase.from('profiles').select('display_name,role').eq('id', user.id).single();
  if (profileError || !profile || profile.role !== 'teacher') {
    await state.supabase.auth.signOut();
    show('login-screen');
    showError($('#login-error'), '此登入帳戶尚未設定為教師，請聯絡專案管理者。');
    return;
  }
  state.profile = profile;
  const { data: memberships, error } = await state.supabase.from('classroom_members').select('classroom_id,classrooms(name,system_name,public_show_student_avatars,public_show_seat_numbers,transaction_memo_options)').eq('user_id', user.id).eq('role', 'teacher').limit(1);
  if (error || !memberships?.length) {
    await state.supabase.auth.signOut();
    show('login-screen');
    showError($('#login-error'), '帳戶尚未加入班級，請先執行 Supabase 初始設定。');
    return;
  }
  state.classroomId = memberships[0].classroom_id;
  const classroomSettings = memberships[0].classrooms || {};
  state.settings = { systemName: classroomSettings.system_name || '班級薪資銀行', classroomName: classroomSettings.name || '', showStudentAvatars: classroomSettings.public_show_student_avatars === true, showSeatNumbers: classroomSettings.public_show_seat_numbers !== false, transactionMemoOptions: Array.isArray(classroomSettings.transaction_memo_options) && classroomSettings.transaction_memo_options.length ? classroomSettings.transaction_memo_options : ['完成作業', '協助班級工作'] };
  $('#setting-system-name').value = state.settings.systemName;
  $('#setting-classroom-name').value = state.settings.classroomName;
  applyBranding(state.settings.systemName, state.settings.classroomName);
  $('#setting-show-avatars').checked = state.settings.showStudentAvatars;
  $('#setting-show-seat-numbers').checked = state.settings.showSeatNumbers;
  $$('.setting-switch').forEach(node => {
    const input = $('input', node);
    $('.switch-state', node).textContent = input.checked ? '開啟' : '關閉';
  });
  renderTransactionMemoOptions();
  $('#teacher-avatar').textContent = avatarText(profile.display_name || user.email);
  hide('login-screen'); hide('setup-screen'); show('app');
  try { await loadState(); }
  catch (loadError) { toast(`讀取帳戶資料失敗：${errorMessage(loadError)}`); }
}
async function initialize() {
  $('#today-label').textContent = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());
  setupDialogs();
  if (!config.supabaseUrl || !config.supabasePublishableKey || !window.supabase?.createClient) { show('setup-screen'); return; }
  state.supabase = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  $('#teacher-login-link').addEventListener('click', showTeacherLogin);
  $('#public-home-link').addEventListener('click', showPublicHome);
  $('#public-refresh').addEventListener('click', loadPublicBalances);
  $('#public-store-refresh').addEventListener('click', loadPublicStore);
  $$('.public-view-tab').forEach(button => button.addEventListener('click', () => setPublicView(button.dataset.publicView)));
  $('#settings-form').addEventListener('submit', submitSettings);
  $('#basic-info-form').addEventListener('submit', submitBasicInfo);
  $$('.setting-switch input').forEach(input => input.addEventListener('change', () => {
    $('.switch-state', input.parentElement).textContent = input.checked ? '開啟' : '關閉';
    $('#settings-form').requestSubmit();
  }));
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const { data, error } = await state.supabase.auth.signInWithPassword({ email: values.get('email'), password: values.get('password') });
    if (error) { showError($('#login-error'), errorMessage(error)); return; }
    await enterApp(data.user);
  });
  const { data: { session } } = await state.supabase.auth.getSession();
  if (session?.user) await enterApp(session.user); else showPublicHome();
  state.supabase.auth.onAuthStateChange((event, sessionState) => {
    if (event === 'SIGNED_OUT' || !sessionState) { state.user = null; state.classroomId = null; showPublicHome(); }
  });
  setPage(location.hash.slice(1) in pageTitles ? location.hash.slice(1) : 'overview');
}

initialize();
