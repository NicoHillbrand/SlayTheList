#import <Capacitor/Capacitor.h>

// This bridge file registers the Swift plugin with Capacitor's ObjC runtime.
// After running `npx cap add ios`, copy this file into ios/App/App/.

CAP_PLUGIN(AppleRemindersPlugin, "AppleReminders",
    CAP_PLUGIN_METHOD(requestAccess, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getLists, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getReminders, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(createReminder, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(updateReminder, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(deleteReminder, CAPPluginReturnPromise);
)
