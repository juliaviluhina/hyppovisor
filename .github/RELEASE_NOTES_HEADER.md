> **Unsigned build.** macOS Gatekeeper will block it on first launch. Pick the
> file for your Mac — `arm64` for Apple Silicon, `x64` for Intel — then:
>
> ```bash
> xattr -dr com.apple.quarantine ~/Downloads/HyppoVisor-*.dmg
> ```
>
> …or right-click the app → **Open** → **Open**. Full steps: the README's
> [Download & install](https://github.com/juliaviluhina/hyppovisor#download--install)
> section.
