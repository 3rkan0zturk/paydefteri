/* Yazma tamamlanmadan bellekteki veriyi değiştirme; sekmeler arası kilitle ve kıyasla. */
(function (root) {
  'use strict';
  const KEY = 'pay-defteri-v1', RAW_BACKUP = KEY + ':migration-v1';
  class Store {
    constructor(storage, locks, accounting, { requireLocks = false } = {}) {
      this.storage = storage; this.locks = locks; this.a = accounting;
      this.requireLocks = requireLocks;
      this.db = accounting.blank(); this.raw = null; this.blocked = false; this.reason = ''; this.busy = false;
    }
    async exclusive(action) {
      if (this.busy) throw Error('Kayıt işlemi sürüyor. Lütfen bekleyin.');
      this.busy = true;
      try {
        if (this.locks) return await this.locks.request(KEY + ':write', action);
        return action();
      } finally { this.busy = false; }
    }
    async load() {
      try {
        await this.exclusive(() => {
          this.raw = this.storage.getItem(KEY);
          if (!this.raw) return;
          const source = JSON.parse(this.raw), next = this.a.migrate(source);
          if (source.version === 1) {
            if (this.requireLocks && !this.locks) throw Error('Güvenli sekme kilidi desteklenmiyor. Güncel bir tarayıcıyla HTTPS veya localhost üzerinden açın.');
            // İlk ham kopya tekrar geçişte veya içe aktarmada ezilmez.
            if (this.storage.getItem(RAW_BACKUP) === null) this.storage.setItem(RAW_BACKUP, this.raw);
            if (this.storage.getItem(RAW_BACKUP) === null) throw Error('Geçiş öncesi ham kopya saklanamadı.');
            const raw = JSON.stringify(next);
            this.storage.setItem(KEY, raw);
            this.raw = raw;
          }
          this.db = next;
        });
      } catch (e) { this.blocked = true; this.reason = 'Kayıtlar açılamadı; veri kaybını önlemek için yazma kapalı. Ham veriyi indirin veya geçerli yedek yükleyin. ' + e.message; }
    }
    async commit(change, { recover = false } = {}) {
      return this.exclusive(() => {
        if (this.requireLocks && !this.locks) throw Error('Bu tarayıcı güvenli sekme kilidini desteklemiyor. Güncel Chrome, Edge, Firefox veya Safari ile HTTPS / localhost üzerinden açın. Kayıt yapılmadı.');
        if (this.blocked && !recover) throw Error(this.reason || 'Kayıt kapalı.');
        let actual;
        try { actual = this.storage.getItem(KEY); } catch (_) { throw Error('Depolama okunamıyor. Kayıt yapılmadı.'); }
        if (actual !== this.raw) { this.blocked = true; this.reason = 'Başka sekmede değişiklik var. Önce güncel kayıtları yeniden yükleyin.'; throw Error(this.reason); }
        const next = structuredClone(this.db);
        change(next); this.a.validate(next); next.updatedAt = new Date().toISOString();
        const raw = JSON.stringify(next);
        try { this.storage.setItem(KEY, raw); } catch (_) { throw Error('Tarayıcı veriyi kaydedemedi. İşlem kaydedilmedi; yedek alın ve depolama alanını kontrol edin.'); }
        this.db = next; this.raw = raw; this.blocked = false; this.reason = '';
        return next;
      });
    }
    externalChange() { this.blocked = true; this.reason = 'Kayıtlar başka sekmede değişti. Açık formu korumak için kayıt durduruldu; güncel kayıtları yeniden yükleyin.'; }
  }
  const api = { KEY, RAW_BACKUP, Store };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PayStorage = api;
})(globalThis);
