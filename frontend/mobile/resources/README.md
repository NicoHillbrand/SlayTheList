Place the following files in this directory for Capacitor to generate Android resources:

- `icon.png` — 1024x1024 app icon (used to generate all Android adaptive icon sizes)
- `splash.png` — 2732x2732 splash screen image

Then run:

```bash
npx capacitor-assets generate
```

This creates the Android-specific `mipmap` and `drawable` resources automatically.
