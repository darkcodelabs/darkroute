# R8 rules.
#
# The app has one class of its own. Everything else is androidbrowserhelper,
# which Android instantiates BY NAME from AndroidManifest.xml — R8 cannot see
# those references, so without these rules a release build strips the launcher
# activity and the app dies on start with a ClassNotFoundException that only
# reproduces in release.

-keep class ai.darkroute.app.** { *; }
-keep class com.google.androidbrowserhelper.** { *; }
-keep class com.google.androidbrowserhelper.locationdelegation.** { *; }
-keep class androidx.browser.trusted.** { *; }
-keep class android.support.customtabs.** { *; }

# The library reflects over these when talking to Chrome's service.
-keepclassmembers class * extends com.google.androidbrowserhelper.trusted.DelegationService {
    public <init>(...);
}
