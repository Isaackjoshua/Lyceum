#!/bin/bash

# Remove the link to the binary.
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

# Take the AppArmor profile with us, if the install put one there.
APPARMOR_PROFILE='/etc/apparmor.d/${executable}'
if [ -f "$APPARMOR_PROFILE" ]; then
    if type apparmor_parser >/dev/null 2>&1; then
        apparmor_parser -R "$APPARMOR_PROFILE" >/dev/null 2>&1 || true
    fi
    rm -f "$APPARMOR_PROFILE"
fi
