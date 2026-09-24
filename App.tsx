// Imported from per-weight subpaths, not the package root: the root index
// re-exports every weight and italic, which Metro would then bundle (~4 MB of
// unused TTFs on a warehouse handset).
import IBMPlexMono_400Regular from '@expo-google-fonts/ibm-plex-mono/400Regular/IBMPlexMono_400Regular.ttf';
import IBMPlexMono_500Medium from '@expo-google-fonts/ibm-plex-mono/500Medium/IBMPlexMono_500Medium.ttf';
import IBMPlexMono_600SemiBold from '@expo-google-fonts/ibm-plex-mono/600SemiBold/IBMPlexMono_600SemiBold.ttf';
import IBMPlexSansArabic_400Regular from '@expo-google-fonts/ibm-plex-sans-arabic/400Regular/IBMPlexSansArabic_400Regular.ttf';
import IBMPlexSansArabic_500Medium from '@expo-google-fonts/ibm-plex-sans-arabic/500Medium/IBMPlexSansArabic_500Medium.ttf';
import IBMPlexSansArabic_600SemiBold from '@expo-google-fonts/ibm-plex-sans-arabic/600SemiBold/IBMPlexSansArabic_600SemiBold.ttf';
import IBMPlexSansArabic_700Bold from '@expo-google-fonts/ibm-plex-sans-arabic/700Bold/IBMPlexSansArabic_700Bold.ttf';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, I18nManager, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BusyBar, Toast } from './src/components/Toast';
import { TabBar } from './src/components/TabBar';
import { CallSheet } from './src/screens/CallSheet';
import { EditOrderScreen } from './src/screens/EditOrderScreen';
import { ModesScreen } from './src/screens/ModesScreen';
import { OrderDetailScreen } from './src/screens/OrderDetailScreen';
import { OrdersListScreen, Loading } from './src/screens/OrdersListScreen';
import { PhotoSheet } from './src/screens/PhotoSheet';
import { DeliverSheet } from './src/screens/DeliverSheet';
import { PickupScreen } from './src/screens/PickupScreen';
import { ScanScreen } from './src/screens/ScanScreen';
import { ShipDetailScreen } from './src/screens/ShipDetailScreen';
import { ShipStatusScreen } from './src/screens/ShipStatusScreen';
import { TrackScreen } from './src/screens/TrackScreen';
import { WaSheet } from './src/screens/WaSheet';
import { AppProvider, useApp } from './src/state/AppState';
import { C } from './src/theme/tokens';

// Arabic is rendered right-to-left per-view via `direction`, not by forcing an
// app-wide RTL restart — the language toggle has to work without relaunching.
I18nManager.allowRTL(false);

export default function App() {
  const [fontsLoaded] = useFonts({
    PlexAr_400Regular: IBMPlexSansArabic_400Regular,
    PlexAr_500Medium: IBMPlexSansArabic_500Medium,
    PlexAr_600SemiBold: IBMPlexSansArabic_600SemiBold,
    PlexAr_700Bold: IBMPlexSansArabic_700Bold,
    PlexMono_400Regular: IBMPlexMono_400Regular,
    PlexMono_500Medium: IBMPlexMono_500Medium,
    PlexMono_600SemiBold: IBMPlexMono_600SemiBold,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={C.green} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AppProvider>
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}

// Order detail and edit keep their own action bar at the bottom, which the
// tab bar would cover, so only the top-level screens get it.
const TAB_SCREENS = ['list', 'modes'] as const;

function Shell() {
  const { screen, sheet, selected, ar, toast, busy, L, loading } = useApp();
  const insets = useSafeAreaInsets();

  const showTabs = (TAB_SCREENS as readonly string[]).includes(screen) && sheet === null;
  const darkScreen = screen === 'scan' || screen === 'pickup' || sheet === 'call' || sheet === 'photo';

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: darkScreen ? C.dark : C.bg,
        paddingTop: insets.top,
      }}
    >
      <StatusBar style={darkScreen ? 'light' : 'dark'} />

      {/* `direction` flips the whole subtree for Arabic without an app restart. */}
      <View style={{ flex: 1, minHeight: 0, direction: ar ? 'rtl' : 'ltr' }}>
        {screen === 'list' ? <OrdersListScreen /> : null}
        {screen === 'scan' ? <ScanScreen /> : null}
        {screen === 'modes' ? <ModesScreen /> : null}
        {screen === 'pickup' ? <PickupScreen /> : null}
        {screen === 'shipstatus' ? <ShipStatusScreen /> : null}

        {screen === 'detail' ? (
          selected ? <OrderDetailScreen order={selected} /> : <Loading label={L.loading} />
        ) : null}
        {screen === 'edit' ? (
          selected ? <EditOrderScreen order={selected} /> : <Loading label={L.loading} />
        ) : null}
        {screen === 'track' ? (
          selected ? <TrackScreen order={selected} /> : <Loading label={L.loading} />
        ) : null}
        {screen === 'shipdetail' ? (
          selected ? <ShipDetailScreen order={selected} /> : <Loading label={L.loading} />
        ) : null}

        {showTabs && !loading ? <TabBar bottomInset={insets.bottom} /> : null}

        {sheet === 'wa' && selected ? <WaSheet order={selected} /> : null}
        {sheet === 'call' && selected ? <CallSheet order={selected} /> : null}
        {sheet === 'photo' && selected ? <PhotoSheet order={selected} /> : null}
        {sheet === 'deliver' && selected ? <DeliverSheet order={selected} /> : null}
      </View>

      {busy ? <BusyBar message={busy} top={insets.top + 12} /> : null}
      {toast && !busy ? <Toast message={toast} top={insets.top + 12} /> : null}
    </View>
  );
}
