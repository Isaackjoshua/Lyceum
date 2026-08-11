#!/bin/bash

# Link the binary onto PATH.
if type update-alternatives 2>/dev/null >&1; then
    # Remove a previous link if it does not go through update-alternatives.
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# --- Chromium sandbox -------------------------------------------------------
#
# Chromium isolates its renderers either with an unprivileged user namespace or,
# failing that, with a setuid helper. It refuses to run with neither, and that
# refusal is fatal at startup, not a degradation.
#
# Ubuntu 24.04 and later set kernel.apparmor_restrict_unprivileged_userns=1,
# which denies unprivileged user namespaces to any binary without an AppArmor
# profile that grants them. The stock check here is `unshare --user true`, but
# this script runs as root during installation, and root is exempt from that
# restriction — so the test passes, the setuid bit is left off, and the app then
# dies for the ordinary user who actually runs it.
#
# So: ask the kernel directly. Where the restriction is in force, install a
# profile granting this one binary the permission, which keeps the namespace
# sandbox. Only where that is unavailable do we fall back to the setuid helper.

APPARMOR_PROFILE='/etc/apparmor.d/${executable}'
RESTRICTED=0
if [ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
    RESTRICTED=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)
fi

PROFILE_INSTALLED=0
if [ "$RESTRICTED" = "1" ] && type apparmor_parser >/dev/null 2>&1; then
    cat > "$APPARMOR_PROFILE" <<PROFILE
# Grants ${sanitizedProductName} the unprivileged user namespace its Chromium
# sandbox needs. Installed by the ${executable} package; removed with it.
abi <abi/4.0>,
include <tunables/global>

profile ${executable} /opt/${sanitizedProductName}/${executable} flags=(unconfined) {
  userns,
  include if exists <local/${executable}>
}
PROFILE
    if apparmor_parser -r "$APPARMOR_PROFILE" >/dev/null 2>&1; then
        PROFILE_INSTALLED=1
    else
        # An older apparmor rejects the 4.0 ABI. Leave nothing behind.
        rm -f "$APPARMOR_PROFILE"
    fi
fi

if [ "$PROFILE_INSTALLED" = "1" ]; then
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
elif [ -L /proc/self/ns/user ] && [ "$RESTRICTED" != "1" ] && unshare --user true 2>/dev/null; then
    # User namespaces work and nothing restricts them: no setuid binary needed.
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    # Last resort, and the same thing Google Chrome's own .deb ships.
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
