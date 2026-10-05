'use strict';
const A = PayAccounting, { KEY, RAW_BACKUP, Store } = PayStorage;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(n / 100);
const tl = n => (n / 100).toFixed(2).replace('.', ',');
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
const dateText = s => new Date(s + 'T12:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
const periodText = p => { const b = A.bounds(p); return dateText(b.start) + ' – ' + dateText(b.end); };
const empty = (title, text) => `<div class="empty"><strong>${esc(title)}</strong>${esc(text)}</div>`;
const options = (list, selected) => list.map(x => `<option value="${esc(x.id)}" ${x.id === selected ? 'selected' : ''}>${esc(x.name)}${x.archived ? ' (arşiv)' : ''}</option>`).join('');
const storageAdapter = { getItem: k => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) };
const store = new Store(storageAdapter, navigator.locks, A, { requireLocks: true });
let db = store.db, active = 'summary', period = A.periodOf(A.today()), editId = null, onlyOwing = false, showArchived = false, dirty = false, submitting = false;
let pendingPerson = null;
const nameOf = (kind, id) => db[kind].find(x => x.id === id)?.name || 'Bilinmeyen';
const defaultDate = () => A.periodOf(A.today()) === period ? A.today() : period + '-15';
function toast(text) {
  $('#toast').textContent = text; $('#toast').hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').hidden = true, 6000);
}
function fail(error) { toast(error.message || String(error)); showProtection(); }
function showProtection() {
  $('#fatal').hidden = !store.blocked;
  if (store.blocked) {
    $('#fatal').textContent = store.reason + ' ';
    const b = document.createElement('button'); b.textContent = 'Güncel kayıtları yeniden yükle';
    b.onclick = async () => { if (await leaveForm()) location.reload(); }; $('#fatal').append(b);
  }
}
function ask(title, text, yesLabel = 'Onayla') {
  return new Promise(resolve => {
    const dlg = $('#confirmDialog');
    $('#confirmTitle').textContent = title; $('#confirmText').textContent = text; $('#confirmYes').textContent = yesLabel;
    const done = value => { dlg.close(); resolve(value); };
    $('#confirmYes').onclick = () => done(true); $('#confirmNo').onclick = () => done(false);
    dlg.oncancel = e => { e.preventDefault(); done(false); }; dlg.showModal();
  });
}
async function leaveForm() {
  if (submitting) { toast('İşlem sürüyor; lütfen bekleyin.'); return false; }
  return !dirty || await ask('Kaydedilmemiş form var', 'Bu formdaki değişiklikleri kaydetmeden devam etmek istiyor musunuz?', 'Kaydetmeden devam et');
}
async function commit(change, config) {
  await store.commit(change, config); db = store.db; dirty = false; editId = null;
}
async function submitOnce(form, action) {
  if (submitting) return;
  submitting = true;
  const buttons = [...form.querySelectorAll('button')]; buttons.forEach(b => b.disabled = true);
  try { await action(); } catch (e) { fail(e); }
  finally { submitting = false; buttons.forEach(b => b.disabled = false); }
}
function status(row) {
  if (row.net > 0) return '<span class="badge bad">Kalan borç</span>';
  if (row.net < 0) return '<span class="badge good">Alacak / avans</span>';
  return '<span class="badge neutral">Hesap kapandı</span>';
}
function cards(c, cash) {
  return [
    ['Dönemin toplam harcaması', money(c.total), c.unallocated ? 'Henüz paylaştırılmamış harcama: ' + money(c.unallocated) : `${c.expenses.length} alım · kasadan ödenmiş gider`],
    ['Dönemin gerçek tahsilatı', money(cash.received), 'Gerçek ödeme tarihine göre; kasa başlangıcı kapsamındaki tahsilatlar'],
    ['Kalan toplam kişi borcu', money(c.remaining), 'Önceki borç ve bu dönem payı dahil'],
    ['Sonraki döneme kişi alacağı', money(c.excess), 'Kişiye özel devreden alacak / avans'],
    ['Katılımcı / kişi başına pay', c.members.length ? money(c.base) + (c.rem ? ' – ' + money(c.base + 1) : '') : '—', `${c.members.length} katılımcı · sabit seçim sırasıyla kuruş dağıtımı`],
    ['Önceki dönemden devreden kasa', money(cash.opening), cash.startsWithin ? 'Bu dönem içindeki başlangıç tutarı; kapsam başlangıç tarihinden itibaren' : cash.beforeStart ? 'Kasa başlangıç tarihinden önce' : 'Dönem açılışı'],
    ['Seçili dönem sonu kasa', money(cash.closing), cash.closing < 0 ? 'Kasa açığı' : 'Gelecek tarihli dönem hareketlerini de içerir'],
    ['Bugün itibarıyla kasa', money(cash.today), cash.today < 0 ? 'Kasa açığı · gelecekteki işlemler hariç' : dateText(A.today()) + ' · gelecekteki işlemler hariç']
  ].map(x => `<div class="stat"><div class="label">${esc(x[0])}</div><div class="value">${esc(x[1])}</div><div class="hint">${esc(x[2])}</div></div>`).join('');
}
function render() {
  $('#period').value = period; $('#periodTitle').textContent = periodText(period);
  const c = A.calculate(db, period), cash = A.cashSummary(db, period);
  $('#stats').innerHTML = cards(c, cash);
  document.querySelectorAll('[data-tab]').forEach(b => {
    b.setAttribute('aria-selected', String(b.dataset.tab === active)); b.tabIndex = b.dataset.tab === active ? 0 : -1;
    b.id = 'tab-' + b.dataset.tab; b.setAttribute('aria-controls', 'view');
  });
  $('#view').setAttribute('aria-labelledby', 'tab-' + active);
  $('#view').innerHTML = active === 'summary' ? summary(c) : active === 'expenses' ? entries('expenses', c) : active === 'payments' ? entries('payments', c) : active === 'cash' ? cashView(cash) : active === 'backup' ? backup() : registry(active);
  $('#view').querySelectorAll('.tablewrap').forEach(el => { el.tabIndex = 0; el.setAttribute('aria-label', 'Yatay kaydırılabilir tablo'); });
  $('#saveStatus').textContent = store.blocked ? 'Yazma kapalı · Kayıtlarınızın üzerine yazılmıyor' : db.updatedAt ? 'Son kayıt: ' + new Date(db.updatedAt).toLocaleString('tr-TR') + ' · Otomatik kayıt açık' : 'Henüz kayıt yok · Değişiklikler otomatik kaydedilir';
  dirty = false; showProtection(); bind(c);
}
function summary(c) {
  const rows = c.rows.filter(x => !onlyOwing || x.remaining > 0);
  return `<div class="note">Kişi hesabı, ödemenin işlendiği hesap dönemine göre hesaplanır. Bu hesap dönemine işlenen ödeme: <strong>${money(c.paid)}</strong>. Kasa ise gerçek ödeme tarihini kullanır. Alınmış avans sonraki dönemde mahsup edilirken yeniden tahsilat sayılmaz.</div>
  <div class="panel"><div class="panelhead"><div><h2>Kişi borç ve alacakları</h2><div class="muted">Katılımcı olmayan ve arşivlenen kişilerin geçmiş bakiyeleri de korunur.</div></div><label class="row"><input type="checkbox" id="onlyOwing" ${onlyOwing ? 'checked' : ''}> Sadece eksik ödemeler</label></div>
  ${rows.length ? `<div class="tablewrap"><table><thead><tr><th>Kişi</th><th class="num">Devreden borç</th><th class="num">Devreden alacak</th><th class="num">Bu dönem payı</th><th class="num">Hesap dönemine ödeme</th><th class="num">Kalan toplam borç</th><th class="num">Sonraki döneme alacak</th><th>Durum</th><th>İşlem</th></tr></thead><tbody>${rows.map(x => `<tr><td><strong>${esc(nameOf('people', x.id))}</strong><div class="muted">${x.member ? 'Dönem katılımcısı' : 'Katılımcı değil'}${db.people.find(p => p.id === x.id).archived ? ' · Arşivde' : ''}</div></td><td class="num">${money(x.openingDebt)}</td><td class="num">${money(x.openingCredit)}</td><td class="num">${money(x.due)}</td><td class="num">${money(x.paid)}</td><td class="num">${money(x.remaining)}</td><td class="num">${money(x.excess)}</td><td>${status(x)}</td><td><div class="actions"><button class="small" data-pay="${esc(x.id)}">Ödeme ekle</button><button class="small" data-history="${esc(x.id)}">Hesap hareketleri</button></div></td></tr>`).join('')}</tbody></table></div>` : empty(db.people.length ? 'Eksik ödeme yok' : 'Önce kişi ekleyin', db.people.length ? 'Bu görünümde listelenecek kişi yok.' : 'Kişiler sekmesinden ilk kişiyi kaydedin.')}</div>
  ${c.unallocated ? `<div class="error" role="status">Henüz paylaştırılmamış harcama: ${money(c.unallocated)}. Katılımcı seçilmediği için kişilere borç yazılmadı; gider kasa hesabına dahildir.</div>` : ''}
  <div class="panel"><div class="panelhead"><div><h2>Döneme katılan kişiler</h2><div class="muted">Yeni dönemler boş başlar. Geçmiş borç ve alacak katılımdan bağımsız devreder.</div></div><div class="row"><button class="small" id="copyMembers">Önceki dönemin katılımcılarını getir</button><button class="small" id="selectAll">Aktif kişileri seç</button></div></div><form class="content" id="membersForm"><div class="note">Katılımcı değişikliği bu dönemin paylarını ve sonraki dönemlerin bakiyelerini değiştirir. Kuruş farkları mevcut katılımcı sırası korunarak dağıtılır.</div>${db.people.length ? `<div class="peoplegrid">${db.people.filter(x => !x.archived || c.members.includes(x.id)).map(x => `<label class="personcheck"><input type="checkbox" name="member" value="${esc(x.id)}" ${c.members.includes(x.id) ? 'checked' : ''}><span>${esc(x.name)}${x.archived ? ' (arşiv)' : ''}</span></label>`).join('')}</div><button class="primary">Dönem kişilerini kaydet</button>` : empty('Henüz kişi yok', 'Kişiler bölümünden adları ekleyin.')}</form></div>`;
}
function entryForm(kind, c) {
  const exp = kind === 'expenses', record = db[kind].find(x => x.id === editId);
  const selected = record?.[exp ? 'materialId' : 'personId'] || (!exp ? pendingPerson : null);
  const list = exp ? db.materials.filter(x => !x.archived || x.id === selected) : db.people.filter(x => !x.archived || showArchived || x.id === selected);
  const paymentPeriod = record?.period || period;
  return `<div class="panel"><div class="panelhead"><h2>${record ? 'Kaydı düzenle' : exp ? 'Harcama ekle' : 'Ödeme ekle'}</h2></div><form class="content" id="entryForm">
  ${!exp ? `<label class="row archiveToggle"><input type="checkbox" id="showArchived" ${showArchived ? 'checked' : ''}> Arşivdekileri göster</label>` : ''}
  <label class="field">${exp ? 'Malzeme' : 'Kişi'}<select name="entity" required><option value="">${exp ? 'Malzeme' : 'Kişi'} seçin</option>${options(list, selected)}</select></label>
  ${!list.length ? `<p class="muted">Önce ${exp ? 'Malzemeler' : 'Kişiler'} bölümünden kayıt ekleyin.${exp ? '' : ' Dönem katılımcısı seçilmesi gerekmez.'}</p>` : ''}
  ${!exp ? '<div id="personInfo" class="note" role="status"></div>' : ''}
  <label class="field">${exp ? 'Alım tarihi' : 'Gerçek ödeme tarihi'}<input name="date" type="date" required min="1900-01-01" max="9998-12-31" value="${record?.date || defaultDate()}"></label>
  ${!exp ? `<label class="field">Ödemenin işlendiği hesap dönemi<input type="month" name="accountPeriod" required min="1900-01" max="9998-12" value="${paymentPeriod}"></label>` : ''}
  <label class="field">${exp ? 'Toplam tutar' : 'Ödeme tutarı'} (TL)<input name="amount" inputmode="decimal" autocomplete="off" required placeholder="Örn. 1250,50" value="${record ? tl(record.amount) : !exp && selected && c.rows.find(x => x.id === selected)?.remaining ? tl(c.rows.find(x => x.id === selected).remaining) : ''}"></label>
  <label class="field">Açıklama <span class="muted">(isteğe bağlı)</span><input name="note" maxlength="500" value="${esc(record?.note || '')}"></label>
  ${!exp ? '<label class="row archiveToggle"><input type="checkbox" name="addMember"> Bu kişiyi ayrıca seçilen hesap döneminin katılımcılarına ekle</label><p class="muted">Bu seçim harcama paylarını değiştirir. Ödeme almak tek başına kişiyi katılımcı yapmaz. Borçtan fazla ödeme ve avans kabul edilir.</p>' : ''}
  <div class="note" id="entryInfo" role="status">${exp ? 'Kaydedilen her harcama kasadan ödenmiş gider kabul edilir. Alım tarihinin ait olduğu döneme işlenir.' : 'Kişi hesabı seçilen hesap dönemine; kasa gerçek ödeme tarihine göre etkilenir.'}</div>
  <div class="row"><button class="primary" ${!list.length ? 'disabled' : ''}>${record ? 'Değişiklikleri kaydet' : 'Kaydet'}</button>${record ? '<button type="button" id="cancelEdit">Vazgeç</button>' : ''}</div></form></div>`;
}
function entries(kind, c) {
  const exp = kind === 'expenses', arr = exp ? c.expenses : c.payments;
  return `<div class="split">${entryForm(kind, c)}<div class="panel"><div class="panelhead"><div><h2>${exp ? 'Malzeme alımları' : 'Bu hesap dönemine işlenen ödemeler'}</h2>${!exp ? '<div class="muted">Gerçek tahsilat tarihleri farklı dönemlere ait olabilir.</div>' : ''}</div><strong>${money(exp ? c.total : c.paid)}</strong></div>${arr.length ? entryTable(arr, exp) : empty(exp ? 'Bu dönemde harcama yok' : 'Bu hesap döneminde ödeme yok', exp ? 'Malzeme, alım tarihi ve toplam tutarı girin.' : 'Aktif bir kişi seçerek kısmi ödeme veya avans kaydedin.')}</div></div>`;
}
function entryTable(arr, exp) {
  return `<div class="tablewrap"><table><thead><tr><th>${exp ? 'Alım tarihi / Malzeme' : 'Gerçek ödeme tarihi / Kişi'}</th>${!exp ? '<th>Hesap dönemi</th>' : ''}<th class="num">Tutar</th><th>İşlem</th></tr></thead><tbody>${[...arr].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).map(x => `<tr><td><div class="muted">${dateText(x.date)}</div><strong>${esc(nameOf(exp ? 'materials' : 'people', exp ? x.materialId : x.personId))}</strong>${x.note ? `<div class="muted">${esc(x.note)}</div>` : ''}</td>${!exp ? `<td>${periodText(x.period)}${A.periodOf(x.date) !== x.period ? '<div class="muted">Gerçek tahsilat dönemi farklı</div>' : ''}</td>` : ''}<td class="num">${money(x.amount)}</td><td><div class="actions"><button class="small" data-edit="${esc(x.id)}">Düzenle</button><button class="small danger" data-delete="${esc(x.id)}">Sil</button></div></td></tr>`).join('')}</tbody></table></div>`;
}
function registry(kind) {
  const people = kind === 'people', list = db[kind], record = list.find(x => x.id === editId);
  return `<div class="split"><div class="panel"><div class="panelhead"><h2>${record ? 'Adı düzenle' : people ? 'Kişi ekle' : 'Malzeme ekle'}</h2></div><form class="content" id="registryForm"><label class="field">${people ? 'Ad soyad' : 'Malzeme adı'}<input name="name" required maxlength="120" value="${esc(record?.name || '')}" placeholder="${people ? 'Örn. Ayşe Yılmaz' : 'Örn. Çay, şeker'}"></label><div class="row"><button class="primary">${record ? 'Kaydet' : 'Ekle'}</button>${record ? '<button type="button" id="cancelEdit">Vazgeç</button>' : ''}</div></form></div><div class="panel"><div class="panelhead"><h2>${people ? 'Kayıtlı kişiler' : 'Kayıtlı malzemeler'}</h2><span class="muted">${list.filter(x => !x.archived).length} aktif</span></div><div class="content"><p class="muted">Arşivleme geçmiş kayıtları ve bakiyeleri silmez. Ad değişse de kayıtlar benzersiz kimlik üzerinden bağlı kalır.</p>${list.length ? list.map(x => `<div class="listitem"><div><strong>${esc(x.name)}</strong>${x.archived ? ' <span class="badge neutral">Arşivde</span>' : ''}</div><div class="actions"><button class="small" data-edit="${esc(x.id)}">Düzenle</button><button class="small" data-archive="${esc(x.id)}">${x.archived ? 'Aktifleştir' : 'Arşivle'}</button>${people ? `<button class="small" data-pay="${esc(x.id)}">Ödeme ekle</button>` : ''}</div></div>`).join('') : empty('Henüz kayıt yok', 'İlk kaydı formdan ekleyin.')}</div></div></div>`;
}
function cashView(c) {
  return `<div class="note">Kasa = devreden kasa + gerçek tarihli tahsilatlar − kasadan ödenmiş harcamalar. Tahsil edilmemiş kişi borcu kasada para sayılmaz. Kişi alacağı kasaya ikinci kez eklenmez.</div>
  <div class="split"><div class="panel"><div class="panelhead"><h2>Başlangıç kasası</h2></div><form class="content" id="cashForm"><label class="field">Başlangıç tarihi<input type="date" name="date" min="1900-01-01" max="9998-12-31" required value="${db.cash.date}"></label><label class="field">Başlangıç tutarı (TL)<input name="amount" inputmode="decimal" required value="${tl(db.cash.amount)}"></label><div class="note">Bir defalık tutardır. Seçilen günün işlemlerinden önce mevcut para anlamına gelir. Önceki işlemler kasa hesabına tekrar eklenmez. Negatif tutar başlangıç kasa açığıdır. Kişi hesapları bu ayardan etkilenmez.</div><button class="primary">Başlangıç ayarını kaydet</button><p class="muted">Kasa kapsamı: ${dateText(db.cash.date)} ve sonrası. ${c.omitted} önceki hareket kasa hesabı dışında.${c.startsWithin ? ' Seçili dönemde kapsam dönem ortasında başlıyor; açılış kartında başlangıç tutarı gösteriliyor.' : ''}${c.beforeStart ? ' Seçili dönem başlangıç tarihinden önce; kasa hesabının kapsamı dışında.' : ''}</p></form></div>
  <div class="panel"><div class="panelhead"><h2>Kasa hareketleri</h2><strong>${money(c.closing)}${c.closing < 0 ? ' · Kasa açığı' : ''}</strong></div><div class="content row space"><span>Açılış: ${money(c.opening)}</span><span>Tahsilat: ${money(c.received)}</span><span>Gider: ${money(c.spent)}</span></div>${cashTable(c)}</div></div>`;
}
function cashTable(c) {
  if (c.beforeStart) return empty('Kasa kapsamı başlamadı', 'Başlangıç tarihi ' + dateText(db.cash.date) + '. Önceki hareketler hariçtir.');
  return `<div class="tablewrap"><table><thead><tr><th>Tarih</th><th>İşlem türü</th><th>Kişi / malzeme</th><th>Açıklama</th><th class="num">Giriş</th><th class="num">Çıkış</th><th class="num">Yürüyen bakiye</th></tr></thead><tbody><tr><td>${dateText(c.effectiveStart)}</td><td>${c.effectiveStart === db.cash.date ? 'Başlangıç kasası' : 'Devreden kasa'}</td><td>—</td><td>Önceki para; yeni tahsilat değildir</td><td>—</td><td>—</td><td class="num">${money(c.opening)}</td></tr>${c.rows.map(x => `<tr><td>${dateText(x.date)}</td><td>${x.type === 'payment' ? 'Tahsilat' : 'Harcama'}</td><td>${esc(nameOf(x.type === 'payment' ? 'people' : 'materials', x.personId || x.materialId))}${x.type === 'payment' ? `<div class="muted">Hesap dönemi: ${esc(x.period)}</div>` : ''}</td><td>${esc(x.note)}</td><td class="num">${money(x.incoming)}</td><td class="num">${money(x.outgoing)}</td><td class="num">${money(x.balance)}${x.balance < 0 ? '<div>Kasa açığı</div>' : ''}</td></tr>`).join('')}</tbody></table></div>${!c.rows.length ? empty('Bu dönemde kasa hareketi yok', 'Açılış bakiyesi sonraki döneme aynen taşınır.') : ''}`;
}
function backup() {
  return `<div class="split"><div class="panel"><div class="panelhead"><h2>Verileriniz sizde</h2></div><div class="content"><p>Kayıtlar bu cihazda saklanır. Cihazlar arasında otomatik eşitleme yoktur. Tarayıcı verileri silinirse kayıtlar kaybolabilir; düzenli JSON yedeği alın.</p><p class="muted">${db.people.length} kişi · ${db.materials.length} malzeme · ${db.expenses.length} harcama · ${db.payments.length} ödeme · Veri sürümü ${db.version}</p></div></div><div class="stack"><div class="panel"><div class="panelhead"><h2>Dışa aktar</h2></div><div class="content stack"><button class="primary" id="exportJson">Tam yedeği indir (JSON)</button><button id="exportCsv">Seçili dönem raporu (CSV)</button><p class="muted">JSON tüm kayıtları, dönem katılımcılarını ve kasa başlangıç ayarını içerir. CSV Excel uyumlu dönem raporudur.</p><button id="exportRaw">Mevcut ham veriyi indir</button><button id="exportMigration">Geçiş öncesi özgün veriyi indir</button></div></div><div class="panel"><div class="panelhead"><h2>Yedekten geri yükle</h2></div><div class="content"><label class="field">Pay Defteri yedeği (.json)<input type="file" id="importFile" accept=".json,application/json"></label><p class="muted">Sürüm 1 ve 2 desteklenir. Dosya önce doğrulanır. Onayınızla mevcut kayıtların tamamı değiştirilir; birleştirme yapılmaz. Değişim öncesi mevcut ham yedek otomatik indirilir.</p></div></div></div></div>`;
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function exportJson() {
  if (store.blocked) throw Error('Kayıtlar doğrulanamıyor. Mevcut ham veriyi indirin.');
  download('Pay-Defteri-Yedek-' + A.today() + '.json', JSON.stringify(db, null, 2), 'application/json'); toast('JSON yedeği indirmeye gönderildi.');
}
function exportCsv() {
  const c = A.calculate(db, period), cash = A.cashSummary(db, period);
  const rows = [
    ['PAY DEFTERİ', periodText(period)], ['Kasa kapsam başlangıcı', db.cash.date], [],
    ['KİŞİ HESAPLARI'], ['Kişi', 'Katılımcı', 'Devreden borç TL', 'Devreden alacak TL', 'Dönem payı TL', 'Hesap dönemine ödeme TL', 'Kalan toplam borç TL', 'Sonraki döneme alacak TL', 'Net bakiye TL'],
    ...c.rows.map(x => [nameOf('people', x.id), x.member ? 'Evet' : 'Hayır', tl(x.openingDebt), tl(x.openingCredit), tl(x.due), tl(x.paid), tl(x.remaining), tl(x.excess), tl(x.net)]), [],
    ['HARCAMALAR'], ['Alım tarihi', 'Malzeme', 'Tutar TL', 'Açıklama'], ...c.expenses.map(x => [x.date, nameOf('materials', x.materialId), tl(x.amount), x.note]), [],
    ['HESAP DÖNEMİNE İŞLENEN ÖDEMELER'], ['Gerçek ödeme tarihi', 'Hesap dönemi', 'Kişi', 'Tutar TL', 'Açıklama'], ...c.payments.map(x => [x.date, x.period, nameOf('people', x.personId), tl(x.amount), x.note]), [],
    ['KASA ÖZETİ'], ['Açılış TL', tl(cash.opening)], ['Gerçek tarihli tahsilat TL', tl(cash.received)], ['Gider TL', tl(cash.spent)], ['Kapanış TL', tl(cash.closing)], ['Bugün itibarıyla kasa TL', tl(cash.today)], ['Paylaştırılmamış harcama TL', tl(c.unallocated)], [],
    ['KASA HAREKETLERİ'], ['Gerçek tarih', 'Tür', 'Kişi / malzeme', 'Hesap dönemi', 'Açıklama', 'Giriş TL', 'Çıkış TL', 'Yürüyen bakiye TL'],
    ...cash.rows.map(x => [x.date, x.type === 'payment' ? 'Tahsilat' : 'Harcama', nameOf(x.type === 'payment' ? 'people' : 'materials', x.personId || x.materialId), x.period || A.periodOf(x.date), x.note, tl(x.incoming), tl(x.outgoing), tl(x.balance)])
  ];
  download('Pay-Defteri-' + period + '.csv', '\ufeff' + rows.map(r => r.map(A.csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8'); toast('CSV raporu indirmeye gönderildi.');
}
async function importFile(file) {
  if (!file || submitting) return;
  submitting = true;
  try {
    if (file.size > 10000000) throw Error('Yedek dosyası 10 MB sınırını aşıyor.');
    const incoming = A.migrate(JSON.parse(await file.text()));
    if (!await ask('Mevcut kayıtlar değiştirilsin mi?', `${incoming.people.length} kişi, ${incoming.materials.length} malzeme, ${incoming.expenses.length} harcama ve ${incoming.payments.length} ödeme yüklenecek.\nMevcut kayıtların tamamı değiştirilecek. Önceki verinin yedeği indirmeye gönderilecek.`, 'Yedeği geri yükle')) return;
    // İçe aktarım, bozuk kayıtların tek kurtarma yazımıdır. Çakışma kontrolü yine geçerlidir.
    if (store.raw !== null) download('Pay-Defteri-Aktarim-Oncesi-' + Date.now() + '.json', store.raw, 'application/json');
    await commit(d => { Object.keys(d).forEach(k => delete d[k]); Object.assign(d, incoming); }, { recover: true });
    render(); toast('Yedek doğrulandı ve kaydedildi.'); await migrationNotice();
  } catch (e) { fail(e); }
  finally { submitting = false; if ($('#importFile')) $('#importFile').value = ''; }
}
async function saveMembers(members) {
  const c = A.calculate(db, period);
  if (JSON.stringify(members) === JSON.stringify(c.members)) { toast('Katılımcılar zaten bu şekilde kayıtlı.'); return; }
  if (c.total && !await ask('Paylar yeniden hesaplansın mı?', `${money(c.total)} harcama ${members.length} kişi arasında yeniden paylaştırılacak. Bu dönemin ve sonraki dönemlerin kişi bakiyeleri değişecek.`)) return;
  await commit(d => { d.periods[period] = members; }); render(); toast('Dönem katılımcıları kaydedildi.');
}
function updateEntryInfo() {
  const form = $('#entryForm'); if (!form) return;
  const f = new FormData(form), date = f.get('date'), exp = active === 'expenses', account = exp ? period : f.get('accountPeriod');
  if (!exp && A.validPeriod(account)) {
    const row = A.calculate(db, account).rows.find(x => x.id === f.get('entity'));
    $('#personInfo').textContent = row ? `${row.member ? 'Dönem katılımcısı' : 'Bu hesap döneminin katılımcısı değil'}. Devreden borç: ${money(row.openingDebt)}. Devreden alacak: ${money(row.openingCredit)}. Güncel hesap dönemi bakiyesi: ${row.net < 0 ? money(-row.net) + ' alacak' : money(row.net) + ' borç'}.` : 'Kısmi ödeme veya avans için bir kişi seçin; dönem katılımcısı olması gerekmez.';
  }
  if (!A.validDate(date)) return;
  const real = A.periodOf(date);
  $('#entryInfo').textContent = (exp ? `Kaydedilen harcama kasadan ödenmiş giderdir. Alım dönemi: ${real}.${real !== period ? ' Seçili dönemin dışında; kayıttan sonra ilgili dönem açılacak.' : ''}` : `Kişi hesabı: ${account}. Gerçek tahsilat dönemi (kasa): ${real}.${real !== account ? ' Tarih ile hesap dönemi farklı: kişi bakiyesi ve kasa farklı dönemlerde etkilenir.' : ''}${date > A.today() ? ' Gelecek tarihli ödeme bugünkü kasaya dahil edilmez.' : ''}`) + (date < db.cash.date ? ' İşlem kasa başlangıç tarihinden önce; kişi hesabına dahil olur ancak kasa kapsamının dışındadır.' : '');
}
function showHistory(pid) {
  const history = A.personHistory(db, pid), payments = db.payments.filter(x => x.personId === pid);
  $('#historyDialog h2').textContent = nameOf('people', pid) + ' · Hesap hareketleri';
  $('#historyContent').innerHTML = `<p class="muted">Pozitif bakiye borç, negatif bakiye alacak / avanstır. İşlemsiz ara dönemlerde bakiye aynen devreder.</p>${history.length ? `<div class="tablewrap"><table><thead><tr><th>Dönem</th><th class="num">Devir</th><th class="num">Pay</th><th class="num">Ödeme</th><th class="num">Net bakiye</th></tr></thead><tbody>${history.map(x => `<tr><td>${periodText(x.period)}</td><td class="num">${money(x.opening)}</td><td class="num">${money(x.due)}</td><td class="num">${money(x.paid)}</td><td class="num">${money(x.net)}</td></tr>`).join('')}</tbody></table></div>` : empty('Hesap hareketi yok', 'Bu kişi için ödeme veya harcama payı henüz oluşmadı.')}<h3>Ödeme kayıtları</h3>${payments.length ? `<div class="tablewrap"><table><thead><tr><th>Gerçek tarih</th><th>Hesap dönemi</th><th class="num">Tutar</th><th>Açıklama</th></tr></thead><tbody>${payments.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).map(x => `<tr><td>${dateText(x.date)}</td><td>${esc(x.period)}</td><td class="num">${money(x.amount)}</td><td>${esc(x.note)}</td></tr>`).join('')}</tbody></table></div>` : empty('Ödeme yok', 'Ödeme ekle düğmesiyle borç ödemesi veya avans alınabilir.')}`;
  $('#historyDialog').showModal();
}
function bind(c) {
  $('#view').querySelectorAll('form').forEach(form => {
    form.addEventListener('input', () => { dirty = true; }); form.addEventListener('change', () => { dirty = true; });
  });
  if ($('#onlyOwing')) $('#onlyOwing').onchange = async e => { const selected = e.target.checked; if (await leaveForm()) { onlyOwing = selected; render(); } else e.target.checked = onlyOwing; };
  if ($('#selectAll')) $('#selectAll').onclick = () => { document.querySelectorAll('[name=member]').forEach(x => { if (!db.people.find(p => p.id === x.value).archived) x.checked = true; }); dirty = true; };
  if ($('#copyMembers')) $('#copyMembers').onclick = async () => {
    if (!await leaveForm()) return;
    const previous = A.movePeriod(period, -1), members = db.periods[previous] || [];
    if (!members.length) return toast('Önceki dönemde kayıtlı katılımcı yok.');
    await submitOnce($('#membersForm'), async () => { await saveMembers([...members]); });
  };
  if ($('#membersForm')) $('#membersForm').onsubmit = e => {
    e.preventDefault(); submitOnce(e.target, async () => {
      const checked = [...document.querySelectorAll('[name=member]:checked')].map(x => x.value);
      const members = [...c.members.filter(x => checked.includes(x)), ...checked.filter(x => !c.members.includes(x))];
      await saveMembers(members);
    });
  };
  if ($('#registryForm')) $('#registryForm').onsubmit = e => {
    e.preventDefault(); submitOnce(e.target, async () => {
      const name = A.normalizeName(new FormData(e.target).get('name')), kind = active, old = editId;
      if (!name) throw Error('Bir ad girin.');
      if (db[kind].some(x => x.id !== old && A.nameKey(x.name) === A.nameKey(name))) throw Error('Bu ad zaten kayıtlı (arşiv dahil). Mevcut kaydı kullanın veya aktifleştirin.');
      await commit(d => { if (old) d[kind].find(x => x.id === old).name = name; else d[kind].push({ id: uid(), name, archived: false }); });
      render(); toast('Kayıt kaydedildi.');
    });
  };
  if ($('#entryForm')) {
    const form = $('#entryForm');
    form.addEventListener('input', updateEntryInfo); form.addEventListener('change', updateEntryInfo);
    if ($('#showArchived')) $('#showArchived').onchange = e => {
      showArchived = e.target.checked;
      // Form yeniden çizilmez: girilen tarih, tutar ve açıklama korunur.
      const select = $('[name=entity]'), selected = select.value;
      select.innerHTML = '<option value="">Kişi seçin</option>' + options(db.people.filter(x => !x.archived || showArchived || x.id === selected), selected);
      form.querySelector('button.primary').disabled = !select.options.length || select.options.length === 1;
    };
    updateEntryInfo(); pendingPerson = null;
    form.onsubmit = e => {
      e.preventDefault(); submitOnce(e.target, async () => {
        const f = new FormData(e.target), kind = active, exp = kind === 'expenses', old = editId;
        const date = f.get('date'), entity = f.get('entity'), amount = A.cents(f.get('amount')), note = f.get('note').trim();
        if (!A.validDate(date)) throw Error('Geçerli bir tarih girin.');
        const target = exp ? A.periodOf(date) : f.get('accountPeriod');
        if (!A.validPeriod(target)) throw Error('Geçerli bir hesap dönemi seçin.');
        if (!db[exp ? 'materials' : 'people'].some(x => x.id === entity)) throw Error('Geçerli bir kişi veya malzeme seçin.');
        if (exp && target !== period && !await ask('Farklı döneme kaydedilsin mi?', `Alım ${periodText(target)} dönemine ait. Kaydettikten sonra bu dönem açılacak.`)) return;
        const addMember = !exp && f.get('addMember') && !(db.periods[target] || []).includes(entity);
        if (addMember) {
          const current = A.calculate(db, target), count = current.members.length + 1;
          if (!await ask('Kişi ayrıca katılımcı yapılsın mı?', `Ödeme kaydına ek olarak ${nameOf('people', entity)} bu hesap döneminin katılımcılarına eklenecek. ${money(current.total)} harcama ${count} kişi arasında yeniden paylaşılacak; bu ve sonraki dönem bakiyeleri değişecek.`)) return;
        }
        const record = { id: old || uid(), date, amount, note, ...(exp ? { materialId: entity } : { personId: entity, period: target }) };
        await commit(d => {
          if (old) { const index = d[kind].findIndex(x => x.id === old); if (index < 0) throw Error('Düzenlenecek kayıt bulunamadı.'); d[kind][index] = record; }
          else d[kind].push(record);
          if (addMember) d.periods[target] = [...(d.periods[target] || []), entity];
        });
        period = target; render(); toast('Kayıt kaydedildi; tüm bakiyeler yeniden hesaplandı.');
      });
    };
  }
  if ($('#cashForm')) $('#cashForm').onsubmit = e => {
    e.preventDefault(); submitOnce(e.target, async () => {
      const f = new FormData(e.target), date = f.get('date'), amount = A.cents(f.get('amount'), { signed: true, zero: true });
      if (!A.validDate(date)) throw Error('Geçerli başlangıç tarihi girin.');
      const excluded = [...db.payments, ...db.expenses].filter(x => x.date < date).length;
      if (!await ask('Başlangıç kasası değiştirilsin mi?', `${dateText(date)} gününün işlemlerinden önce kasa ${money(amount)} kabul edilecek. ${excluded} önceki hareket kasa kapsamı dışında kalacak. Bu tarihten sonraki kasa bakiyeleri yeniden hesaplanacak.`)) return;
      await commit(d => { d.cash = { date, amount }; }); render(); toast('Başlangıç kasası kaydedildi.');
    });
  };
  if ($('#cancelEdit')) $('#cancelEdit').onclick = async () => { if (await leaveForm()) { editId = null; render(); } };
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => { if (await leaveForm()) { editId = b.dataset.edit; render(); $('#view input:not([type=checkbox])')?.focus(); } });
  document.querySelectorAll('[data-pay]').forEach(b => b.onclick = async () => { if (await leaveForm()) { pendingPerson = b.dataset.pay; active = 'payments'; editId = null; render(); $('[name=amount]').focus(); } });
  document.querySelectorAll('[data-history]').forEach(b => b.onclick = () => showHistory(b.dataset.history));
  document.querySelectorAll('[data-delete]').forEach(b => b.onclick = async () => {
    if (!await leaveForm()) return;
    const kind = active, id = b.dataset.delete;
    await submitOnce(b.closest('.panel'), async () => {
      if (!await ask('Kayıt silinsin mi?', 'Bu kayıt silinecek. Etkilenen kişi hesapları ve tüm sonraki dönemlerin kasa bakiyeleri yeniden hesaplanacak.')) return;
      await commit(d => { d[kind] = d[kind].filter(x => x.id !== id); }); render(); toast('Kayıt silindi.');
    });
  });
  document.querySelectorAll('[data-archive]').forEach(b => b.onclick = async () => {
    if (!await leaveForm()) return;
    await submitOnce(b.closest('.panel'), async () => {
      const kind = active, id = b.dataset.archive;
      await commit(d => { const x = d[kind].find(x => x.id === id); x.archived = !x.archived; }); render(); toast('Kayıt güncellendi; geçmiş bakiyeler korundu.');
    });
  });
  if ($('#exportJson')) $('#exportJson').onclick = () => { try { exportJson(); } catch (e) { fail(e); } };
  if ($('#exportCsv')) $('#exportCsv').onclick = () => { try { if (store.blocked) throw Error('Önce kayıtları kurtarın.'); exportCsv(); } catch (e) { fail(e); } };
  if ($('#exportRaw')) $('#exportRaw').onclick = () => { if (store.raw === null) return toast('Mevcut ham kayıt yok.'); download('Pay-Defteri-Ham-Veri-' + Date.now() + '.json', store.raw, 'application/json'); };
  if ($('#exportMigration')) $('#exportMigration').onclick = () => { try { const raw = localStorage.getItem(RAW_BACKUP); if (raw === null) return toast('Sürüm 1 geçiş kopyası yok.'); download('Pay-Defteri-Gecis-Oncesi-v1.json', raw, 'application/json'); } catch (e) { fail(e); } };
  if ($('#importFile')) $('#importFile').onchange = e => importFile(e.target.files[0]);
}
async function navigate(tab, nextPeriod = period) {
  if (!A.validPeriod(nextPeriod)) return toast('Desteklenen dönem aralığı: Ocak 1900 – Aralık 9998.');
  if (!await leaveForm()) { $('#period').value = period; return; }
  active = tab; period = nextPeriod; editId = null; render();
}
document.querySelectorAll('[data-tab]').forEach(b => {
  b.onclick = () => navigate(b.dataset.tab);
  b.onkeydown = e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); const tabs = [...document.querySelectorAll('[data-tab]')], index = tabs.indexOf(b);
    const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs.at(-1) : tabs[(index + (e.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length]; next.focus(); next.click();
  };
});
$('#period').onchange = e => navigate(active, e.target.value);
$('#prev').onclick = () => navigate(active, A.movePeriod(period, -1));
$('#next').onclick = () => navigate(active, A.movePeriod(period, 1));
$('#today').onclick = () => navigate(active, A.periodOf(A.today()));
$('#closeHistory').onclick = () => $('#historyDialog').close();
window.addEventListener('beforeunload', e => { if (dirty || submitting) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('storage', e => { if (e.key === KEY) { store.externalChange(); showProtection(); $('#saveStatus').textContent = 'Başka sekmede değişiklik var · Yazma kapalı'; } });
async function migrationNotice() {
  if (store.blocked || db.migrationNoticeSeen) return;
  await ask('Borç ve alacak devri etkinleştirildi', 'Eski kayıtlarınız korundu. Geçmiş fazla ödemeler artık kişiye özel alacak/avans olarak, ödenmemiş borçlar da borç olarak sonraki dönemlere otomatik yansır. Geçmişten gelen bakiyelerin görünmesi bu hesaplama değişikliğinden kaynaklanır. Özgün veri kopyası Yedek ve aktarım bölümünden indirilebilir.', 'Anladım');
  try { await commit(d => { d.migrationNoticeSeen = true; }); render(); } catch (e) { fail(e); }
}
async function init() {
  await store.load(); db = store.db; render();
  await migrationNotice(); setupPwa();
  if (document.modelContext?.registerTool) {
    try {
      Promise.resolve(document.modelContext.registerTool({
        name: 'read_period_summary', description: 'Kişi devirlerini, borç ve alacaklarını, hesap dönemi ödemelerini ve gerçek tarihli kasayı okur. Tutarlar kuruştur.',
        inputSchema: { type: 'object', properties: { period: { type: 'string', description: 'YYYY-AA dönem başlangıç ayı' } }, required: ['period'], additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input) {
          if (store.blocked) throw Error('Veri koruma kilidi açık; önce güncel kayıtları yükleyin.');
          if (!input || !A.validPeriod(input.period)) throw Error('Geçerli dönem gerekli.');
          const c = A.calculate(db, input.period), cash = A.cashSummary(db, input.period);
          return { period: input.period, totalCents: c.total, paidCents: c.paid, remainingCents: c.remaining, creditCents: c.excess, unallocatedCents: c.unallocated, cash: { openingCents: cash.opening, receivedCents: cash.received, spentCents: cash.spent, closingCents: cash.closing, todayCents: cash.today, startDate: db.cash.date }, people: c.rows.map(x => ({ ...x, name: nameOf('people', x.id) })) };
        }
      })).catch(() => {});
    } catch (_) { /* Deneysel entegrasyon uygulamanın çalışmasını engellemez. */ }
  }
}
function setupPwa() {
  let installPrompt = null;
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) $('#installApp').hidden = true;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; $('#installApp').hidden = false; });
  window.addEventListener('appinstalled', () => { $('#installApp').hidden = true; installPrompt = null; toast('Pay Defteri yüklendi.'); });
  $('#installApp').onclick = async () => {
    if (installPrompt) { await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; }
    else await ask('Ana ekrana yükleyin', 'Android Chrome: ⋮ menüsü → Uygulamayı yükle / Ana ekrana ekle.\niPhone Safari: Paylaş → Ana Ekrana Ekle.\nÇevrimdışı hazırlık tamamlandıktan sonra internetsiz açabilirsiniz. Kayıtlar bu cihazda kalır.', 'Tamam');
    try { await navigator.storage?.persist?.(); } catch (_) {}
  };
  const label = $('#offlineReady');
  let ready = false, allowedReload = false;
  const updateLabel = () => { label.textContent = (ready ? navigator.onLine ? 'Çevrimdışı kullanıma hazır' : 'Çevrimdışısınız · Uygulama çevrimdışı hazır' : 'Çevrimdışı hazırlık henüz doğrulanmadı') + ' · Veriler bu cihazda saklanır; otomatik eşitleme yoktur.'; };
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) { label.textContent = 'Çevrimdışı kurulum için HTTPS veya localhost üzerinden açın. Veriler bu cihazda saklanır.'; return; }
  const verify = worker => new Promise(resolve => {
    if (!worker) return resolve(false);
    const channel = new MessageChannel(), timer = setTimeout(() => resolve(false), 4000);
    channel.port1.onmessage = e => { clearTimeout(timer); channel.port1.close(); resolve(e.data?.ready === true && e.data?.version === '2.0.0'); };
    worker.postMessage({ type: 'CHECK_READY' }, [channel.port2]);
  });
  function offerUpdate(registration) {
    if (!registration.waiting || $('#updateApp')) return;
    const b = document.createElement('button'); b.id = 'updateApp'; b.className = 'small'; b.textContent = 'Yeni sürümü yükle'; label.after(b);
    b.onclick = async () => {
      if (!await leaveForm()) return;
      if (!await ask('Yeni sürüm açılsın mı?', 'Yeni sürüm hazır. Uygulama yeniden açılacak; kaydedilmiş verileriniz korunacak.', 'Güncelle')) return;
      dirty = false; allowedReload = true; registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
    };
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (allowedReload) location.reload(); });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(async reg => {
    offerUpdate(reg);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', async () => {
        if (worker.state === 'installed') offerUpdate(reg);
        if (worker.state === 'activated') { ready = await verify(reg.active); updateLabel(); }
        if (worker.state === 'redundant' && !ready) { label.textContent = 'Çevrimdışı hazırlık tamamlanamadı. Bağlantıyla tekrar açın.'; }
      });
    });
    const initial = await navigator.serviceWorker.ready;
    ready = await verify(initial.active); updateLabel(); offerUpdate(reg);
  }).catch(() => { label.textContent = 'Çevrimdışı hazırlık tamamlanamadı. İnternet bağlantısıyla tekrar açın.'; });
  window.addEventListener('online', updateLabel); window.addEventListener('offline', updateLabel);
}
init().catch(fail);
