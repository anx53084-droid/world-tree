import json
K=['qv.swipe2','qv.prev','qv.next']
T={'zh-CN':['左右滑动翻页，翻过最后一页进入下一张','上一张','下一张'],'zh-TW':['左右滑動翻頁，翻過最後一頁進入下一張','上一張','下一張'],
'en':['Swipe to turn pages; past the last page goes to the next card','Previous card','Next card'],
'ja':['左右スワイプでページをめくり、最後のページの次は次のカードへ','前のカード','次のカード'],
'ko':['좌우로 밀어 페이지를 넘기고, 마지막 페이지 다음은 다음 카드로','이전 카드','다음 카드'],
'es':['Desliza para pasar página; tras la última, pasa a la siguiente tarjeta','Tarjeta anterior','Tarjeta siguiente'],
'fr':['Balayez pour tourner les pages ; après la dernière, carte suivante','Carte précédente','Carte suivante'],
'de':['Wischen zum Umblättern; nach der letzten Seite folgt die nächste Karte','Vorherige Karte','Nächste Karte'],
'pt':['Deslize para virar páginas; após a última, vai para o próximo cartão','Cartão anterior','Próximo cartão'],
'ru':['Листайте страницы; после последней — следующая карточка','Предыдущая карточка','Следующая карточка'],
'ar':['اسحب لتقليب الصفحات؛ بعد الصفحة الأخيرة تنتقل إلى البطاقة التالية','البطاقة السابقة','البطاقة التالية'],
'hi':['पन्ने पलटने के लिए स्वाइप करें; आख़िरी पन्ने के बाद अगला कार्ड','पिछला कार्ड','अगला कार्ड'],
'id':['Geser untuk membalik halaman; setelah halaman terakhir lanjut ke kartu berikutnya','Kartu sebelumnya','Kartu berikutnya'],
'th':['ปัดเพื่อพลิกหน้า เลยหน้าสุดท้ายจะไปการ์ดถัดไป','การ์ดก่อนหน้า','การ์ดถัดไป'],
'tr':['Sayfa çevirmek için kaydır; son sayfadan sonra sonraki kart','Önceki kart','Sonraki kart'],
'vi':['Vuốt để lật trang; qua trang cuối sẽ sang thẻ tiếp theo','Thẻ trước','Thẻ tiếp theo']}
for loc,v in T.items():
    p=f'/workspace/world-tree/public/i18n/{loc}.json'; j=json.load(open(p,encoding='utf8')); j.update(dict(zip(K,v))); j.pop('qv.swipe',None)
    json.dump(j,open(p,'w',encoding='utf8'),indent=2,ensure_ascii=False); open(p,'a').write('\n')
print(len(T))
