import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.slaythelist.app",
  appName: "SlayTheList",
  webDir: "dist",
  server: {
    androidScheme: "https",
    iosScheme: "https",
  },
  android: {
    backgroundColor: "#0b1120",
  },
  ios: {
    backgroundColor: "#0b1120",
    contentInset: "automatic",
  },
};

export default config;
