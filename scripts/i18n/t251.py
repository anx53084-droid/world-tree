import json
K=['grow.count','grow.explain','grow.freeBtn','grow.samples']
T={'zh-CN':['已有 {n} 张心愿卡','心愿卡越多，星河越亮、光晕越盛；免费心愿也会点亮，只是权重小一些','免费写一个心愿','官方示范心愿'],
'zh-TW':['已有 {n} 張心願卡','心願卡越多，星河越亮、光暈越盛；免費心願也會點亮，只是權重小一些','免費寫一個心願','官方示範心願'],
'en':['{n} wish cards so far','The more cards, the brighter the galaxy and its glow; free wishes count too, with a smaller weight','Write a wish for free','Official sample wishes'],
'ja':['これまでに {n} 枚の願いカード','カードが増えるほど銀河と光が明るくなります。無料の願いも少しだけ加わります','無料で願いを書く','公式サンプルの願い'],
'ko':['지금까지 소원 카드 {n}장','카드가 많을수록 은하와 빛이 더 밝아져요. 무료 소원도 조금 더 적은 비중으로 반영돼요','무료로 소원 쓰기','공식 예시 소원'],
'es':['{n} tarjetas de deseos hasta ahora','Cuantas más tarjetas, más brilla la galaxia; los deseos gratuitos también cuentan, con menor peso','Escribe un deseo gratis','Deseos de ejemplo oficiales'],
'fr':['{n} cartes de vœux à ce jour','Plus il y a de cartes, plus la galaxie et son halo brillent ; les vœux gratuits comptent aussi, avec un poids moindre','Écrire un vœu gratuitement','Vœux d’exemple officiels'],
'de':['Bisher {n} Wunschkarten','Je mehr Karten, desto heller leuchten Galaxie und Schein; kostenlose Wünsche zählen auch, mit geringerem Gewicht','Kostenlos einen Wunsch schreiben','Offizielle Beispielwünsche'],
'pt':['{n} cartões de desejo até agora','Quanto mais cartões, mais brilha a galáxia; desejos gratuitos também contam, com peso menor','Escreva um desejo grátis','Desejos de exemplo oficiais'],
'ru':['Уже {n} карточек желаний','Чем больше карточек, тем ярче галактика и сияние; бесплатные желания тоже учитываются, но с меньшим весом','Написать желание бесплатно','Официальные примеры желаний'],
'ar':['حتى الآن {n} بطاقة أمنيات','كلما زادت البطاقات ازداد سطوع المجرة وتوهجها؛ الأمنيات المجانية تُحتسب أيضًا بوزن أقل','اكتب أمنية مجانًا','أمنيات نموذجية رسمية'],
'hi':['अब तक {n} इच्छा कार्ड','जितने ज़्यादा कार्ड, आकाशगंगा और चमक उतनी तेज़; मुफ़्त इच्छाएँ भी कम भार के साथ गिनी जाती हैं','मुफ़्त में एक इच्छा लिखें','आधिकारिक नमूना इच्छाएँ'],
'id':['Sudah ada {n} kartu harapan','Makin banyak kartu, makin terang galaksi dan cahayanya; harapan gratis juga dihitung dengan bobot lebih kecil','Tulis harapan gratis','Contoh harapan resmi'],
'th':['มีการ์ดคำอธิษฐานแล้ว {n} ใบ','ยิ่งมีการ์ดมาก กาแล็กซีและแสงเรืองยิ่งสว่าง คำอธิษฐานฟรีก็นับด้วยแต่มีน้ำหนักน้อยกว่า','เขียนคำอธิษฐานฟรี','ตัวอย่างคำอธิษฐานทางการ'],
'tr':['Şimdiye kadar {n} dilek kartı','Kart arttıkça galaksi ve ışıltı parlaklaşır; ücretsiz dilekler de daha küçük ağırlıkla sayılır','Ücretsiz bir dilek yaz','Resmî örnek dilekler'],
'vi':['Đã có {n} thẻ điều ước','Càng nhiều thẻ, dải ngân hà và ánh sáng càng rực rỡ; điều ước miễn phí cũng được tính với trọng số nhỏ hơn','Viết một điều ước miễn phí','Điều ước mẫu chính thức']}
for loc,v in T.items():
    p=f'/workspace/world-tree/public/i18n/{loc}.json'; j=json.load(open(p,encoding='utf8')); j.update(dict(zip(K,v)))
    json.dump(j,open(p,'w',encoding='utf8'),indent=2,ensure_ascii=False); open(p,'a').write('\n')
