import * as Linking from 'expo-linking';
import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';

import { Card, Txt } from '../components/primitives';
import { money, waNumber, type Order } from '../api/model';
import { useApp } from '../state/AppState';
import { C, R } from '../theme/tokens';

type Template = { title: string; body: string; tone: string };

/** Templates are built from the live order, so every message carries real data. */
function templatesFor(order: Order, ar: boolean, target: 'customer' | 'courier'): Template[] {
  const awb = order.awb ?? order.name;
  const cod = money(order.cod);

  if (target === 'courier') {
    return ar
      ? [
          {
            title: 'فين حضرتك',
            body: `فين حضرتك ووصول إمتى لأوردر رقم ${awb} لاسم ${order.customerName}؟ العميل محتاج الأوردر، اتصل بيه على ${order.phone}`,
            tone: C.green,
          },
          { title: 'فين الأوردر', body: `أوردر ${awb} فين دلوقتي؟`, tone: C.green },
          {
            title: 'اتصل بالعميل',
            body: 'برجاء تحاول تتصل بالعميل قبل التوصيل.',
            tone: C.greenDeep,
          },
          { title: 'رجّع للمخزن', body: `برجاء ترجيع أوردر ${awb} للمخزن.`, tone: C.red },
        ]
      : [
          {
            title: 'Location check',
            body: `Where are you and when will you arrive at order ${awb} for ${order.customerName}? The customer needs the order, call him on ${order.phone}`,
            tone: C.green,
          },
          { title: 'Where is it', body: `Where is order ${awb} right now?`, tone: C.green },
          {
            title: 'Call the customer',
            body: 'Please try calling the customer before delivery.',
            tone: C.greenDeep,
          },
          { title: 'Return to warehouse', body: `Please return order ${awb} to the warehouse.`, tone: C.red },
        ];
  }

  return ar
    ? [
        {
          title: 'تأكيد الأوردر',
          body: `أهلاً، بنأكد أوردر ${awb} وقيمته ${cod} جنيه.`,
          tone: C.green,
        },
        {
          title: 'خارج للتوصيل',
          body: 'أوردرك خرج مع المندوب النهاردة، برجاء تجهيز المبلغ.',
          tone: C.greenDeep,
        },
        {
          title: 'مش بنرد',
          body: 'حاولنا نتصل بك ولم نتمكن من الوصول. متاح إمتى للتوصيل؟',
          tone: C.amber,
        },
        { title: 'تأكيد العنوان', body: `برجاء تأكيد العنوان: ${order.address}`, tone: C.ink },
      ]
    : [
        { title: 'Confirm order', body: `Hi, confirming order ${awb} for ${cod} EGP.`, tone: C.green },
        {
          title: 'Out for delivery',
          body: 'Your order is out with the courier today. Please have the cash ready.',
          tone: C.greenDeep,
        },
        {
          title: 'No answer',
          body: 'We tried calling and could not reach you. When are you available?',
          tone: C.amber,
        },
        { title: 'Confirm address', body: `Please confirm your address: ${order.address}`, tone: C.ink },
      ];
}

export function WaSheet({ order }: { order: Order }) {
  const { L, ar, openSheet, contactTarget, logWhatsApp, showToast, setContactTarget } = useApp();

  const isCourier = contactTarget === 'courier' && order.courier !== null;
  const phone = isCourier ? (order.courier as { phone: string }).phone : order.phone;
  const templates = useMemo(
    () => templatesFor(order, ar, isCourier ? 'courier' : 'customer'),
    [ar, isCourier, order],
  );

  const send = async (t: Template) => {
    const url = `whatsapp://send?phone=${waNumber(phone)}&text=${encodeURIComponent(t.body)}`;
    const fallback = `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(t.body)}`;
    openSheet(null);
    setContactTarget('customer');
    try {
      const ok = await Linking.canOpenURL(url);
      await Linking.openURL(ok ? url : fallback);
      showToast(L.waSent);
    } catch {
      await Linking.openURL(fallback).catch(() => undefined);
    }
    await logWhatsApp(order, t.title, t.body, phone);
  };

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'flex-end',
      }}
    >
      <Pressable style={{ flex: 1 }} onPress={() => openSheet(null)} />

      <View
        style={{
          backgroundColor: C.bg,
          borderTopLeftRadius: R.sheet,
          borderTopRightRadius: R.sheet,
          paddingTop: 18,
          paddingHorizontal: 18,
          paddingBottom: 26,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
          }}
        >
          <Txt f="sansSemi" size={18}>
            {L.templates}
          </Txt>
          <Pressable
            onPress={() => openSheet(null)}
            style={{
              width: 34,
              height: 34,
              borderRadius: 11,
              backgroundColor: C.ink06,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Txt f="sansSemi" size={15}>
              ✕
            </Txt>
          </Pressable>
        </View>

        <View style={{ gap: 9 }}>
          {templates.map((t) => (
            <Card
              key={t.title}
              onPress={() => void send(t)}
              style={{ padding: 14, flexDirection: 'row', gap: 12, alignItems: 'center' }}
            >
              <View style={{ width: 8, height: 38, borderRadius: 4, backgroundColor: t.tone }} />
              <View style={{ flex: 1 }}>
                <Txt f="sansSemi" size={14}>
                  {t.title}
                </Txt>
                <Txt size={13} lh={18} color={C.ink50} style={{ marginTop: 3 }}>
                  {t.body}
                </Txt>
              </View>
            </Card>
          ))}
        </View>
      </View>
    </View>
  );
}
