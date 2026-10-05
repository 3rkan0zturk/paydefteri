# Pay Defteri

Türkçe, TL ile çalışan; harcamaları, kişi paylarını, ödemeleri, borç/alacak devrini ve kasayı takip eden statik uygulama. Sunucu, hesap, veritabanı, framework veya derleme gerekmez. GitHub Pages üzerinde `/paydefteri/` gibi depo alt dizinlerinde çalışır.

## Çalıştırma

Dosyaları birlikte statik hosting alanına koyun. GitHub Pages için kaynak dalın kökünü seçin. PWA ve güvenli sekme kilidi için HTTPS kullanın. Yerel geliştirme için projenin üst klasöründe `python -m http.server 8765` çalıştırıp `http://localhost:8765/paydefteri/` açabilirsiniz. Bu komut geliştirme içindir; uygulama sunucu gerektirmez. `file://` üzerinden PWA ve Web Locks desteklenmez.

Güncel Chrome, Edge, Firefox veya Safari kullanın. Web Locks olmayan tarayıcıda yazma güvenli biçimde reddedilir; verinin başka sekmedeki yazımla yarışarak kaybolması önlenir. Veriler cihazın tarayıcısında kalır; cihazlar arasında otomatik eşitleme yoktur. Düzenli JSON yedeği alın.

## Hesapların anlamı

- Dönem ayın 15'inden sonraki ayın 14'ü sonuna kadardır. Harcama alım tarihinin dönemine işlenir. Dönem açmak kayıt üretmez.
- Bütün aktif kişiler ödeme seçimindedir. Katılımcı olmayan kişiden borç ödemesi veya avans alınabilir. Ayrı katılımcı seçeneği kullanılmadıkça paylaştırmaya eklenmez.
- Dönem toplam harcaması katılımcılara tam sayı kuruşla bölünür. Kalan kuruşlar kayıtlı katılımcı sırasıyla verilir. Katılımcısız harcama paylaştırılmadan bekler; kasadan yine düşer.
- Kişi bakiyesi = önceki net bakiye + pay − hesap dönemine işlenen ödeme. Pozitif borç, negatif alacak/avanstır. Devirler kayıt olarak oluşturulmaz; ana kayıtlardan her seferinde hesaplanır. Başka kişinin borcundan mahsup yapılmaz.
- Kasa ödeme tarihini kullanır; kişi hesabı seçilen hesap dönemini kullanır. Hesap dönemi ile gerçek tarih ayrı gösterilir. Kasa açığı gizlenmez. Bugünkü kasa gelecekteki işlemleri dışarıda bırakır.
- Başlangıç kasası bir defalıktır ve başlangıç gününün işlemlerinden önceki parayı belirtir. Önceki işlemler kasa kapsamından çıkar. Başlangıç dönem ortasındaysa dönem açılışı başlangıç tutarı olarak gösterilir ve kapsam açıklanır. Kişi hesapları bundan etkilenmez.

## Dosyalar

- `accounting.js`: saf dönem, pay, devir, kasa, doğrulama ve veri geçişi hesapları.
- `storage.js`: Web Locks, ham geçiş kopyası, atomik işlem modeli, sekme çakışması ve depolama hatası koruması.
- `app.js`: formlar, tablolar, raporlar, yedekleme, PWA güncelleme ve `read_period_summary` entegrasyonu.
- `index.html`, `styles.css`: Türkçe erişilebilir, mobil uyumlu arayüz.
- `sw.js`, `manifest.webmanifest`, simgeler: alt dizin uyumlu çevrimdışı kabuk.

## Eski veriler ve yedekler

Ana anahtar hâlâ `pay-defteri-v1`'dir. Eski `version:1` kayıtları doğrulanarak `version:2`'ye geçirilir. Geçişten önce özgün ham metin `pay-defteri-v1:migration-v1` anahtarına kaydedilir. Kopya kaydedilemiyorsa eski anahtar değiştirilmez. Kopya tekrar geçişte ezilmez; Yedek ve aktarım ekranından indirilebilir. Kimlikler, kişi/malzeme adları, katılımcı sırası, tutarlar, tarihler ve ödeme hesap dönemleri değişmez. Başlangıç kasa tutarı sıfırdır; tarih mevcut en erken hareketten veya bugünden erken olanıdır. Geçmiş alacak ve borçların görünmeye başladığı bir kez açıklanır.

JSON sürüm 1 ve 2 desteklenir. İçe aktarım 10 MB ile sınırlıdır; ilişkiler, kimlikler, tutarlar ve tarihler doğrulanır. Geçersiz dosya mevcut veriyi değiştirmez. Kullanıcının açık onayı ve mevcut ham yedeğin indirmeye gönderilmesinden sonra kayıtlar değiştirilir. Tarayıcı indirme kısıtlarını kontrol edin. CSV UTF-8 BOM, noktalı virgül, Türkçe ondalık ve formül enjeksiyonu korumasıyla üretilir.

Bozuk kayıt yazmayı durdurur; ham veri indirilebilir ve geçerli yedekten kurtarılabilir. Başka sekmedeki değişiklik açık formu silmez; yazmayı durdurup yeniden yüklemeyi ister. Kaydedilmemiş formdan ayrılırken onay alınır.

## PWA güncellemeleri

Service worker bütün yerel kabuk dosyalarını önbelleğe aldıktan sonra hazır olduğunu doğrular. Eksik indirmede yarım önbellek kaldırılır ve hazır denmez. Yeni sürüm bekler; kullanıcı güncellemeyi seçmeden açık uygulama zorunlu yenilenmez. LocalStorage güncellemede silinmez. Gelecek kabuk değişikliklerinde hem `sw.js` içindeki `VERSION` hem `app.js` içindeki hazır sürüm kontrolü birlikte değiştirilmelidir.

## Testler

Node.js 20+ ile, projenin kökünde:

```sh
node --test tests/accounting.test.cjs tests/sw.test.cjs
```

Üretim bağımlılığı gerektirmez. Hesaplar, 15 kabul senaryosunun veri/hesaplama yönleri, geçiş, depolama, CSV güvenliği ve service worker olayları test edilir. Service worker testleri taklit Cache API ile çalışır; gerçek cihaz/çevrimdışı testinin yerine geçmez.

İsteğe bağlı Chromium arayüz/PWA testleri (yalnızca geliştirme bağımlılığı):

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/browser.cjs
```

Tarayıcı testleri ayrı Node test sunucusu açar; gerçek veriler yerine izole tarayıcı bağlamları kullanır. Aktif kişi/avans/çift gönderim, 390px görünüm, sürüm 1 geçişi, ad/arşiv ilişkileri, JSON/CSV indirme, geçersiz aktarım, sekme çakışması, kaydedilmemiş form ve gerçek çevrimdışı açılış/kayıt senaryolarını içerir.

Bu geliştirme ortamında son çalıştırılan 34 Node testi geçti. Gerçek Chromium çalıştırması tarayıcı yürütülebilir dosyası bulunmadığı için başlayamadı; indirme de başarısız oldu. Bulut tarayıcı yerel test adresini açamadı. Dolayısıyla gerçek tarayıcı, mobil görsel kontrol ve gerçek çevrimdışı PWA testleri burada doğrulanmış değildir. iOS/Android ana ekrana yükleme ayrıca gerçek cihazda kontrol edilmelidir.
