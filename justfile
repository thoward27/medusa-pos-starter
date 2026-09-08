# Loads .env so EXPO_PUBLIC_* vars are exported into the native build steps
# (iOS "Bundle React Native code and images" / Android bundleRelease bake them into the JS bundle)
set dotenv-load := true

# --- Shared -----------------------------------------------------------------
config := "Release"

# --- iOS config -------------------------------------------------------------
# Override on the command line, e.g.  just ios_device="<udid>" ios
ios_device    := "00008112-000260823407401E"   # Thomas's iPad
ios_team      := "282G863XUH"
ios_scheme    := "agilopos"
ios_bundle_id := "com.tomhoward.agilopos"
ios_app_path  := "ios/build/Build/Products/" + config + "-iphoneos/" + ios_scheme + ".app"

# --- Android config ---------------------------------------------------------
android_sdk    := env_var_or_default("ANDROID_HOME", env_var_or_default("ANDROID_SDK_ROOT", env_var_or_default("HOME", "") + "/Library/Android/sdk"))
adb            := android_sdk + "/platform-tools/adb"
android_app_id := "com.agilo.pos"
android_apk    := "android/app/build/outputs/apk/release/app-release.apk"

# Default: show available recipes
default:
    @just --list

# ── Auto-detect ────────────────────────────────────────────────────────────

# Detect the connected device and run the matching platform flow
launch:
    #!/usr/bin/env bash
    set -euo pipefail
    # Android first: any device reachable via adb?
    if [ -x "{{adb}}" ] && [ -n "$("{{adb}}" devices | sed '1d' | awk '$2=="device"{print $1}')" ]; then
        echo "▶ Android device detected — running 'just android'"
        exec just android
    fi
    # iOS: a physical device shows up in xctrace's Devices section (simulators are separate)
    if xcrun xctrace list devices 2>/dev/null \
         | awk '/== Devices ==/{f=1;next} /== Simulators ==/{f=0} f' \
         | grep -Eq '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}|[0-9a-f]{40}'; then
        echo "▶ iOS device detected — running 'just ios'"
        exec just ios
    fi
    echo "No connected device found." >&2
    echo "  • iOS: plug in the iPad and trust this Mac, then 'just ios'" >&2
    echo "  • Android: enable USB debugging, then 'just android'" >&2
    exit 1

# List connected devices on both platforms
devices:
    @echo "── iOS ──";     xcrun devicectl list devices 2>/dev/null || true
    @echo "── Android ──"; [ -x "{{adb}}" ] && "{{adb}}" devices || echo "adb not found at {{adb}}"

# ── iOS ────────────────────────────────────────────────────────────────────

# Build, install, and launch on the physical iOS device (replaces `expo run:ios --device`)
ios: ios-build ios-install ios-launch

# Build the signed iOS app (auto-provisioning on — the bit `expo run:ios` fumbles on free teams)
ios-build:
    xcodebuild \
      -workspace ios/{{ios_scheme}}.xcworkspace \
      -scheme {{ios_scheme}} \
      -configuration {{config}} \
      -destination 'id={{ios_device}}' \
      -derivedDataPath ios/build \
      -allowProvisioningUpdates \
      -allowProvisioningDeviceRegistration \
      DEVELOPMENT_TEAM={{ios_team}} \
      build

# iOS build that wipes intermediates first (use when builds get stale/weird)
ios-build-clean:
    xcodebuild \
      -workspace ios/{{ios_scheme}}.xcworkspace \
      -scheme {{ios_scheme}} \
      -configuration {{config}} \
      -destination 'id={{ios_device}}' \
      -derivedDataPath ios/build \
      -allowProvisioningUpdates \
      -allowProvisioningDeviceRegistration \
      DEVELOPMENT_TEAM={{ios_team}} \
      clean build

# Install the built .app onto the iOS device
ios-install:
    xcrun devicectl device install app --device {{ios_device}} {{ios_app_path}}

# Launch the installed iOS app
ios-launch:
    xcrun devicectl device process launch --device {{ios_device}} {{ios_bundle_id}}

# ── Android ────────────────────────────────────────────────────────────────

# Build, install, and launch on the connected Android device (replaces `expo run:android --device`)
android: android-build android-install android-launch

# Build the release APK (signs with the debug keystore per android/app/build.gradle)
android-build:
    cd android && ./gradlew :app:assembleRelease

# Android build that cleans first (use when builds get stale/weird)
android-build-clean:
    cd android && ./gradlew :app:clean :app:assembleRelease

# Install the built APK onto the Android device
android-install:
    "{{adb}}" install -r {{android_apk}}

# Launch the installed Android app
android-launch:
    "{{adb}}" shell monkey -p {{android_app_id}} -c android.intent.category.LAUNCHER 1
