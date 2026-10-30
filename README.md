# MediaHub Providers

مستودع إضافات JavaScript لتطبيق MediaHub على Samsung Tizen.

## الملفات
- `repo.json`: رابط المستودع الذي تضيفه داخل MediaHub.
- `providers/akwam.js`: أول تحويل تجريبي لموقع أكوام.
- `providers/template.js`: قالب لإنشاء مزود جديد.

## طريقة الإضافة
1. ارفع محتويات هذا المجلد إلى جذر مستودع GitHub باسم `MediaHub-Providers`.
2. افتح إعدادات MediaHub ثم أضف رابط:
   `https://raw.githubusercontent.com/kavehtheman1-lab/MediaHub-Providers/main/repo.json`
3. احفظ المستودع وأعد تحميل التطبيق.

## ملاحظات
- ملفات Cloudstream الأصلية بصيغة Kotlin أو `.cs3` لا تعمل مباشرة على Samsung Tizen؛ يجب تحويل منطق كل موقع إلى JavaScript.
- Akwam هو أول مزود في هذه الدفعة. لم يتم تحويل بقية إضافات المستودع بعد.
- قد تتغير بنية موقع Akwam أو نطاقه أو قيود الوصول، ولذلك يلزم اختباره على التلفزيون وتحديث المحددات عند الحاجة.
- جودة التشغيل تعتمد على أن روابط الموقع مباشرة وأن مشغل MediaHub يستطيع الوصول إليها؛ بعض الروابط قد تحتاج دعم Referer/headers من المشغل.
