# React Native UI pitfalls hit in a real warehouse app

Each item: symptom the user reported → cause → fix that worked.

## Buttons hidden under the tab bar
- **Symptom:** "the edits on the order has no way of saving".
- **Cause:** the tab bar is `position: 'absolute', bottom: 0` and rendered
  after the screen, so it sat on top of the screen's own absolute
  Save/CTA bar. The same bug hid the detail screen's primary button.
- **Fix:** show the tab bar only on top-level screens (list, modes). Screens
  with their own bottom action bar (detail, edit) get a back button instead.
  Pad bottom bars with `useSafeAreaInsets().bottom`.

## Keyboard covering an input
- **Symptom:** "the address edit is at the bottom … covered with the pop up
  keyboard".
- **Fix, all three:**
  1. Wrap the screen in `KeyboardAvoidingView` with
     `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`.
  2. `ScrollView` with `keyboardShouldPersistTaps="handled"` and
     `automaticallyAdjustKeyboardInsets` (iOS).
  3. Put the bottom action bar **in the layout flow** (not absolute) so the
     keyboard pushes it up, and move frequently typed fields (address) to the
     top of the form.
- Bottom sheets with inputs (e.g. a "delivery cost" sheet) get the same
  `KeyboardAvoidingView` wrapper and `autoFocus`.

## Uploads that look saved but aren't
- **Symptom:** "the app dont save any images … it shows that the contents
  were uploaded". Nothing ever reached Shopify Files.
- **Cause:** the camera sheet added each shot's local thumbnail immediately,
  and the failure toast (2.2 s) appeared behind the full-screen sheet.
- **Fix:** keep per-item state (`uploading | saved | failed + reason`),
  overlay a spinner or ↻ on each thumbnail, show the last error as persistent
  text, and retry on tap. Have the upload function return
  `{ ok: true } | { ok: false, error }` instead of only toasting. Translate
  permission errors into the fix ("add read_files and write_files …").

## Endless spinner on launch
- `useFonts` returns `[loaded, error]`. Gating the whole app on `loaded`
  alone means a font that fails over a flaky dev connection blocks the app
  forever. Render when `loaded || error`, falling back to system fonts.
- Import only the font weights you use from per-weight subpaths
  (`@expo-google-fonts/<family>/400Regular/…ttf`); the package root pulls
  every weight into the bundle.

## Arabic / RTL without restarts
- `I18nManager.forceRTL` needs an app restart. For a live language toggle,
  set `direction: ar ? 'rtl' : 'ltr'` on the root view and `textAlign` per
  input; keep phone numbers / AWBs in a mono component with
  `writingDirection: 'ltr'`.
- Accept Arabic-Indic digits and `٫`/`,` decimals in numeric inputs.

## Make modes impossible to confuse
- Truck loading for OKA's own deliveries uses **blue** (screen, status-bar
  strip, selected pill, check marks, scan flash) while courier pickups stay
  green, and wrong scans flash red with an error haptic. Paint the status-bar
  area from the app shell too, or the top strip stays the old colour.
- A mode switch mid-run asks for confirmation and starts a new list.

## Tagging who carries a parcel
- A small bordered mono tag per row (`J&T` red, `BOSTA` grey, `OKA` green)
  plus filter tabs per courier made a mixed-courier list readable.
- Show courier-reported problems (failed delivery reason) and money mismatches
  (courier COD ≠ Shopify balance) as a one-line coloured row under the
  customer line, with the detail on the order screen.

## Full-screen photo viewing
- `Modal` + `expo-image` with `contentFit="contain"`, tap to close. Show a
  placeholder with "processing" while a file's CDN URL isn't ready yet.
