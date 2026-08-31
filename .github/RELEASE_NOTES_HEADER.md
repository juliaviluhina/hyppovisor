> **Unsigned build.** This release ships the `arm64` build (Apple Silicon) only.
> It is not signed with an Apple Developer ID or notarized, so on first launch
> macOS Gatekeeper reports it as **"HyppoVisor is damaged and can't be opened"**
> (misleading — the app is fine) and right-click → **Open** does *not* clear it.
>
> Drag `HyppoVisor.app` into `/Applications`, then strip the download quarantine:
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/HyppoVisor.app
> ```
>
> If it still won't open, ad-hoc re-sign it:
>
> ```bash
> codesign --force --deep --sign - /Applications/HyppoVisor.app
> ```
>
> Full steps: the README's
> [Download & install](https://github.com/juliaviluhina/hyppovisor#download--install)
> section.
