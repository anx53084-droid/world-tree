import json
K=['qv.cover','qv.inner','qv.back','qv.pages','qv.swipe','qv.gqName','qv.scan','brand.short']
T={
'zh-CN':['封面','内页','背面','切换卡片页面','左右滑动翻页','{n}卡','扫码查看这张卡片','光栖'],
'zh-TW':['封面','內頁','背面','切換卡片頁面','左右滑動翻頁','{n}卡','掃碼查看這張卡片','光棲'],
'en':['Cover','Inside','Back','Switch card page','Swipe left or right to flip','{n} card','Scan to view this card','Guangqi'],
'ja':['表紙','内ページ','裏面','カードのページ切替','左右にスワイプしてめくる','{n}カード','スキャンしてこのカードを見る','光栖'],
'ko':['표지','내지','뒷면','카드 페이지 전환','좌우로 밀어 넘기기','{n} 카드','스캔하여 이 카드 보기','광서'],
'es':['Portada','Interior','Reverso','Cambiar página de la tarjeta','Desliza a izquierda o derecha para pasar página','Tarjeta {n}','Escanea para ver esta tarjeta','Guangqi'],
'fr':['Couverture','Intérieur','Dos','Changer de page','Balayez à gauche ou à droite pour tourner','Carte {n}','Scannez pour voir cette carte','Guangqi'],
'de':['Cover','Innenseite','Rückseite','Kartenseite wechseln','Nach links oder rechts wischen zum Umblättern','{n}-Karte','Scannen, um diese Karte zu sehen','Guangqi'],
'pt':['Capa','Interior','Verso','Trocar página do cartão','Deslize para os lados para virar','Cartão {n}','Escaneie para ver este cartão','Guangqi'],
'ru':['Обложка','Разворот','Оборот','Переключить страницу карточки','Листайте влево или вправо','Карточка «{n}»','Отсканируйте, чтобы открыть карточку','Guangqi'],
'ar':['الغلاف','الصفحة الداخلية','الظهر','تبديل صفحة البطاقة','اسحب يمينًا أو يسارًا للتقليب','بطاقة {n}','امسح لعرض هذه البطاقة','Guangqi'],
'hi':['कवर','अंदर का पेज','पीछे','कार्ड पेज बदलें','पलटने के लिए बाएँ या दाएँ स्वाइप करें','{n} कार्ड','यह कार्ड देखने के लिए स्कैन करें','Guangqi'],
'id':['Sampul','Halaman dalam','Belakang','Ganti halaman kartu','Geser kiri atau kanan untuk membalik','Kartu {n}','Pindai untuk melihat kartu ini','Guangqi'],
'th':['หน้าปก','หน้าด้านใน','ด้านหลัง','สลับหน้าการ์ด','ปัดซ้ายหรือขวาเพื่อพลิก','การ์ด{n}','สแกนเพื่อดูการ์ดใบนี้','Guangqi'],
'tr':['Kapak','İç sayfa','Arka','Kart sayfasını değiştir','Çevirmek için sola veya sağa kaydır','{n} kartı','Bu kartı görmek için tara','Guangqi'],
'vi':['Bìa','Trang trong','Mặt sau','Chuyển trang thẻ','Vuốt trái hoặc phải để lật','Thẻ {n}','Quét để xem thẻ này','Guangqi'],
}
for loc,v in T.items():
    assert len(v)==len(K),loc
    p=f'/workspace/world-tree/public/i18n/{loc}.json'; j=json.load(open(p,encoding='utf8')); j.update(dict(zip(K,v)))
    json.dump(j,open(p,'w',encoding='utf8'),indent=2,ensure_ascii=False); open(p,'a').write('\n')
print(len(T))
